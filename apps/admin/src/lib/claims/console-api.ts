import type {
  AdminClaimListQuery,
  AdminClaimListResponse,
  AdminFailedRefundListResponse,
  AdminOverdueClaimsResponse,
  ClaimableResponse,
  ClaimResponse,
  CreateAdminClaimRequest,
  DismissClaimAppealRequest,
} from '@shopping/shared'
import {
  adminClaimListResponseSchema,
  adminFailedRefundListResponseSchema,
  adminOverdueClaimsResponseSchema,
  claimableResponseSchema,
  claimResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 관리자 콘솔이 클레임에 대해 부르는 일곱 자리, 한 곳에.
 *
 * `lib/sellers/api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가 한
 * 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않는다 (게이트 C1).
 *
 * **둘이 `/admin` 아래가 아니다.** 클레임 하나를 읽는 것은 여전히 `GET /claims/:id`
 * 이고, 「이 몫에 무엇을 신청할 수 있나」도 여전히
 * `GET /seller-orders/:id/claimable` 이다 — 관리자의 `claim.read` 가 `any` 라 둘 다
 * 구매자·판매자와 같은 문으로 읽는다. `AdminClaimController` 에 그 라우트들이
 * **없는 것**이 서버의 판단이고, 거기 만들면 같은 것을 답하는 문이 둘이 된다.
 */

/** `?status=A&stage=WAITING&from=…`, 아무것도 없으면 빈 문자열. */
export function adminClaimSearch(query: AdminClaimListQuery): string {
  const params = new URLSearchParams()

  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  if (query.buyerId !== undefined) params.set('buyerId', query.buyerId)
  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?status=a&status=b`)는 프레임워크마다 다른
  // 것으로 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다.
  if (query.status !== undefined) params.set('status', query.status.join(','))
  if (query.stage !== undefined) params.set('stage', query.stage)
  if (query.type !== undefined) params.set('type', query.type)
  if (query.from !== undefined) params.set('from', query.from)
  if (query.to !== undefined) params.set('to', query.to)
  // `'false'` 는 보내지 않는다 — 계약이 그것을 「이의만 보기를 껐다」로 읽지만,
  // 필터가 없는 것과 같은 뜻이라 질의에 남길 이유가 없다.
  if (query.appealed === true) params.set('appealed', 'true')
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 한 페이지. 최신순이고 커서는 `id` 하나다. */
export function fetchAdminClaims(
  query: AdminClaimListQuery,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminClaimListResponse> {
  return getApiClient().request({
    path: `/admin/claims${adminClaimSearch(query)}`,
    schema: adminClaimListResponseSchema,
    ...options,
  })
}

/**
 * 기한을 넘긴 채 처리를 기다리는 클레임.
 *
 * **목록의 필터가 아니라 라우트다.** 기한은 영업일로 세고 SQL 은 주말을 모르므로,
 * 서버가 넘치게 읽고 정확히 거른다 — 그래서 답에 `scanned` 와 `truncated` 가 붙는다.
 */
export function fetchOverdueClaims(
  limit: number,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminOverdueClaimsResponse> {
  return getApiClient().request({
    path: `/admin/claims/overdue?limit=${String(limit)}`,
    schema: adminOverdueClaimsResponseSchema,
    ...options,
  })
}

/**
 * 나가지 못한 환불.
 *
 * 경로가 `claim-refunds` 인 것은 세는 단위가 클레임이 아니라 **환불**이기 때문이다.
 * 커서가 없는 것도 계약의 판단이다 — 페이지가 필요한 실패 목록은 이미 사고다.
 */
export function fetchFailedRefunds(
  limit: number,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminFailedRefundListResponse> {
  return getApiClient().request({
    path: `/admin/claim-refunds/failed?limit=${String(limit)}`,
    schema: adminFailedRefundListResponseSchema,
    ...options,
  })
}

/**
 * 「이 몫에 지금 무엇을 몇 개까지 신청할 수 있나」 — 확정 후 하자 반품의 시작점 (F4).
 *
 * **`/admin` 아래가 아닌 두 번째 라우트다.** 관리자가 이 문을 지날 수 있는 이유는
 * `claim.read` 가 `any` 라는 사실 하나이고(`ClaimService.actorFor` 의 마지막 갈래가
 * 가게 소유권으로 인가한다), 그래서 구매자·판매자와 같은 문으로 읽는다.
 *
 * **답이 구매자의 판정인 것을 알고 부른다.** 확정된 몫에는 `type: null` ·
 * `refusal: 'confirmed'` 가 오는데, 이 화면에서 그 거절은 **진입 조건**이다 —
 * 왜 그런지는 `defect-return.ts` 가 적어 두었다.
 */
export function fetchClaimable(
  sellerOrderId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ClaimableResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/claimable`,
    schema: claimableResponseSchema,
    ...options,
  })
}

/** 클레임 하나 — 항목 · 이력 · 이의 · 개입의 두 방향이 한 응답에 있다. */
export function fetchClaim(
  claimId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ClaimResponse> {
  return getApiClient().request({
    path: `/claims/${claimId}`,
    schema: claimResponseSchema,
    ...options,
  })
}

/**
 * 강제 처리 — **답은 원본이 아니라 방금 만들어진 개입이다.**
 *
 * 이 한 자리가 거절 뒤집기의 전부다. 인용에 해당하는 라우트가 따로 없는 것이 서버의
 * 설계 판단이고(인용은 강제 처리 그 자체다), 걸려 있던 이의는 같은 트랜잭션에서
 * 닫힌다.
 */
export function forceClaim(body: CreateAdminClaimRequest): Promise<ClaimResponse> {
  return getApiClient().request({
    path: '/admin/claims',
    method: 'POST',
    body,
    schema: claimResponseSchema,
  })
}

/** 이의 기각 — 사유가 필수다. 클레임은 거절된 채 그대로 남는다. */
export function dismissClaimAppeal(
  claimId: string,
  body: DismissClaimAppealRequest,
): Promise<ClaimResponse> {
  return getApiClient().request({
    path: `/admin/claims/${claimId}/appeal/dismiss`,
    method: 'POST',
    body,
    schema: claimResponseSchema,
  })
}
