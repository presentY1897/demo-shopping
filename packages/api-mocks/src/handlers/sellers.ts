import type {
  Seller,
  SellerApplicationRequest,
  SellerStatus,
  SellerStoreUpdateRequest,
} from '@shopping/shared'
import {
  brandNameAvailabilityQuerySchema,
  brandNameAvailabilityResponseSchema,
  sellerApplicationRequestSchema,
  sellerResponseSchema,
  sellerStoreUpdateRequestSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { brandNameTaken, sellerPending } from '../fixtures/sellers'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * The seller's own side of onboarding (TASK-0108 `SellerController`).
 *
 * Stateful, like the category endpoints and for the same reason: TASK-0109 asks
 * whether a re-application *moves* a rejected store back to `PENDING`, whether a
 * second tab's save is *refused*, and whether a taken brand name comes back on
 * the field that carries it. Those are questions about what the API does with a
 * request, and a frozen fixture cannot answer any of them.
 *
 * What is reproduced is only what a screen can observe through HTTP:
 *
 * | invariant | how the real API enforces it |
 * | --- | --- |
 * | one store per account | `Seller_userId_key`; re-applying edits the row it finds |
 * | legal transitions only | `nextSellerStatus`, else 400 naming `status` |
 * | optimistic lock | `updateMany ... WHERE version = ?`, 0 rows means 409 |
 * | brand name uniqueness | `Seller_brandName_key`, surfaced as 409 on `brandName` |
 *
 * **No response here carries a domain code**, because the real ones do not:
 * TASK-0108 deliberately added none, so `error.code` is the status-derived
 * `CONFLICT` or `BAD_REQUEST` and the *field* on the `details[]` entry is what
 * tells a lost optimistic lock from a taken name. A mock that invented a code
 * would let the console branch on something the API never sends.
 *
 * Every body goes through `defineFixture`, so a payload that drifted from
 * `sellerSchema` fails here rather than in the screen it would mislead (C2).
 */

/** `details[].code` on every refusal these endpoints make (`parseInput`, `versionConflict`). */
const INVALID = 'INVALID'

/**
 * The transition table, as `seller-status.ts` holds it — the `apply` row only.
 *
 * The three review moves are the admin console's (TASK-0110) and are not mocked
 * here: an endpoint nothing calls is a double nobody checks.
 */
const APPLY_FROM: readonly (SellerStatus | null)[] = [null, 'REJECTED']

/** What a store in `status` could do instead, in `allowedSellerActions` order. */
function allowedFrom(status: SellerStatus | null): readonly string[] {
  return APPLY_FROM.includes(status) ? ['apply'] : []
}

/** The 400 `SellerService.refuseTransition` answers, including its `params`. */
function refuseTransition(current: SellerStatus | null): MockApiError {
  const allowed = allowedFrom(current)
  const detail =
    allowed.length === 0
      ? `지금 상태(${current ?? '없음'})에서는 할 수 있는 것이 없어요.`
      : `지금 상태(${current ?? '없음'})에서는 apply 할 수 없어요. 가능한 것: ${allowed.join(', ')}`

  return new MockApiError(400, detail, {
    entries: [
      {
        field: 'status',
        message: detail,
        code: INVALID,
        params: { status: current ?? 'NONE', action: 'apply', allowed: allowed.join(',') },
      },
    ],
  })
}

/**
 * A 409 naming one input, the way a unique violation arrives.
 *
 * `entries` rather than `field`, because `MockApiError` uses one `code` for both
 * the envelope and the entry and these two differ: the envelope's is `CONFLICT`
 * (status derived, since the service throws a bare `ConflictException`) while
 * the entry's is `INVALID`. Passing `code` would put `INVALID` on the envelope,
 * where the contract says it never goes.
 */
function conflictOn(field: string, message: string): MockApiError {
  return new MockApiError(409, message, {
    entries: [{ field, message, code: INVALID }],
  })
}

/**
 * Every request these endpoints answered, in order.
 *
 * The measurement behind "요청이 한 번만 나간다" (U3) and "`version` 을 포함한
 * `PATCH` 본문 1회" (F5). Asserting on the store's final state cannot see a
 * duplicate submit — two identical saves leave the same row as one — and
 * counting from outside msw would mean each spec assembling its own listener.
 *
 * Cleared by {@link resetSellerStore}, so a count always belongs to one test.
 */
export interface SellerRequestRecord {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let log: SellerRequestRecord[] = []

export function sellerRequests(): readonly SellerRequestRecord[] {
  return log
}

function record(method: string, path: string, body: unknown = undefined): void {
  log = [...log, { method, path, body }]
}

/** One store, and what the four endpoints do to it. */
class SellerStore {
  private row: Seller | null = null

  /** Brand names other accounts hold. The index this mock stands in for. */
  private taken = new Set<string>()

  constructor() {
    this.reset()
  }

  /**
   * Back to "this account has never applied", which is the default on purpose:
   * a spec has to say which of the five states it is about, and the one with no
   * row is the one it gets by saying nothing.
   */
  reset(seed: Seller | null = null): void {
    this.row = seed === null ? null : { ...seed }
    this.taken = new Set([brandNameTaken.value])
    log = []
  }

  snapshot(): Seller | null {
    return this.row
  }

  /** `GET /sellers/me`. A 404 is "아직 신청하지 않았다", not an empty payload. */
  me(): Seller {
    if (this.row === null) throw new MockApiError(404, '아직 입점 신청을 하지 않았습니다.')

    return this.row
  }

  /**
   * `POST /sellers/applications` — applying, and applying again after a
   * rejection.
   *
   * The whole form arrives both times. A re-application is a new submission
   * rather than a patch on the rejected row, because the brand name may well
   * have been the reason for the rejection.
   */
  apply(input: SellerApplicationRequest): Seller {
    const current = this.row?.status ?? null
    if (!APPLY_FROM.includes(current)) throw refuseTransition(current)

    this.refuseTakenBrandName(input.brandName)

    const now = new Date().toISOString()
    const next: Seller = {
      // Read off the fixture rather than invented, so a store created here is
      // the one `sessionSellerOwner`'s `own` scopes resolve against.
      id: this.row?.id ?? sellerPending.id,
      userId: this.row?.userId ?? sellerPending.userId,
      brandName: input.brandName,
      slug: input.slug,
      introduction: input.introduction ?? null,
      logoUrl: input.logoUrl ?? null,
      status: 'PENDING',
      // The rejection no longer applies to a submission that answers it.
      statusReason: null,
      statusChangedAt: now,
      version: this.row === null ? 0 : this.row.version + 1,
      createdAt: this.row?.createdAt ?? now,
    }
    this.row = next

    return next
  }

  /** `PATCH /sellers/me` — brand name, introduction, logo. Never the slug (R4). */
  update(input: SellerStoreUpdateRequest): Seller {
    const row = this.me()

    // The version guard is in the real statement's `WHERE`, so a stale editor
    // never reaches the unique index at all. Same order here.
    if (row.version !== input.version) {
      throw conflictOn('version', '다른 사람이 먼저 저장했어요. 최신 내용을 불러올까요?')
    }
    if (input.brandName !== undefined) this.refuseTakenBrandName(input.brandName)

    const next: Seller = {
      ...row,
      ...(input.brandName === undefined ? {} : { brandName: input.brandName }),
      ...(input.introduction === undefined ? {} : { introduction: input.introduction }),
      ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl }),
      version: row.version + 1,
    }
    this.row = next

    return next
  }

  /**
   * `GET /sellers/brand-name-availability`.
   *
   * A read, and never the decision: the store's own name is free to keep, and
   * anything another account holds is refused by {@link apply} and
   * {@link update} whatever this answered a moment earlier.
   */
  availability(value: string): { readonly value: string; readonly available: boolean } {
    return { value, available: !this.taken.has(value) }
  }

  private refuseTakenBrandName(value: string): void {
    if (this.taken.has(value)) throw conflictOn('brandName', '이미 쓰고 있는 브랜드명이에요.')
  }
}

