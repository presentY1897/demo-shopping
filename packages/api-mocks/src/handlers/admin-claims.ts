import type {
  AdminClaimListItem,
  Claim,
  ClaimableResponse,
  DomainErrorCode,
  ReturnReason,
} from '@shopping/shared'
import {
  ADMIN_CLAIM_LIST_DEFAULT_LIMIT,
  adminClaimListQueryParamsSchema,
  adminClaimListResponseSchema,
  adminFailedRefundListResponseSchema,
  adminOverdueClaimsResponseSchema,
  claimableResponseSchema,
  claimResponseSchema,
  createAdminClaimRequestSchema,
  dismissClaimAppealRequestSchema,
  fileClaimAppealRequestSchema,
  RETURN_PHOTO_MAX_COUNT,
  returnPhotoKeyPattern,
} from '@shopping/shared'
import type { PathParams, RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths } from '../paths'
import type { MockAdminClaimSeed } from './admin-claim-contract'
import {
  MOCK_ADMIN_CLAIM_NOW,
  mockAdminClaimableOf,
  mockAdminClaimListItemOf,
  mockAdminClaimOf,
  mockAdminClaimSeedOf,
  mockAdminClaimSeeds,
  mockAdminDefectReturnOf,
  mockAdminFailedRefunds,
  mockAdminInterventionOf,
  mockAdminSellerIdOf,
  sortAdminClaims,
} from './admin-claim-contract'
import { answering, MockApiError, readBody } from './refusal'
import { mockSession } from './session'

/**
 * 관리자의 클레임 개입 (TASK-0071), 화면이 물어보는 것만큼.
 *
 * **상태를 갖는다.** 이 화면이 묻는 질문이 전부 상태에 대한 것이기 때문이다 —
 * 거절을 뒤집으면 목록에 **새 줄**이 생기는가, 그때 원본의 「이의 검토 대기」 뱃지가
 * 사라지는가, 기각하면 그 뱃지만 사라지고 클레임은 그대로인가. 얼어붙은 픽스처는
 * 그중 무엇에도 답하지 못하고, 그것으로 검사한 화면은 틀린 일을 하면서 통과한다.
 *
 * 재현하는 것은 **화면이 HTTP 로 관찰할 수 있는 것**뿐이다.
 *
 * | 성질 | 실제 API 가 지키는 방법 |
 * | --- | --- |
 * | 최신순 · 커서는 `id` 하나 | `WHERE c."id" < cursor ORDER BY c."id" DESC LIMIT n+1` |
 * | 강제 처리는 **새 클레임** | 원본은 거절된 채 남고 `overturnsClaimId` 가 잇는다 |
 * | 인용은 강제 처리 그 자체 | 개입과 같은 트랜잭션에서 이의가 닫힌다 (인용 라우트가 없다) |
 * | 기각에는 사유가 필수 | `dismissClaimAppealRequestSchema` 의 `min(1)` |
 * | 이의는 **거절된 클레임에만** | `canOverturn` 이 두 곳에서 같은 집합을 답한다 |
 * | 지연은 정렬이 아니라 표시 | `now` 에 달린 값이라 커서를 흔든다 |
 * | 사진 판정은 **두 갈래 공통** | 개입은 원본이 있든 없든 `ClaimService.createWith` 하나를 지난다 |
 *
 * **모든 응답이 `defineFixture` 를 지난다** — 계약과 어긋난 본문은 그것을 잘못 그릴
 * 화면이 아니라 여기서 실패한다 (C2).
 *
 * 씨앗과 조립기는 `admin-claim-contract.ts` 에 있다. 픽스처가 같은 것을 읽어야 하고,
 * 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없기 때문이다.
 */

interface Store {
  readonly rows: AdminClaimListItem[]
  readonly claims: Map<string, Claim>
}

function seeded(): Store {
  const claims = new Map<string, Claim>()

  for (const seed of mockAdminClaimSeeds) {
    const claim = mockAdminClaimOf(seed)

    claims.set(claim.id, claim)
  }

  return {
    rows: mockAdminClaimSeeds.map((seed: MockAdminClaimSeed) => mockAdminClaimListItemOf(seed)),
    claims,
  }
}

let store: Store = seeded()

/** 다음 쓰기 하나를 실패시킨다 (강제 처리·기각·이의 중 먼저 오는 것). */
let nextFailure: MockApiError | null = null

