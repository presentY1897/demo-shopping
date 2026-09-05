import type {
  ApiCallOptions,
  OrderListQuery,
  OrderListResponse,
  OrderResponse,
  OrderStatus,
  SellerOrderActionsResponse,
  SellerOrderTransitionResponse,
} from '@shopping/shared'
import {
  orderListResponseSchema,
  orderResponseSchema,
  sellerOrderActionsResponseSchema,
  sellerOrderTransitionResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 주문 내역이 부르는 네 라우트 (TASK-0063).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 넷 다 `@shopping/shared` 의 zod
 * 스키마로 파싱하므로, 서버가 필드 이름을 바꾸면 화면이 그것을 잘못 그리는 것이
 * 아니라 `malformed_response` 로 즉시 실패한다.
 *
 * **경로에 사용자 id 가 없다.** 주인은 토큰이 정한다 — `/cart` · `/me` 와 같은
 * 모양이고, 남의 주문을 가리킬 자리가 애초에 없다.
 */

/**
 * 내 주문 목록. 최신순, **상태·기간으로 걸러서**, 커서 페이지네이션.
 *
 * 질의는 계약이 정한 모양 그대로다 (`orderListQuerySchema`) — 상태는 **쉼표로 이은
 * 목록**이고 기간은 ISO 시각이다. 쿼리스트링에 배열이 없어 반복 키를 쓰면
 * 프레임워크마다 다르게 파싱되기 때문이고, 판매자 목록이 같은 이유로 같은 문법을
 * 쓴다 — 두 목록이 다른 문법을 쓰면 그 차이를 아무도 설명할 수 없다.
 *
 * 조건을 만드는 것은 `order-filters.ts` 다. 여기서는 그것을 문자열로 옮기기만
 * 한다 — 「기간이 몇 달인가」를 이 파일이 알면 그 규칙이 두 곳에 산다.
 */
export function fetchOrders(
  cursor: string | null,
  query: OrderListQuery = {},
  options?: ApiCallOptions,
): Promise<OrderListResponse> {
  const search = new URLSearchParams()

  if (query.status !== undefined) search.set('status', query.status.join(','))
  if (query.from !== undefined) search.set('from', query.from)
  if (query.to !== undefined) search.set('to', query.to)
  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: search.size === 0 ? '/orders' : `/orders?${search.toString()}`,
    schema: orderListResponseSchema,
    ...options,
  })
}

/** 주문 하나. 묶음마다 상태와 배송이 들어 있다. */
export function fetchOrder(id: string, options?: ApiCallOptions): Promise<OrderResponse> {
  return getApiClient().request({
    path: `/orders/${id}`,
    schema: orderResponseSchema,
    ...options,
  })
}

/**
 * 이 묶음에 **지금 이 사람이** 할 수 있는 것.
 *
 * 화면이 상태로 분기하지 않게 하는 답이다 (`state-machines.md` 1장). 구매자에게
 * 돌아오는 것은 배송완료 묶음의 구매확정 하나뿐이지만, 그 판단을 화면에 적으면
 * 규칙이 바뀔 때 세 앱 중 한 곳만 고쳐진다.
 */
export function fetchSellerOrderActions(
  sellerOrderId: string,
  options?: ApiCallOptions,
): Promise<SellerOrderActionsResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/actions`,
    schema: sellerOrderActionsResponseSchema,
    ...options,
  })
}

/**
 * 이 묶음을 다음 상태로 옮긴다.
 *
 * **주체를 보내지 않는다.** 요청한 사람이 그 주문의 산 사람인지 판 사람인지는
 * 서버가 확인해서 정한다 — 부르는 쪽이 주장하게 두면 구매자가 `SYSTEM` 을 주장할
 * 수 있다.
 *
 * 답이 `actions` 를 함께 싣는 것도 계약이다. 상태가 바뀌면 버튼이 반드시 바뀌므로,
 * 두 번 묻는 화면은 그 사이에 낡은 버튼을 그린다.
 */
export function transitionSellerOrder(
  sellerOrderId: string,
  to: OrderStatus,
  options?: ApiCallOptions,
): Promise<SellerOrderTransitionResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/transitions`,
    method: 'POST',
    body: { to },
    schema: sellerOrderTransitionResponseSchema,
    ...options,
  })
}
