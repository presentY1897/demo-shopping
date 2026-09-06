import type {
  CouponListQueryParams,
  CouponListResponse,
  CouponResponse,
  CreateCouponRequest,
} from '@shopping/shared'
import { couponListResponseSchema, couponResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 판매자 콘솔이 쿠폰에 대해 부르는 세 자리, 한 곳에.
 *
 * `lib/claims/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가
 * 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않는다 (게이트 C1).
 *
 * **`/seller/coupons` 가 아니라 `/coupons` 다.** 누가 부를 수 있는지는 퍼미션 표가
 * 한 번 말하고, URL 이 그것을 두 번째로 말하면 언젠가 둘이 어긋난다 —
 * `products` 라우트가 같은 판단을 적어 두었다. 어느 목록인지는 경로가 아니라
 * **`sellerId` 질의**가 정한다.
 */

/** `?sellerId=…&lifecycle=A,B`. `sellerId` 는 이 화면에서 언제나 실린다. */
export function couponSearch(query: CouponListQueryParams): string {
  const params = new URLSearchParams()

  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?lifecycle=a&lifecycle=b`)는 프레임워크마다
  // 다른 것으로 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다.
  if (query.lifecycle !== undefined) params.set('lifecycle', query.lifecycle.join(','))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  // **커서는 불투명하다.** 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 한 페이지의 쿠폰.
 *
 * **`sellerId` 없이 부르지 않는다.** 그것이 빠지면 서버는 플랫폼 쿠폰 목록으로 읽고,
 * 판매자에게는 `coupon.platform` 이 없으므로 403 이 돌아온다 — 즉 「내 쿠폰이 하나도
 * 없다」가 아니라 「권한이 없다」로 끝난다. 그래서 스토어가 없는 계정에는 이 요청을
 * 아예 보내지 않고, 화면이 먼저 입점 신청으로 안내한다.
 */
export function fetchSellerCoupons(
  query: CouponListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CouponListResponse> {
  return getApiClient().request({
    path: `/coupons${couponSearch(query)}`,
    schema: couponListResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * 쿠폰을 발행한다.
 *
 * 답은 **정책 하나**이고 목록의 줄이 아니다. 갓 발행된 쿠폰에는 아직 상태도 통계도
 * 볼 것이 없으므로 계약이 그렇게 정했고, 그래서 발행 뒤에 화면은 목록을 다시 읽는다.
 */
export function createCoupon(body: CreateCouponRequest): Promise<CouponResponse> {
  return getApiClient().request({
    path: '/coupons',
    method: 'POST',
    body,
    schema: couponResponseSchema,
  })
}

/**
 * 발행을 멈추거나 다시 연다.
 *
 * **바꿀 수 있는 것이 이것 하나뿐이다.** 할인율·범위·기간을 고치는 문은 계약에
 * 없다 — 이미 발급된 장은 발급 시점의 조건으로 쓰이므로, 정책만 고치면 같은 쿠폰이
 * 사람마다 다른 뜻을 갖게 된다. 조건이 틀렸으면 멈추고 새로 낸다.
 */
export function setCouponSuspended(couponId: string, suspended: boolean): Promise<CouponResponse> {
  return getApiClient().request({
    path: `/coupons/${couponId}`,
    method: 'PATCH',
    body: { suspended },
    schema: couponResponseSchema,
  })
}