export function failNextAdminClaim(error?: MockApiError): void {
  nextFailure = error ?? new MockApiError(500, '관리자 개입에 실패했습니다.')
}

export function resetAdminClaimStore(): void {
  store = seeded()
  nextFailure = null
}

/** 심어 둔 줄을 그대로 읽는다. 스토리와 스펙이 「무엇이 있어야 하나」를 물을 때 쓴다. */
export function adminClaimRowsSnapshot(): readonly AdminClaimListItem[] {
  return sortAdminClaims(store.rows)
}

/** 심어 둔 실패 하나를 소비한다. 두 번째 요청은 정상으로 돌아간다. */
function consumeFailure(): void {
  const failure = nextFailure

  nextFailure = null

  if (failure !== null) throw failure
}

/** 아무도 로그인하지 않았을 때의 개입자. 대역의 스펙이 열쇠를 예측할 수 있게 고정이다. */
const MOCK_ADMIN_ID = '019597a0-0007-7000-8000-0000000000a1'

/**
 * **개입을 내는 사람** — 로그인한 계정, 없으면 위의 고정값.
 *
 * 실 서버가 이력에 적는 것도 사진의 주인으로 묻는 것도 `principal.userId` 하나이고
 * (`AdminClaimService.force` · `returnPhotoDecision`), `uploads` 대역이 열쇠의 가운데
 * 칸에 넣는 것도 같은 값이다(`keyOfPurpose`). 여기서 다른 값을 쓰면 **대역이 서명한
 * 열쇠를 대역이 남의 것으로 판정한다.**
 */
function adminId(): string {
  return mockSession()?.user.id ?? MOCK_ADMIN_ID
}

function pathIdOf(params: PathParams): string {
  const raw = params.id

  return String(Array.isArray(raw) ? raw[0] : raw)
}

function claimOr404(claimId: string): Claim {
  const claim = store.claims.get(claimId)

  if (claim === undefined) throw new MockApiError(404, '클레임을 찾을 수 없어요.')

  return claim
}

function rowOf(claimId: string): AdminClaimListItem | undefined {
  return store.rows.find((row) => row.id === claimId)
}

/**
 * 「이 몫에 지금 무엇을 몇 개까지 신청할 수 있나」, 또는 모르는 몫이면 404.
 *
 * **클레임 저장소를 보지 않는다.** 확정 후 하자 반품이 시작되는 자리에는 아직
 * 클레임이 없고(원본이 없는 개입이다), 그래서 이 답의 출처는 몫 그 자체다.
 */
function claimableOr404(sellerOrderId: string): ClaimableResponse {
  const claimable = mockAdminClaimableOf(sellerOrderId)

  if (claimable === null) throw new MockApiError(404, '주문을 찾을 수 없어요.')

  return claimable
}

/**
 * 이 사유에 사진이 필요한가 (`return-rules.ts` 의 `PHOTO_RULE`).
 *
 * **관리자 경로에도 세 사유가 다 온다.** 확정 후 하자 반품은 판매자 귀책 둘만
 * 고르지만(단순 변심으로 확정을 되돌릴 수 없다), **거절을 뒤집는 쪽은 다르다** —
 * 단순 변심 반품을 거절한 판매자를 관리자가 그대로 승인할 수 있고, 그때는 사진이
 * 오히려 **금지**다. 한 표가 두 갈래를 함께 답하는 이유가 그것이다.
 */
const PHOTO_RULE: Readonly<Record<ReturnReason, 'required' | 'forbidden'>> = {
  CHANGE_OF_MIND: 'forbidden',
  DEFECTIVE: 'required',
  WRONG_ITEM: 'required',
}

/**
 * 반품 사진 판정 (`return-rules.ts` 의 `returnPhotoDecision`) — **두 갈래가 함께
 * 지난다.**
 *
 * 실 서버에서 관리자의 개입은 원본이 있든 없든 `ClaimService.createWith` 하나를
 * 지나고, 거기서 이 판정이 돈다. 그래서 대역도 한 자리에서 두 갈래를 함께 답해야
 * 한다 — 뒤집기에서 이것을 건너뛰면 화면은 **사진 없는 하자 반품**을 보내고도 모든
 * 프론트 검사를 통과한 뒤 실 서버에서만 400 `RETURN_PHOTO_REQUIRED` 를 받는다.
 *
 * **순서가 답의 우선순위다** (`returnPhotoDecision` 과 같은 순서). 단순 변심으로
 * 여섯 장을 올린 사람에게 「다섯 장까지입니다」라고 답하면 한 장을 빼고 다시
 * 시도하는데, 그가 할 일은 전부 빼거나 사유를 고치는 것이다.
 *
 * **남의 열쇠도 여기서 걸린다.** 실 서버는 접두어로 주인을 읽고(`isOwnPhotoKey`),
 * 그 주인은 **신청을 내는 사람** — 관리자 개입에서는 관리자다. 이 갈래가 없으면
 * 「구매자가 문의에 붙인 사진을 그대로 신청서에 싣는」 화면이 대역 위에서는 통과하고
 * 실 서버에서만 `RETURN_PHOTO_FOREIGN` 으로 끝난다.
 */
