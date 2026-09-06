import type {
  ClaimTransitionRequest,
  ClaimTransitionResponse,
  InspectReturnRequest,
  ReturnResponse,
  SellerClaimDetailResponse,
  SellerClaimListQuery,
  SellerClaimListResponse,
  SellerClaimSummaryResponse,
} from '@shopping/shared'
import {
  claimTransitionResponseSchema,
  returnResponseSchema,
  sellerClaimDetailResponseSchema,
  sellerClaimListResponseSchema,
  sellerClaimSummaryResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 판매자 콘솔이 클레임에 대해 부르는 여섯 자리, 한 곳에.
 *
 * `lib/orders/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가
 * 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않는다 (게이트 C1).
 *
 * **읽기 셋은 `/seller-claims` 아래이고 쓰기 셋은 아니다.** 쓰기는 이미 있던
 * 라우트(`/claims/:id/transitions` · `/returns/:claimId/…`)이고, 판매자용으로 한 벌 더
 * 만들지 않는다 — 같은 일을 하는 두 문이 생기는 순간 전이표는 한쪽에만 적용된다.
 */

/** `?stage=WAITING&status=A,B`, 아무것도 없으면 빈 문자열. */
export function sellerClaimSearch(query: SellerClaimListQuery): string {
  const params = new URLSearchParams()

  if (query.stage !== undefined) params.set('stage', query.stage)
  if (query.type !== undefined) params.set('type', query.type)
  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?status=a&status=b`)는 프레임워크마다 다른
  // 것으로 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다.
  if (query.status !== undefined) params.set('status', query.status.join(','))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  // **커서는 불투명하다.** 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 한 페이지. 단계가 없으면 전부이고, 그때도 대기가 먼저 온다. */
export function fetchSellerClaims(
  query: SellerClaimListQuery,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerClaimListResponse> {
  return getApiClient().request({
    path: `/seller-claims${sellerClaimSearch(query)}`,
    schema: sellerClaimListResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * 상태별·단계별 건수와 처리 대기.
 *
 * 목록과 **다른 요청**이다. 같은 응답에 실으면 숫자가 필터를 따라 움직이고, 그러면
 * 그것은 뱃지가 아니라 「지금 보고 있는 목록의 개수」가 된다.
 */
export function fetchSellerClaimSummary(
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerClaimSummaryResponse> {
  return getApiClient().request({
    path: '/seller-claims/summary',
    schema: sellerClaimSummaryResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * 클레임 하나 — 항목 · 사진 · 환불 예정액 · 기한 · 버튼이 **한 응답**에.
 *
 * 넷으로 나눠 부르면 네 응답이 서로 다른 순간을 보고, 그때 판매자는 「1,000원」을
 * 보면서 「2,000원」을 승인한다 (`sellerClaimDetailSchema` 가 적어 둔 그대로다).
 */
export function fetchSellerClaim(
  claimId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerClaimDetailResponse> {
  return getApiClient().request({
    path: `/seller-claims/${claimId}`,
    schema: sellerClaimDetailResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** 승인 · 거절. 수거와 검수는 이 문이 아니다 — 아래 둘을 본다. */
export function transitionClaim(
  claimId: string,
  body: ClaimTransitionRequest,
): Promise<ClaimTransitionResponse> {
  return getApiClient().request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body,
    schema: claimTransitionResponseSchema,
  })
}

/**
 * 수거 — **회수 운송장이 함께 난다.**
 *
 * 전이 라우트로 `PICKING_UP` 을 찍으면 상태만 옮겨지고 운송장은 나지 않는다. 그러면
 * 구매자는 어디에 물건을 맡겨야 하는지 모른 채 「회수 중」인 화면을 본다.
 */
export function pickUpReturn(claimId: string): Promise<ReturnResponse> {
  return getApiClient().request({
    path: `/returns/${claimId}/pickup`,
    method: 'POST',
    schema: returnResponseSchema,
  })
}

/**
 * 검수 — **합격 여부가 환불을 가른다.**
 *
 * 전이 라우트로 `RETURN_COMPLETED` 를 찍으면 검수 결과가 적히지 않고 환불도 시작되지
 * 않는다. 「반품완료인데 아무 일도 일어나지 않은 반품」이 정확히 그것이다.
 */
export function inspectReturn(
  claimId: string,
  body: InspectReturnRequest,
): Promise<ReturnResponse> {
  return getApiClient().request({
    path: `/returns/${claimId}/inspection`,
    method: 'POST',
    body,
    schema: returnResponseSchema,
  })
}
