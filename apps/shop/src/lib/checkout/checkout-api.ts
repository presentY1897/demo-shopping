import type { CheckoutCouponsResponse, CheckoutResponse, OrderResponse } from '@shopping/shared'
import {
  API_PATH_PREFIX,
  APP_ID_HEADER,
  checkoutCouponsResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'

import { apiBaseUrl, APP_ID, getSessionClient } from '@/lib/api'
import { getApiClient } from '@/lib/api'

/**
 * 주문서를 열고 · 읽고 · 닫는다 (TASK-0050 4.1).
 *
 * 여는 것은 **장바구니**다. 주문서 화면이 진입과 동시에 열면 새로고침 한 번에
 * 예약이 한 벌 더 잡힌다.
 */

export function openCheckout(itemIds: readonly string[]): Promise<CheckoutResponse> {
  return getApiClient().request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds: [...itemIds] },
    schema: checkoutResponseSchema,
  })
}

export interface ReadCheckoutOptions {
  readonly signal?: AbortSignal
  /**
   * 지금 고른 쿠폰 (TASK-0075).
   *
   * **주문서에 저장되지 않는다.** 고른 것은 화면이 들고 있고 읽을 때마다 함께
   * 보낸다 — 서버에 두면 「고르기」가 상태를 바꾸는 요청이 되고, 그때부터
   * 새로고침·뒤로가기·두 번째 탭이 각각 다른 주문서를 본다 (계약의
   * `checkoutQueryParamsSchema` 가 같은 말을 한다).
   */
  readonly userCouponIds?: readonly string[]
}

export function readCheckout(
  id: string,
  { userCouponIds = [], ...options }: ReadCheckoutOptions = {},
): Promise<CheckoutResponse> {
  return getApiClient().request({
    path: `/checkouts/${id}${selectionQuery(userCouponIds)}`,
    schema: checkoutResponseSchema,
    ...options,
  })
}

/**
 * 이 주문서에 쓸 수 있는 쿠폰과 추천 조합 (TASK-0075).
 *
 * **선택을 보내지 않는다.** 목록의 `discountAmount` 는 「이 장 하나만 썼을 때」라
 * 무엇을 골랐든 달라지지 않는다 — 고른 뒤의 금액은 주문서 쪽에 있고
 * (`checkout.appliedCoupons`), 이 목록은 **고르기 전에** 읽는 값이다. 선택을
 * 실어 보내면 고를 때마다 두 요청이 나가고 둘 중 하나는 늘 같은 답을 준다.
 */
export function readCheckoutCoupons(
  id: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CheckoutCouponsResponse> {
  return getApiClient().request({
    path: `/checkouts/${id}/coupons`,
    schema: checkoutCouponsResponseSchema,
    ...options,
  })
}

/**
 * 주문을 만든다.
 *
 * **쿠폰은 화면이 보여 준 그 선택 그대로 실린다** (계약). 서버가 「마지막에 본
 * 선택」을 기억해 두는 길도 있었지만, 그러면 두 탭에서 각각 고른 사람의 주문이
 * 어느 쪽 선택으로 만들어지는지를 아무도 말할 수 없다.
 */
export function placeOrder(
  checkoutId: string,
  addressId: string,
  userCouponIds: readonly string[] = [],
): Promise<OrderResponse> {
  return getApiClient().request({
    path: '/orders',
    method: 'POST',
    body: { checkoutId, addressId, userCouponIds: [...userCouponIds] },
    schema: orderResponseSchema,
  })
}

/**
 * 쿼리스트링 조각 — 고른 것이 있을 때만.
 *
 * 빈 선택에 `?userCouponIds=` 를 붙이지 않는 이유는 그것이 **빈 문자열 하나짜리
 * 배열**로 파싱되기 때문이다 (계약의 `selectedUserCouponIdsQuerySchema` 가
 * 쉼표로 나눈다). 그러면 아무것도 안 고른 사람의 요청이 uuid 가 아닌 id 하나를
 * 고른 요청이 되어 400 으로 돌아온다.
 */
function selectionQuery(userCouponIds: readonly string[]): string {
  if (userCouponIds.length === 0) return ''

  return `?userCouponIds=${userCouponIds.join(',')}`
}

/**
 * 이탈. 페이지가 사라지는 중에도 도착해야 한다 (4.4 · R2).
 *
 * `fetch` 는 브라우저가 취소한다 — 문서가 사라지는 중의 요청은 지켜 줄 이유가
 * 없기 때문이다. `sendBeacon` 은 그 상황을 위한 것이고, 대신 **메서드를 고를 수
 * 없다**: 언제나 `POST` 다. 그래서 서버의 `DELETE` 대신 같은 경로에 `POST` 를
 * 보내지 않고, 여기서는 `keepalive` 를 단 `fetch` 를 쓴다 — `DELETE` 를 그대로
 * 보낼 수 있고 `sendBeacon` 과 같은 보장을 받는다.
 *
 * 그래도 강제 종료에는 신호가 없다. 최종 안전망은 만료 스케줄러(TASK-0051)다.
 */
export function closeCheckoutOnLeave(id: string): void {
  const token = getSessionClient().accessToken()
  const headers: Record<string, string> = { [APP_ID_HEADER]: APP_ID }

  if (token !== null) headers.Authorization = `Bearer ${token}`

  void fetch(`${apiBaseUrl()}${API_PATH_PREFIX}/checkouts/${id}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
    keepalive: true,
  }).catch(() => {
    // 떠나는 중이다. 실패해도 할 수 있는 일이 없고, 스케줄러가 받는다.
  })
}