function assertReturnPhotos(reason: ReturnReason, keys: readonly string[]): void {
  const refuse = (
    code: DomainErrorCode,
    message: string,
    params?: Record<string, number>,
  ): never => {
    throw new MockApiError(400, message, { code, field: 'return.photoKeys', params })
  }

  if (PHOTO_RULE[reason] === 'forbidden') {
    if (keys.length > 0) {
      refuse('RETURN_PHOTO_NOT_ALLOWED', '단순 변심 반품에는 사진을 첨부할 수 없어요.')
    }

    return
  }

  if (keys.length === 0) {
    refuse('RETURN_PHOTO_REQUIRED', '하자·오배송 반품에는 사진을 한 장 이상 첨부해 주세요.')
  }
  if (keys.length > RETURN_PHOTO_MAX_COUNT) {
    refuse('RETURN_PHOTO_TOO_MANY', '사진은 최대 {max}장까지 첨부할 수 있어요.', {
      max: RETURN_PHOTO_MAX_COUNT,
    })
  }
  if (new Set(keys).size !== keys.length) {
    refuse('RETURN_PHOTO_DUPLICATE', '같은 사진을 두 번 첨부할 수 없어요.')
  }
  if (!keys.every((key) => isOwnPhotoKey(key, adminId()))) {
    refuse('RETURN_PHOTO_FOREIGN', '첨부할 수 없는 사진이에요.')
  }
}

/** 열쇠가 **이 사람의** 것인가 — `return-rules.ts` 의 `isOwnPhotoKey` 그대로. */
function isOwnPhotoKey(key: string, ownerUserId: string): boolean {
  return returnPhotoKeyPattern.test(key) && key.startsWith(`returns/${ownerUserId}/`)
}

/**
 * 거절된 클레임에만 이의를 걸 수 있고, 거절된 클레임만 뒤집을 수 있다.
 *
 * **한 함수인 것이 요점이다.** 서버에서도 두 판정이 `canOverturn` 하나를 지나므로,
 * 여기서 갈라 두면 「이의는 받았는데 뒤집을 수는 없는」 건이 대역에서만 생긴다.
 */
function isRejected(claim: Claim): boolean {
  return claim.status === 'CANCEL_REJECTED' || claim.status === 'RETURN_REJECTED'
}

/** 필터를 지난 줄들. 없는 조건은 그냥 통과한다. */
function filtered(url: URL): AdminClaimListItem[] {
  const parsed = adminClaimListQueryParamsSchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  )

  if (!parsed.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

  const query = parsed.data

  return sortAdminClaims(store.rows).filter((row) => {
    if (query.sellerId !== undefined && row.sellerId !== query.sellerId) return false
    if (query.buyerId !== undefined && row.buyerId !== query.buyerId) return false
    if (query.status !== undefined && !query.status.includes(row.status)) return false
    if (query.stage !== undefined && row.stage !== query.stage) return false
    if (query.type !== undefined && row.type !== query.type) return false
    if (query.from !== undefined && row.requestedAt < query.from) return false
    if (query.to !== undefined && row.requestedAt > query.to) return false
    if (query.appealed === true && !row.appealPending) return false
    // 커서는 **자리**이지 행이 아니다. 최신순이므로 「본 것보다 작은 id」가 다음이다.
    if (query.cursor !== undefined && row.id >= query.cursor) return false

    return true
  })
}

function limitOf(url: URL): number {
  const raw = url.searchParams.get('limit')

  return raw === null ? ADMIN_CLAIM_LIST_DEFAULT_LIMIT : Number(raw)
}

