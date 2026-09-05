import type {
  SellerOrderActionsResponse,
  SellerOrderDeliveryResponse,
  SellerOrderListQuery,
  SellerOrderListResponse,
  SellerOrderResponse,
  SellerOrderSummaryResponse,
  SellerOrderTransitionRequest,
  SellerOrderTransitionResponse,
  ShipmentResponse,
  ShipSellerOrderRequest,
} from '@shopping/shared'
import {
  sellerOrderActionsResponseSchema,
  sellerOrderDeliveryResponseSchema,
  sellerOrderListResponseSchema,
  sellerOrderResponseSchema,
  sellerOrderSummaryResponseSchema,
  sellerOrderTransitionResponseSchema,
  shipmentResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 판매자 콘솔이 주문에 대해 부르는 일곱 자리, 한 곳에.
 *
 * `ApiClient` 에 메서드가 없는 자리는 `client.request({ path, schema })` 를 그대로
 * 쓴다 — `lib/products/console-api.ts` 가 같은 이유로 같은 모양이고, 지켜지는 성질도
 * 같다: **경로와 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지
 * 않는다 (게이트 C1).
 */

/** `?status=PAID,PREPARING&from=…`, 아무것도 없으면 빈 문자열. */
export function sellerOrderSearch(query: SellerOrderListQuery): string {
  const params = new URLSearchParams()

  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?status=a&status=b`)는 프레임워크마다
  // 다른 것으로 파싱되고, 계약이 그 모양을 고른 이유가 그것이다.
  if (query.status !== undefined) params.set('status', query.status.join(','))
  if (query.from !== undefined) params.set('from', query.from)
  if (query.to !== undefined) params.set('to', query.to)
  if (query.q !== undefined) params.set('q', query.q)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 한 페이지. */
export function fetchSellerOrders(
  query: SellerOrderListQuery,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerOrderListResponse> {
  return getApiClient().request({
    path: `/seller-orders${sellerOrderSearch(query)}`,
    schema: sellerOrderListResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * 상태별 건수와 뱃지.
 *
 * 목록과 **다른 요청**이다. 같은 응답에 실으면 숫자가 필터를 따라 움직이고, 그러면
 * 그것은 뱃지가 아니라 「지금 보고 있는 목록의 개수」가 된다.
 */
export function fetchSellerOrderSummary(
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerOrderSummaryResponse> {
  return getApiClient().request({
    path: '/seller-orders/summary',
    schema: sellerOrderSummaryResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** 몫 하나 — 항목·수령인·금액·배송·이력. */
export function fetchSellerOrder(
  sellerOrderId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerOrderResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}`,
    schema: sellerOrderResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * 지금 이 사람이 할 수 있는 것.
 *
 * **화면이 상태로 분기하지 않게 하는 답이다** (설계서 4장). 「`PAID` 면 발송 버튼」을
 * 화면에 적으면 그 판단이 세 앱에 흩어지고, 규칙이 바뀔 때 한 곳만 고쳐진다.
 */
export function fetchSellerOrderActions(
  sellerOrderId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerOrderActionsResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/actions`,
    schema: sellerOrderActionsResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** 상태를 옮긴다. 발송과 배송완료는 이 문이 아니다 — 아래 둘을 본다. */
export function transitionSellerOrder(
  sellerOrderId: string,
  body: SellerOrderTransitionRequest,
): Promise<SellerOrderTransitionResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/transitions`,
    method: 'POST',
    body,
    schema: sellerOrderTransitionResponseSchema,
  })
}

/**
 * 발송 처리 — 운송장 발급 · 전이 · 첫 추적 사건이 **한 트랜잭션**이다 (TASK-0061).
 *
 * 전이 라우트로 `SHIPPED` 를 찍을 수 없는 이유가 여기 있다: 그 문은 운송장을
 * 요구하고, 운송장을 만드는 것이 이 라우트다.
 */
export function shipSellerOrder(
  sellerOrderId: string,
  body: ShipSellerOrderRequest = {},
): Promise<ShipmentResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/shipment`,
    method: 'POST',
    body,
    schema: shipmentResponseSchema,
  })
}

/**
 * 배송완료 처리 — 주문과 **배송 표를 함께** 옮긴다 (TASK-0060 4.3).
 *
 * 전이 라우트로 같은 일을 하면 주문만 `DELIVERED` 가 되고 `Shipment.status` 는 그대로
 * 남아, 구매자의 추적 화면이 「이동 중」인 채로 주문은 배송완료가 된다.
 */
export function markSellerOrderDelivered(
  sellerOrderId: string,
): Promise<SellerOrderDeliveryResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/delivery`,
    method: 'POST',
    schema: sellerOrderDeliveryResponseSchema,
  })
}
