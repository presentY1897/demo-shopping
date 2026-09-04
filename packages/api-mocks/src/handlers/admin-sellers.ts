import type {
  Seller,
  SellerDecisionRequest,
  SellerReviewListResponse,
  SellerStatus,
} from '@shopping/shared'
import {
  SELLER_REVIEW_LIST_DEFAULT_LIMIT,
  sellerDecisionRequestSchema,
  sellerIdSchema,
  sellerReasonedDecisionRequestSchema,
  sellerResponseSchema,
  sellerReviewListQueryParamsSchema,
  sellerReviewListResponseSchema,
} from '@shopping/shared'
import type { PathParams, RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { adminSellerQueue } from '../fixtures/admin-sellers'
import { mockPaths } from '../paths'
import { answering, MockApiError } from './refusal'

/**
 * The review endpoints, with the state a screen that decides things needs.
 *
 * A frozen fixture would answer F1 and nothing else. What TASK-0110 actually
 * asks is whether a decision is *reflected*, whether a stale one is *refused*,
 * whether an impossible one is *explained*, and whether paging forward and back
 * repeats a row — questions about what the API does with a request. So the store
 * below reproduces the four things the screen can observe through HTTP, and
 * nothing else:
 *
 * | invariant | how the real API enforces it |
 * | --- | --- |
 * | keyset paging | `WHERE id < cursor ORDER BY id DESC LIMIT n + 1` |
 * | the state machine | `nextSellerStatus`, and a 400 listing what *was* possible |
 * | optimistic lock | `UPDATE ... WHERE version = ? AND status = ?`, 0 rows means 409 |
 * | reason required | `sellerReasonedDecisionRequestSchema` on 반려·정지 |
 *
 * **The order of the two refusals is the API's own** (`SellerService.decide`):
 * an impossible transition is a 400 *even when the version is also stale*.
 * Re-reading would not make the move possible, and 409 means "read again and
 * retry" — which would be a lie (TASK-0108 9장).
 *
 * It is deliberately **not** a second implementation of the service. Role
 * granting, the demo scope check and the approval transaction are the back-end's
 * own tests; what is reproduced here is only what a screen can see.
 *
 * Responses go through `defineFixture`, so every body this file invents is
 * parsed by the same schema the API answers against (gate C2).
 */

/** The four decisions this API takes, and where each one lands. */
const TRANSITIONS = {
  approve: { from: ['PENDING'], to: 'ACTIVE' },
  reject: { from: ['PENDING'], to: 'REJECTED' },
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  reinstate: { from: ['SUSPENDED'], to: 'ACTIVE' },
} as const satisfies Record<string, { from: readonly SellerStatus[]; to: SellerStatus }>

type Decision = keyof typeof TRANSITIONS

/**
 * `apply` is missing from the table above on purpose: it belongs to the seller's
 * own endpoint (TASK-0109), and this file mocks the administrator's four.
 */
const DECISIONS = Object.keys(TRANSITIONS) as readonly Decision[]

/** 반려 and 정지 carry a reason the seller has to be able to act on. */
const REASONED: readonly Decision[] = ['reject', 'suspend']

function isDecision(value: string): value is Decision {
  return (DECISIONS as readonly string[]).includes(value)
}

/** Every move a store in `current` can make, in the table's order. */
function allowedFrom(current: SellerStatus): readonly Decision[] {
  return DECISIONS.filter((decision) =>
    (TRANSITIONS[decision].from as readonly SellerStatus[]).includes(current),
  )
}

/**
 * One path segment, as the string it is.
 *
 * msw types a parameter as `string | readonly string[]` because a pattern may
 * repeat one; none of these do, so the array case takes its first entry and a
 * missing parameter becomes `''` — which then fails `sellerIdSchema` and comes
 * back as the 400 a malformed id deserves.
 */
function segment(value: PathParams[string] | undefined): string {
  if (typeof value === 'string') return value

  return value?.[0] ?? ''
}

/**
 * The decision body, validated with the schema the controller validates it with.
 *
 * Not `readBody`: that helper answers a malformed body with a 400 that names no
 * field, and the one thing this endpoint's 400 has to carry is
 * `details[].field = 'reason'` — it is what puts "사유를 입력해 주세요" under the
 * textarea instead of at the top of the dialog (TASK-0110 F6). The mapping from
 * zod issue to entry is `apps/api/src/common/parse-input.ts`'s.
 */
async function readDecision(request: Request, decision: Decision): Promise<SellerDecisionRequest> {
  const schema = REASONED.includes(decision)
    ? sellerReasonedDecisionRequestSchema
    : sellerDecisionRequestSchema
  const parsed = schema.safeParse(await request.json())

  if (parsed.success) return parsed.data

  const entries = parsed.error.issues
    .map((issue) => issue.path.map((part) => String(part)).join('.'))
    .filter((field) => field !== '')
    .map((field) => ({ field, message: `${field} 값이 올바르지 않습니다.`, code: 'INVALID' }))

  // An issue with no path at all — a body that is not an object — has no field
  // to name, so the refusal says only that the shape was wrong.
  if (entries.length === 0) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

  throw new MockApiError(400, '요청 형식이 올바르지 않습니다.', { entries })
}

/**
 * A 400 that names an input, shaped exactly as `parseInput` shapes one.
 *
 * The envelope keeps `BAD_REQUEST` and the entry carries `INVALID` — passing the
 * code to `MockApiError` directly would put `INVALID` on the *envelope*, which
 * is a shape the API never sends.
 */
function invalidInput(field: string, message: string, params?: Record<string, string>): never {
  throw new MockApiError(400, message, {
    entries: [{ field, message, code: 'INVALID', ...(params === undefined ? {} : { params }) }],
  })
}

class AdminSellerStore {
  private rows: Seller[] = []

  /**
   * The clock a decision stamps `statusChangedAt` with.
   *
   * Injected as a counter rather than read from `Date.now()`: QUALITY-GATES 6장
   * makes time an input everywhere else, and a double whose timestamps move on
   * their own cannot be asserted against. It starts after the newest fixture so
   * that a decision is always *later* than the application it decides.
   */
  private tick = 0

  constructor() {
    this.reset()
  }

  reset(seed: SellerReviewListResponse = adminSellerQueue): void {
    this.rows = seed.sellers.map((row) => ({ ...row }))
    this.tick = 0
  }

  /**
   * One page, newest first.
   *
   * `id DESC` with `id < cursor` is the whole of it. Store ids are UUIDv7 and
   * therefore already in creation order, so the cursor is the last id of the
   * page and nothing else — no `(createdAt, id)` pair, and no offset that would
   * shift under an application submitted while page two is being read.
   */
  page(query: {
    status?: SellerStatus
    limit?: number
    cursor?: string
  }): SellerReviewListResponse {
    const limit = query.limit ?? SELLER_REVIEW_LIST_DEFAULT_LIMIT

    const matching = this.rows
      .filter((row) => query.status === undefined || row.status === query.status)
      .filter((row) => query.cursor === undefined || row.id < query.cursor)
      .sort((left, right) => (left.id < right.id ? 1 : -1))

    // One more than asked for, so "is there another page" needs no count query.
    const window = matching.slice(0, limit + 1)
    const page = window.slice(0, limit)

    return {
      sellers: page,
      nextCursor: window.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  find(id: string): Seller {
    const row = this.rows.find((candidate) => candidate.id === id)

    if (row === undefined) throw new MockApiError(404, '스토어를 찾을 수 없습니다.')

    return row
  }

  decide(id: string, decision: Decision, input: SellerDecisionRequest): Seller {
    const row = this.find(id)
    const { from, to } = TRANSITIONS[decision]

    if (!(from as readonly SellerStatus[]).includes(row.status)) {
      const allowed = allowedFrom(row.status)

      invalidInput(
        'status',
        allowed.length === 0
          ? `지금 상태(${row.status})에서는 할 수 있는 것이 없어요.`
          : `지금 상태(${row.status})에서는 ${decision} 할 수 없어요. 가능한 것: ${allowed.join(', ')}`,
        { status: row.status, action: decision, allowed: allowed.join(',') },
      )
    }

    // Second, and only second. See the note at the top of the file.
    if (row.version !== input.version) {
      throw new MockApiError(409, '다른 사람이 먼저 저장했어요. 최신 내용을 불러올까요?', {
        entries: [
          {
            field: 'version',
            message: '다른 사람이 먼저 저장했어요. 최신 내용을 불러올까요?',
            code: 'INVALID',
          },
        ],
      })
    }

    this.tick += 1

    const decided: Seller = {
      ...row,
      status: to,
      // A decision without a note clears the previous one: the sentence on an
      // approved store would otherwise still be why it was once rejected.
      statusReason: input.reason ?? null,
      statusChangedAt: new Date(Date.UTC(2026, 8, 1) + this.tick * 60_000).toISOString(),
      version: row.version + 1,
    }
    this.rows = this.rows.map((candidate) => (candidate.id === row.id ? decided : candidate))

    return decided
  }
}

const store = new AdminSellerStore()

/**
 * Puts the queue back to the fixture. Called from `setupTestServer`'s `afterEach`.
 *
 * A spec that needs a different starting point — the empty queue, say — passes
 * one here in its own `beforeEach`, which runs after the reset.
 */
export function resetAdminSellerStore(seed?: SellerReviewListResponse): void {
  store.reset(seed)
}

export const adminSellerHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.adminSellers, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = sellerReviewListQueryParamsSchema.safeParse(
        Object.fromEntries(url.searchParams),
      )

      if (!query.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

      return HttpResponse.json(
        defineFixture(sellerReviewListResponseSchema, store.page(query.data)),
      )
    }),
  ),

  http.get(mockPaths.adminSeller, ({ params }) =>
    answering(() => {
      const id = segment(params.id)
      if (!sellerIdSchema.safeParse(id).success) invalidInput('id', 'id 값이 올바르지 않습니다.')

      return HttpResponse.json(defineFixture(sellerResponseSchema, { seller: store.find(id) }))
    }),
  ),

  http.post(mockPaths.adminSellerDecision, ({ request, params }) =>
    answering(async () => {
      const action = segment(params.action)
      // The router, not the service: a fifth verb is a path that does not exist.
      if (!isDecision(action)) throw new MockApiError(404, '요청한 경로를 찾을 수 없습니다.')

      const id = segment(params.id)
      if (!sellerIdSchema.safeParse(id).success) invalidInput('id', 'id 값이 올바르지 않습니다.')

      const body = await readDecision(request, action)

      return HttpResponse.json(
        defineFixture(sellerResponseSchema, { seller: store.decide(id, action, body) }),
      )
    }),
  ),
]