export const adminClaimHandlers: readonly RequestHandler[] = [
  /**
   * 지연 목록. **`adminClaims` 보다 먼저 등록한다.**
   *
   * msw 는 먼저 등록된 핸들러를 쓰므로 순서가 곧 라우팅이다. 지금은 두 패턴이
   * 겹치지 않지만(`/admin/claims` 는 정확히 그 경로만 받는다), 순서를 지켜 두는 것이
   * 이 저장소가 라우터에 대해 지키는 규약이다.
   */
  http.get(mockPaths.adminOverdueClaims, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const overdue = sortAdminClaims(store.rows).filter((row) => row.overdue)
      const limit = limitOf(url)

      return HttpResponse.json(
        defineFixture(adminOverdueClaimsResponseSchema, {
          claims: overdue.slice(0, limit),
          scanned: store.rows.length,
          truncated: overdue.length > limit,
        }),
      )
    }),
  ),

  http.get(mockPaths.adminClaims, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const limit = limitOf(url)
      const matched = filtered(url)
      const page = matched.slice(0, limit)

      return HttpResponse.json(
        defineFixture(adminClaimListResponseSchema, {
          claims: page,
          nextCursor: matched.length > limit ? (page.at(-1)?.id ?? null) : null,
        }),
      )
    }),
  ),

  http.get(mockPaths.adminFailedRefunds, () =>
    answering(() =>
      HttpResponse.json(
        defineFixture(adminFailedRefundListResponseSchema, {
          refunds: [...mockAdminFailedRefunds],
          hasMore: false,
        }),
      ),
    ),
  ),

  /**
   * 「이 몫에 지금 무엇을 몇 개까지 신청할 수 있나」 —
   * **`/admin` 아래가 아니다** (`GET /seller-orders/:id/claimable`).
   *
   * 관리자에게 이 라우트를 열어 주는 것은 `claim.read` 가 `any` 라는 사실 하나이고
   * (`ClaimService.actorFor` 의 마지막 갈래), 그래서 문이 구매자와 같다. 확정 후
   * 하자 반품 화면이 대상을 찾는 방법이 이것뿐이라 대역도 여기 있다.
   *
   * 그 문의 대역은 `handlers/claims.ts` 에도 있고 **저쪽은 구매자의 주문 저장소를
   * 본다.** 관리자 화면의 검사는 `server.use(...adminClaimHandlers)` 로 이 핸들러를
   * 앞에 세운다 — 바로 아래 `/claims/:id` 와 같은 사정이고 같은 방식이다.
   */
  http.get(mockPaths.claimable, ({ params }) =>
    answering(() =>
      HttpResponse.json(defineFixture(claimableResponseSchema, claimableOr404(pathIdOf(params)))),
    ),
  ),

  /**
   * 클레임 하나 — **`/admin/claims/:id` 가 아니라 `/claims/:id` 다** (TASK-0071).
   *
   * `AdminClaimController` 에 상세 라우트가 없는 것이 서버의 판단이고(관리자의
   * `claim.read` 가 `any` 라 구매자·판매자와 같은 문으로 읽는다), 그래서 관리자
   * 상세 화면이 부르는 것도 그 문이다.
   *
   * 그 문의 대역은 `handlers/claims.ts` 에도 있고 **저쪽은 구매자의 저장소를
   * 본다.** 두 저장소는 서로 다른 클레임을 들고 있으므로, 관리자 화면의 검사는
   * `server.use(...adminClaimHandlers)` 로 이 핸들러를 앞에 세운다 —
   * `sellerOrderHandlers` 가 `/seller-orders/:id/actions` 에 대해 하는 것과 같은
   * 방식이고, 기본 목록에서는 구매자 쪽이 먼저 등록되어 있어 그쪽 화면은 그대로다.
   */
  http.get(mockPaths.claim, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(claimResponseSchema, { claim: claimOr404(pathIdOf(params)) }),
      ),
    ),
  ),

  /**
   * 강제 처리 — **새 클레임이 서고 원본은 그대로다.**
   *
   * 답이 원본이 아니라 개입인 것이 이 라우트의 계약이고, 화면이 그 `id` 를 따라가면
   * 방금 만든 개입을 열게 된다. 원본에 걸려 있던 이의는 **같은 요청에서** 인용으로
   * 닫힌다 — 따로 부르는 인용 라우트가 없는 것이 서버의 설계 판단이다.
   */
  http.post(mockPaths.adminClaims, ({ request }) =>
    answering(async () => {
      consumeFailure()

      const input = await readBody(request, createAdminClaimRequestSchema)

      const admin = adminId()

      // **원본이 없는 개입** — 확정 후 하자 반품 (F4). 같은 라우트의 다른 절반이고,
      // 갈리는 것은 `overturnsClaimId` 하나다 (`AdminClaimService.force`).
      if (input.overturnsClaimId === null) {
        const claimable = claimableOr404(input.sellerOrderId)

        // 관리자에게 열리는 것은 **구매확정한 몫**뿐이다. 다른 상태에 이 문을 열면
        // 대역이 `adminClaimEligibility` 보다 너그러워지고, 화면은 실 서버가 409 로
        // 답할 요청을 성공으로 그린다.
        if (claimable.refusal !== 'confirmed') {
          throw new MockApiError(409, '구매확정한 주문에만 관리자 반품을 열 수 있어요.', {
            code: 'CLAIM_NOT_CLAIMABLE',
            field: 'sellerOrderId',
          })
        }

        // 사유가 없으면 반품이 아니다. 계약의 refine 이 이미 막지만(`fault` 와
        // `return` 은 둘 중 하나다) 타입은 그 사실을 모른다.
        if (input.return === null) {
          throw new MockApiError(409, '이 주문은 반품만 신청할 수 있어요.', {
            code: 'CLAIM_NOT_CLAIMABLE',
            field: 'return',
          })
        }

        assertReturnPhotos(input.return.returnReason, input.return.photoKeys)

        for (const line of input.items) {
          const item = claimable.items.find((entry) => entry.orderItemId === line.orderItemId)
          const remaining = item?.remainingQuantity ?? 0

          if (line.quantity > remaining) {
            throw new MockApiError(409, '신청할 수 있는 수량을 넘었어요.', {
              code: 'CLAIM_EXCEEDS_REMAINING',
              field: 'items',
              params: { remaining },
            })
          }
        }

        const created = mockAdminDefectReturnOf({
          sellerOrderId: input.sellerOrderId,
          lines: input.items,
          reason: input.reason,
          adminId: admin,
        })

        store.claims.set(created.id, created)
        store.rows.push({
          id: created.id,
          sellerOrderId: created.sellerOrderId,
          orderNumber: created.orderNumber,
          sellerId: mockAdminSellerIdOf(0),
          brandName: created.items[0]?.snapshot.brandName ?? '루미에르',
          buyerId: admin,
          type: 'RETURN',
          status: created.status,
          stage: 'IN_PROGRESS',
          fault: 'SELLER',
          requestedAt: MOCK_ADMIN_CLAIM_NOW,
          dueAt: MOCK_ADMIN_CLAIM_NOW,
          overdue: false,
          itemCount: created.items.length,
          totalQuantity: created.items.reduce((sum, item) => sum + item.quantity, 0),
          appealPending: false,
          // 원본이 없어도 개입은 개입이다. 목록의 뱃지가 그 사실을 말한다.
          intervention: true,
        })

        return HttpResponse.json(defineFixture(claimResponseSchema, { claim: created }), {
          status: 201,
        })
      }

      const original = claimOr404(input.overturnsClaimId)

      if (!isRejected(original)) {
        throw new MockApiError(409, '아직 결론이 나지 않은 클레임이에요.', {
          code: 'CLAIM_NOT_CLAIMABLE',
          field: 'overturnsClaimId',
        })
      }

      /*
       * **뒤집기도 신청이다.**
       *
       * 실 서버에서 이 갈래와 위의 확정 후 반품은 같은 문(`ClaimService.createWith`)
       * 을 지나고, 유형은 요청이 주장하는 것이 아니라 **주문이 정한다** — 반품 거절을
       * 뒤집는 개입은 언제나 반품이므로 사유와 사진이 그때 함께 판정된다. 여기서
       * 건너뛰면 「사진 없이 하자로 뒤집는」 화면이 대역 위에서만 통과한다.
       */
      if (original.type === 'RETURN') {
        if (input.return === null) {
          throw new MockApiError(409, '이 주문은 반품만 신청할 수 있어요.', {
            code: 'CLAIM_NOT_CLAIMABLE',
            field: 'return',
          })
        }

        assertReturnPhotos(input.return.returnReason, input.return.photoKeys)
      } else if (input.return !== null) {
        throw new MockApiError(409, '이 주문은 취소만 신청할 수 있어요.', {
          code: 'CLAIM_NOT_CLAIMABLE',
          field: 'fault',
        })
      }

      const intervention = mockAdminInterventionOf(original, input.reason, admin)

      store.claims.set(intervention.id, intervention)
      store.claims.set(original.id, {
        ...original,
        overturnedByClaimIds: [...original.overturnedByClaimIds, intervention.id],
        appeal:
          original.appeal === null
            ? null
            : {
                ...original.appeal,
                reviewedAt: MOCK_ADMIN_CLAIM_NOW,
                reviewedById: admin,
                outcome: 'UPHELD',
              },
      })

      const originalRow = rowOf(original.id)

      if (originalRow !== undefined) {
        store.rows.splice(store.rows.indexOf(originalRow), 1, {
          ...originalRow,
          appealPending: false,
        })
      }

      store.rows.push({
        ...(originalRow ?? mockAdminClaimListItemOf(mockAdminClaimSeedOf(1))),
        id: intervention.id,
        status: intervention.status,
        stage: 'IN_PROGRESS',
        requestedAt: MOCK_ADMIN_CLAIM_NOW,
        dueAt: MOCK_ADMIN_CLAIM_NOW,
        overdue: false,
        appealPending: false,
        intervention: true,
      })

      return HttpResponse.json(defineFixture(claimResponseSchema, { claim: intervention }), {
        status: 201,
      })
    }),
  ),

  /** 이의 기각 — 뱃지만 사라지고 클레임은 거절된 채 그대로다. */
  http.post(mockPaths.adminClaimAppealDismiss, ({ request, params }) =>
    answering(async () => {
      consumeFailure()

      const input = await readBody(request, dismissClaimAppealRequestSchema)
      const claim = claimOr404(pathIdOf(params))

      // **검토를 기다리는 이의**만 골라 낸다. 이미 결론이 난 것을 덮어쓰면
      // 「인용됐다가 기각된」 이력이 남고, 어느 쪽이 사실인지 아무도 말할 수 없다.
      const pending = claim.appeal?.reviewedAt === null ? claim.appeal : null

      if (pending === null) throw new MockApiError(409, '검토를 기다리는 이의가 없어요.')

      const dismissed: Claim = {
        ...claim,
        appeal: {
          ...pending,
          reviewedAt: MOCK_ADMIN_CLAIM_NOW,
          reviewedById: adminId(),
          outcome: 'DISMISSED',
          reviewNote: input.reason,
        },
      }

      store.claims.set(dismissed.id, dismissed)

      const row = rowOf(claim.id)

      if (row !== undefined) {
        store.rows.splice(store.rows.indexOf(row), 1, { ...row, appealPending: false })
      }

      return HttpResponse.json(defineFixture(claimResponseSchema, { claim: dismissed }))
    }),
  ),

  /**
   * 구매자의 이의 제기.
   *
   * 관리자 앱의 대역에 함께 있는 것은 **한 표를 두 앱이 읽기** 때문이다 — 구매자가
   * 낸 이의가 관리자 목록의 뱃지로 나타나는 것이 이 기능의 전부이고, 대역을 나누면
   * 그 연결을 아무 스펙도 확인할 수 없다.
   */
  http.post(mockPaths.claimAppeal, ({ request, params }) =>
    answering(async () => {
      consumeFailure()

      const input = await readBody(request, fileClaimAppealRequestSchema)
      const claim = claimOr404(pathIdOf(params))

      if (!isRejected(claim)) {
        throw new MockApiError(409, '거절된 클레임에만 이의를 제기할 수 있어요.', {
          code: 'CLAIM_NOT_CLAIMABLE',
          field: 'reason',
        })
      }
      if (claim.appeal !== null) throw new MockApiError(409, '이미 이의를 제기했어요.')

      const appealed: Claim = {
        ...claim,
        appeal: {
          claimId: claim.id,
          filedById: claim.requestedById,
          reason: input.reason,
          filedAt: MOCK_ADMIN_CLAIM_NOW,
          reviewedAt: null,
          reviewedById: null,
          outcome: null,
          reviewNote: null,
        },
      }

      store.claims.set(appealed.id, appealed)

      const row = rowOf(claim.id)

      if (row !== undefined) {
        store.rows.splice(store.rows.indexOf(row), 1, { ...row, appealPending: true })
      }

      return HttpResponse.json(defineFixture(claimResponseSchema, { claim: appealed }), {
        status: 201,
      })
    }),
  ),
]