const store = new SellerStore()

/**
 * Puts the store back. Called from `setupTestServer`'s `afterEach`.
 *
 * A spec names the state it is about — `resetSellerStore(sellerRejected)` — in
 * its own `beforeEach`, which runs after the reset.
 */
export function resetSellerStore(seed?: Seller | null): void {
  store.reset(seed)
}

/** The store as the mock now holds it, or `null` when nobody has applied. */
export function sellerRowSnapshot(): Seller | null {
  return store.snapshot()
}

export const sellerHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.sellerBrandNameAvailability, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      record('GET', url.pathname + url.search)

      const query = brandNameAvailabilityQuerySchema.safeParse(Object.fromEntries(url.searchParams))
      if (!query.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

      return HttpResponse.json(
        defineFixture(brandNameAvailabilityResponseSchema, store.availability(query.data.value)),
      )
    }),
  ),

  http.get(mockPaths.sellerMe, () =>
    answering(() => {
      record('GET', '/sellers/me')

      return HttpResponse.json(defineFixture(sellerResponseSchema, { seller: store.me() }))
    }),
  ),

  http.post(mockPaths.sellerApplications, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, sellerApplicationRequestSchema)
      record('POST', '/sellers/applications', body)

      // 201 for a re-application too: what the operator's queue lists is the
      // review, and re-applying creates one even though the row already existed.
      return HttpResponse.json(defineFixture(sellerResponseSchema, { seller: store.apply(body) }), {
        status: 201,
      })
    }),
  ),

  http.patch(mockPaths.sellerMe, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, sellerStoreUpdateRequestSchema)
      record('PATCH', '/sellers/me', body)

      return HttpResponse.json(defineFixture(sellerResponseSchema, { seller: store.update(body) }))
    }),
  ),
]
