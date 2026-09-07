import type {
  ApiCallOptions,
  FollowIdsResponse,
  FollowListResponse,
  FollowResult,
  MergeRecentlyViewedRequest,
  RecentlyViewedResponse,
  RestockAlertResult,
  ToggleResult,
  WishlistIdsResponse,
  WishlistResponse,
} from '@shopping/shared'
import {
  followIdsResponseSchema,
  followListResponseSchema,
  followResultSchema,
  recentlyViewedResponseSchema,
  restockAlertResultSchema,
  toggleResultSchema,
  wishlistIdsResponseSchema,
  wishlistResponseSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'

/**
 * 찜 · 최근 본 상품 · 팔로우가 부르는 라우트들 (TASK-0086 · 0087 · 0089).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 전부 `@shopping/shared` 의 zod
 * 스키마로 파싱하므로, 서버가 필드 이름을 바꾸면 화면이 그것을 잘못 그리는 것이
 * 아니라 `malformed_response` 로 즉시 실패한다.
 *
 * **경로에 사용자 id 가 없다.** 주인은 토큰이 정한다 — 남의 목록을 만들 자리가 애초에
 * 없고, 실어 보내지 않는 값은 조작할 수도 없다 (`collections.controller.ts` 의 같은
 * 문장).
 *
 * **전부 세션이 붙은 클라이언트다.** 여기 있는 것 중 로그인 없이 열리는 문은 하나도
 * 없고, 그래서 화면은 로그인하지 않은 사람을 이 함수들 앞까지 데려오지 않는다 —
 * 눌러서 401 을 받는 것은 사람이 고칠 수 없는 실패다 (TASK-0086 F6).
 */

/** `DELETE` 들은 204 다. 본문이 없다는 것도 계약이므로 스키마로 적는다. */
const noContentSchema = z.undefined()

/**
 * 찜을 켜고 끈다 (F1 · F2).
 *
 * **답이 곧 지금 상태다.** `{ active }` 가 오므로 화면이 「눌렀으니 켜졌겠지」로
 * 세지 않는다 — 세면 다른 탭에서 이미 뺀 것이 반영되지 않고, 두 번 눌러도 한 번인
 * 서버의 규칙을 화면이 두 번으로 그린다. 낙관적 갱신이 틀렸을 때 되돌릴 값도 이
 * 답 안에 있다 (`toggleResultSchema` 의 머리말).
 */
export function toggleWishlist(productId: string, options?: ApiCallOptions): Promise<ToggleResult> {
  return getApiClient().request({
    path: `/me/wishlist/${encodeURIComponent(productId)}`,
    method: 'POST',
    schema: toggleResultSchema,
    ...options,
  })
}

/**
 * 찜 목록 한 쪽 (F3).
 *
 * 질의를 문자열로 조립하지 않고 `URLSearchParams` 에 담는 이유는 **빈 값을 보내지
 * 않기 위해서**다. `?cursor=` 는 「처음부터」가 아니라 빈 문자열이고, 계약은 그것을
 * 커서로 읽으려 한다.
 */
export function fetchWishlist(
  cursor: string | null,
  limit: number,
  options?: ApiCallOptions,
): Promise<WishlistResponse> {
  const search = new URLSearchParams({ limit: String(limit) })

  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/me/wishlist?${search.toString()}`,
    schema: wishlistResponseSchema,
    ...options,
  })
}

/**
 * 담아 둔 상품의 **id 만**, 한 번에 전부 (F1).
 *
 * 목록과 나란히 있는 이유는 둘이 다른 물음에 답하기 때문이다 — 목록은 「무엇을
 * 담았나」이고 이쪽은 「이것을 담았나」다. 뒤쪽을 목록으로 답하면 101개를 담은
 * 사람의 화면이 조용히 틀린다(`wishlist-state.ts` 의 머리말).
 *
 * **커서가 없는 것이 요점이다.** 페이지가 있으면 「여기 없다」가 「담지 않았다」를
 * 뜻하지 못한다.
 */
export function fetchWishlistIds(options?: ApiCallOptions): Promise<WishlistIdsResponse> {
  return getApiClient().request({
    path: '/me/wishlist/ids',
    schema: wishlistIdsResponseSchema,
    ...options,
  })
}

/**
 * 재입고되면 알려 달라고 신청하거나, 신청을 무른다 (F4).
 *
 * **토글이 아니라 켜기·끄기다.** 이 버튼이 놓이는 자리가 품절 줄이고, 거기서 사람이
 * 하려는 일은 언제나 「켜기」이기 때문이다 — 토글이면 이미 신청해 둔 줄의 버튼이
 * 「신청」이라고 적힌 채 신청을 취소한다.
 *
 * **찜한 것에만 걸 수 있다.** 찜하지 않은 상품이면 서버가 404 로 답하고, 그것은
 * 이 화면이 만들 수 없는 요청이다 — 목록의 줄은 전부 찜한 것이다.
 */
export function setRestockAlert(
  productId: string,
  wanted: boolean,
  options?: ApiCallOptions,
): Promise<RestockAlertResult> {
  return getApiClient().request({
    path: `/me/wishlist/${encodeURIComponent(productId)}/restock-alert`,
    method: wanted ? 'POST' : 'DELETE',
    schema: restockAlertResultSchema,
    ...options,
  })
}

/**
 * 최근 본 상품 (TASK-0087).
 *
 * **커서가 없다.** 계약이 최대 50개로 묶어 두므로(`RECENTLY_VIEWED_MAX`) 한 번에
 * 전부 온다 — 그 상한이 없으면 이 표가 사람마다 무한히 자라고, 그 목록은 아무도
 * 끝까지 보지 않는다.
 *
 * **상세를 볼 때 화면이 보내는 것은 없다.** 기록은 로그인한 사람의 상세 조회에서
 * 서버가 비동기로 남긴다(4장). 화면이 조회마다 `POST` 를 하나 더 보내면 그것은
 * 상세 화면이 늦게 뜨는 이유가 되고, 그 요청이 실패하면 조회까지 실패한 것처럼 보인다.
 */
export function fetchRecentlyViewed(options?: ApiCallOptions): Promise<RecentlyViewedResponse> {
  return getApiClient().request({
    path: '/me/recently-viewed',
    schema: recentlyViewedResponseSchema,
    ...options,
  })
}

/**
 * 로그인하지 않고 본 이력을 합친다 (F6).
 *
 * **답이 합쳐진 목록 전체다.** 그래서 화면은 보내고 나서 다시 읽지 않는다 — 다시
 * 읽으면 왕복이 둘이 되고, 그 둘 사이에 다른 탭이 상품 하나를 더 볼 수 있다.
 *
 * 모르는 상품은 서버가 **건너뛴다.** 브라우저에 남아 있던 이력이 그사이 내려간
 * 상품을 가리켜도 병합 전체가 실패하지 않는다.
 */
export function mergeRecentlyViewed(
  body: MergeRecentlyViewedRequest,
  options?: ApiCallOptions,
): Promise<RecentlyViewedResponse> {
  return getApiClient().request({
    path: '/me/recently-viewed',
    method: 'POST',
    body,
    schema: recentlyViewedResponseSchema,
    ...options,
  })
}

/** 이력에서 하나를 지운다 (F7). */
export async function forgetView(productId: string, options?: ApiCallOptions): Promise<void> {
  await getApiClient().request({
    path: `/me/recently-viewed/${encodeURIComponent(productId)}`,
    method: 'DELETE',
    schema: noContentSchema,
    ...options,
  })
}

/** 이력을 전부 지운다 (F7). */
export async function forgetAllViews(options?: ApiCallOptions): Promise<void> {
  await getApiClient().request({
    path: '/me/recently-viewed',
    method: 'DELETE',
    schema: noContentSchema,
    ...options,
  })
}

/**
 * 팔로우를 켜고 끈다 (TASK-0089 F1 · F3).
 *
 * **팔로워 수가 답에 함께 온다.** 화면이 ±1 을 하지 않는 이유가 그것이다 — 두 탭에서
 * 누른 사람의 화면이 서로 다른 수를 그리고, 어느 쪽도 맞지 않는다
 * (`followResultSchema` 의 머리말).
 */
export function toggleFollow(sellerId: string, options?: ApiCallOptions): Promise<FollowResult> {
  return getApiClient().request({
    path: `/me/follows/${encodeURIComponent(sellerId)}`,
    method: 'POST',
    schema: followResultSchema,
    ...options,
  })
}

/** 내가 팔로우한 브랜드 한 쪽. */
export function fetchFollows(
  cursor: string | null,
  limit: number,
  options?: ApiCallOptions,
): Promise<FollowListResponse> {
  const search = new URLSearchParams({ limit: String(limit) })

  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/me/follows?${search.toString()}`,
    schema: followListResponseSchema,
    ...options,
  })
}

/**
 * 팔로우한 가게의 **id 만**, 최근에 팔로우한 순서로 (TASK-0089 4.4).
 *
 * 순서가 계약의 일부다. 홈의 「팔로우한 브랜드의 신상품」이 이 목록을 앞에서부터
 * 50개로 자르므로(4.6), 순서가 없으면 그 줄이 새로고침할 때마다 다른 가게로 바뀐다.
 */
export function fetchFollowIds(options?: ApiCallOptions): Promise<FollowIdsResponse> {
  return getApiClient().request({
    path: '/me/follows/ids',
    schema: followIdsResponseSchema,
    ...options,
  })
}
