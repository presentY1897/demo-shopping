import type {
  BulkIssueResponse,
  BulkIssueTarget,
  CouponListQueryParams,
  CouponListResponse,
  CouponResponse,
  CreateCouponRequest,
} from '@shopping/shared'
import {
  bulkIssueResponseSchema,
  couponListResponseSchema,
  couponResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 관리자 콘솔이 쿠폰에 대해 부르는 네 자리, 한 곳에.
 *
 * `lib/claims/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가
 * 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않는다 (게이트 C1).
 *
 * **`/admin` 아래가 아니다.** 관리자와 판매자가 같은 라우트를 쓰고, 어느 목록인지는
 * `sellerId` 가 정한다 — 「누가 부를 수 있는가」는 퍼미션 표가 한 번 말하고, 경로가
 * 그것을 두 번째로 말하면 언젠가 둘이 어긋난다(`coupon.controller.ts` 의 판단).
 *
 * **`sellerId` 를 싣는 함수가 없다.** 이 화면이 다루는 것은 플랫폼 부담 쿠폰뿐이고,
 * 그 사실이 질의에 값을 넣지 **않는 것**으로 표현된다. 판매자 쿠폰을 대신 발행하는
 * 문은 TASK-0074 의 것이다.
 */

/** `?lifecycle=ACTIVE&from=…&cursor=…`, 아무것도 없으면 빈 문자열. */
export function couponSearch(query: CouponListQueryParams): string {
  const params = new URLSearchParams()

  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?lifecycle=a&lifecycle=b`)는 프레임워크마다
  // 다른 것으로 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다.
  if (query.lifecycle !== undefined) params.set('lifecycle', query.lifecycle.join(','))
  // 기간은 **순간**으로 간다. 날짜를 그대로 보내면 계약이 거절하고, 하루의 경계를
  // 서버가 정하게 되어 콘솔마다 다른 구간이 된다 (`queryOf` 가 한국 시간으로 편다).
  if (query.from !== undefined) params.set('from', query.from)
  if (query.to !== undefined) params.set('to', query.to)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 한 페이지. 최신순이고 커서는 `id` 하나다. */
export function fetchPlatformCoupons(
  query: CouponListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CouponListResponse> {
  return getApiClient().request({
    path: `/coupons${couponSearch(query)}`,
    schema: couponListResponseSchema,
    ...options,
  })
}

/**
 * 쿠폰을 낸다 — **`sellerId: null` 이 곧 「플랫폼 부담」이다.**
 *
 * 부담 주체를 따로 보내지 않는다. 계약이 그 조합을 표현할 수 없게 만들어 두었고
 * (`createCouponRequestSchema`), 그래서 화면에도 「누가 부담하나」를 고르는 칸이 없다.
 */
export function createPlatformCoupon(body: CreateCouponRequest): Promise<CouponResponse> {
  return getApiClient().request({
    path: '/coupons',
    method: 'POST',
    body,
    schema: couponResponseSchema,
  })
}

/**
 * 발행을 멈추거나 다시 연다 (F5).
 *
 * **이미 발급된 장은 그대로다.** 이 라우트로 바꿀 수 있는 것이 이것 하나뿐인 이유도
 * 같다 — 할인율과 기간을 고치면 같은 쿠폰이 사람마다 다른 뜻을 갖는다.
 */
export function setCouponSuspended(couponId: string, suspended: boolean): Promise<CouponResponse> {
  return getApiClient().request({
    path: `/coupons/${couponId}`,
    method: 'PATCH',
    body: { suspended },
    schema: couponResponseSchema,
  })
}

/**
 * 조건에 맞는 회원에게 한꺼번에 지급한다 (F4).
 *
 * 답이 세 숫자인 것이 이 자리의 전부다 — 나간 수, 이미 갖고 있어 건너뛴 수, 그리고
 * **아직 남은 수**. 마지막 것이 0이 아니면 한 번의 상한에 걸린 것이고, 다시 누르면
 * 이어서 나간다.
 */
export function bulkIssueCoupon(
  couponId: string,
  target: BulkIssueTarget,
): Promise<BulkIssueResponse> {
  return getApiClient().request({
    path: `/coupons/${couponId}/issues/bulk`,
    method: 'POST',
    body: { target },
    schema: bulkIssueResponseSchema,
  })
}
