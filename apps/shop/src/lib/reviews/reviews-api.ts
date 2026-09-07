import type {
  ApiCallOptions,
  CreateReviewRequest,
  ReviewHelpfulResponse,
  ReviewListQueryParams,
  ReviewListResponse,
  ReviewResponse,
  ReviewableListResponse,
  UpdateReviewRequest,
} from '@shopping/shared'
import {
  reviewHelpfulResponseSchema,
  reviewListResponseSchema,
  reviewResponseSchema,
  reviewableListResponseSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'

/**
 * 리뷰가 부르는 라우트들 (TASK-0083 · TASK-0084).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 전부 `@shopping/shared` 의 zod
 * 스키마로 파싱하므로, 서버가 필드 이름을 바꾸면 화면이 그것을 잘못 그리는 것이 아니라
 * `malformed_response` 로 즉시 실패한다.
 *
 * **경로에 사용자 id 가 없다.** 주인은 토큰이 정한다 — 남의 리뷰를 고치거나 지울 자리가
 * 애초에 없고, 그 판정은 서버가 행에서 읽어 한다(F4).
 *
 * **읽기도 세션이 붙은 클라이언트로 부른다.** 상품 상세의 목록은 로그인하지 않아도
 * 열리지만(`@PublicEndpoint()`), `helpfulByMe` 만은 부르는 사람에 따라 달라진다 —
 * `getPublicApiClient()` 로 부르면 로그인한 사람에게도 언제나 `false` 가 와서
 * **눌러 둔 버튼이 매번 풀린 채로** 그려진다.
 */

/** `DELETE /reviews/:id` 는 204 다. 본문이 없다는 것도 계약이므로 스키마로 적는다. */
const noContentSchema = z.undefined()

/**
 * 이 상품의 리뷰 한 쪽과 평점 요약.
 *
 * 질의를 문자열로 조립하지 않고 `URLSearchParams` 에 담는 이유는 **빈 값을 보내지
 * 않기 위해서**다. `?sort=&photoOnly=` 는 「기본값」이 아니라 빈 문자열이고, 계약의
 * `z.stringbool()` 은 그것을 400 으로 답한다.
 */
export function fetchProductReviews(
  productId: string,
  query: ReviewListQueryParams,
  options?: ApiCallOptions,
): Promise<ReviewListResponse> {
  const search = new URLSearchParams()

  if (query.sort !== undefined) search.set('sort', query.sort)
  if (query.photoOnly === true) search.set('photoOnly', 'true')
  if (query.cursor !== undefined) search.set('cursor', query.cursor)
  if (query.limit !== undefined) search.set('limit', String(query.limit))

  return getApiClient().request({
    path: `/products/${encodeURIComponent(productId)}/reviews${suffix(search)}`,
    schema: reviewListResponseSchema,
    ...options,
  })
}

/**
 * 아직 리뷰를 쓸 수 있는 주문 항목 (F7).
 *
 * **쓸 수 있는 것만 온다.** 「쓸 수 없는 이유」까지 실어 전부 내려보내는 길도 있었지만
 * 그러면 이 목록이 「배송 중인 주문」 목록과 겹쳐 두 화면이 같은 것을 서로 다르게
 * 말한다 (`reviewableListResponseSchema`). 못 쓰는 이유는 **쓰려고 할 때** 온다.
 */
export function fetchReviewableItems(
  cursor: string | null,
  options?: ApiCallOptions,
): Promise<ReviewableListResponse> {
  const search = new URLSearchParams()

  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/me/reviewable-items${suffix(search)}`,
    schema: reviewableListResponseSchema,
    ...options,
  })
}

/**
 * 산 것에 리뷰를 쓴다.
 *
 * **가리키는 것은 상품이 아니라 주문 항목이다.** 상품을 보내면 「이 사람이 그 상품을
 * 샀는가」를 서버가 물어야 하고 그 물음은 우회 경로가 생기는 날 뚫리는데, 주문 항목을
 * 보내면 그 행이 없는 사람은 애초에 아무것도 가리킬 수 없다 (TASK-0083 4장).
 */
export function createReview(
  body: CreateReviewRequest,
  options?: ApiCallOptions,
): Promise<ReviewResponse> {
  return getApiClient().request({
    path: '/reviews',
    method: 'POST',
    body,
    schema: reviewResponseSchema,
    ...options,
  })
}

/**
 * 기한 안에서 고친다 (F5).
 *
 * `imageKeys` 는 **대입이지 병합이 아니다.** 보내지 않은 열쇠는 떨어지므로, 부르는
 * 쪽은 언제나 「지금 붙어 있어야 할 전부」를 싣는다 (`usePhotoUploads.reset`).
 */
export function updateReview(
  id: string,
  body: UpdateReviewRequest,
  options?: ApiCallOptions,
): Promise<ReviewResponse> {
  return getApiClient().request({
    path: `/reviews/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body,
    schema: reviewResponseSchema,
    ...options,
  })
}

/** 지운다. 서버에서는 행이 남는다 — 다시 쓸 수 없고, 신고가 가리키던 자리도 남는다. */
export async function deleteReview(id: string, options?: ApiCallOptions): Promise<void> {
  await getApiClient().request({
    path: `/reviews/${encodeURIComponent(id)}`,
    method: 'DELETE',
    schema: noContentSchema,
    ...options,
  })
}

/**
 * 도움이 됐다고 누르거나, 누른 것을 무른다 (TASK-0084 F1).
 *
 * **답이 곧 다음 상태다.** `{ helpfulCount, helpfulByMe }` 가 오므로 화면이 직접 세지
 * 않는다 — 세면 다른 탭에서 누른 것이 반영되지 않고, 두 번 눌러도 한 번인 서버의
 * 규칙을 화면이 두 번으로 그린다.
 */
export function voteHelpful(
  id: string,
  helpful: boolean,
  options?: ApiCallOptions,
): Promise<ReviewHelpfulResponse> {
  return getApiClient().request({
    path: `/reviews/${encodeURIComponent(id)}/helpful`,
    method: helpful ? 'POST' : 'DELETE',
    schema: reviewHelpfulResponseSchema,
    ...options,
  })
}

/** 빈 질의는 `?` 조차 붙이지 않는다 — 붙이면 캐시 열쇠가 둘로 갈린다. */
function suffix(search: URLSearchParams): string {
  return search.size === 0 ? '' : `?${search.toString()}`
}
