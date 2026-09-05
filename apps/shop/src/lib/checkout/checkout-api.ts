import type { CheckoutResponse, OrderResponse } from '@shopping/shared'
import {
  API_PATH_PREFIX,
  APP_ID_HEADER,
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

export function readCheckout(
  id: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CheckoutResponse> {
  return getApiClient().request({
    path: `/checkouts/${id}`,
    schema: checkoutResponseSchema,
    ...options,
  })
}

export function placeOrder(checkoutId: string, addressId: string): Promise<OrderResponse> {
  return getApiClient().request({
    path: '/orders',
    method: 'POST',
    body: { checkoutId, addressId },
    schema: orderResponseSchema,
  })
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
