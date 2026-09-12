import type {
  AdminOrderPaymentsResponse,
  AdminOrderSearchQueryParams,
  AdminOrderSearchResponse,
  HideProductRequest,
  ProductListQuery,
  ProductListResponse,
  ProductModerationResponse,
} from '@shopping/shared'
import {
  adminOrderPaymentsResponseSchema,
  adminOrderSearchResponseSchema,
  productListResponseSchema,
  productModerationResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 이 콘솔이 **전체 상품과 전체 주문**에 대해 두드리는 자리, 한 곳에 (TASK-0095).
 *
 * `lib/users/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가
 * 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가 필드 이름을
 * 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를 그리는 대신에
 * (게이트 C1).
 *
 * ## 상품 목록만 `/admin` 아래에 없다
 *
 * `GET /products` 다. 관리자가 모든 스토어의 상품을 보는 일인데도 `/admin` 밖에 있는
 * 이유는 **누가 무엇을 볼 수 있는지는 퍼미션 표가 정하지 URL 이 정하지 않기**
 * 때문이다 — `product.read` 를 `any` 로 든 사람에게 그 문은 이미 모든 스토어의 상품을
 * 답하고 있고(F1 · 4.1), 관리자용 목록을 하나 더 만드는 것은 이 TASK 가 지어낼 것이
 * 아니다. 이 TASK 가 더하는 것은 **관리자만 하는 일** — 강제로 내리기와, 주문을
 * 사람·스토어·기간으로 가로질러 찾기다.
 *
 * ## 주문 상태를 바꾸는 함수가 여기 **없다**
 *
 * 일부러 없다 (F7 · 4.4). 서버에도 그 문이 없고, 화면에도 없다 — 상태를 손으로 옮기면
 * 재고·정산·환불이 따라오지 않고 그 어긋남은 몇 단계 뒤에 「정산 금액이 이상하다」로
 * 나타난다. 관리자가 결과를 바꿔야 하면 클레임 개입으로 간다 (TASK-0071). 화면이 그
 * 사실을 **말해야** 하는 이유는, 버튼이 그냥 없으면 읽는 사람이 자기 권한 문제로
 * 읽고 다른 계정으로 다시 들어와 보기 때문이다.
 */

/** `?sellerId=…&categoryId=3&status=ACTIVE&cursor=…`, 아무것도 없으면 빈 문자열. */
export function productSearch(query: ProductListQuery): string {
  const params = new URLSearchParams()

  if (query.q !== undefined) params.set('q', query.q)
  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  if (query.categoryId !== undefined) params.set('categoryId', String(query.categoryId))
  if (query.status !== undefined) params.set('status', query.status)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 한 페이지의 상품 — **모든 스토어의** (F1).
 *
 * `sellerId` 를 안 보내는 것이 「내가 볼 수 있는 전부」가 아니다. 서버는 부르는 사람의
 * 스코프로 좁히므로(`product.service.ts` 의 `list`), 판매자가 같은 문을 부르면 자기
 * 스토어만 받는다. 관리자에게만 이 문이 전체를 답한다.
 */
export function fetchProducts(
  query: ProductListQuery,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProductListResponse> {
  return getApiClient().request({
    path: `/products${productSearch(query)}`,
    schema: productListResponseSchema,
    ...options,
  })
}

/**
 * 상품을 내린다 — **사유와 함께** (F2 · F3).
 *
 * 사유가 몸통에 실리는 이유는 가리킬 행이 없기 때문이다. 신고를 통한 숨김은 신고 행이
 * 사유와 처리자를 들고 있지만, 직접 내리는 데에는 그런 행이 없어 상품에 적는다 —
 * 그리고 사유 없이 내려진 상품은 **판매자에게 설명할 방법이 없다** (4.2).
 */
export function hideProduct(productId: string, reason: string): Promise<ProductModerationResponse> {
  const body: HideProductRequest = { reason }

  return getApiClient().request({
    path: `/admin/products/${productId}/hidden`,
    method: 'POST',
    body,
    schema: productModerationResponseSchema,
  })
}

/**
 * 내려진 상품을 다시 올린다.
 *
 * 사유를 받지 않는다 — 계약이 그렇게 정해 두었다. 되돌리는 쪽에는 **되돌린다는 사실
 * 자체가 근거**이고, 서버는 시각·사유·처리자 셋을 함께 비운다
 * (`Product_moderation_check` 가 셋이 함께 있거나 셋 다 없기를 요구한다).
 */
export function unhideProduct(productId: string): Promise<ProductModerationResponse> {
  return getApiClient().request({
    path: `/admin/products/${productId}/hidden`,
    method: 'DELETE',
    schema: productModerationResponseSchema,
  })
}

/** `?orderNumber=ORD-1&sellerId=…&from=2026-09-01&to=2026-09-07`, 없으면 빈 문자열. */
export function orderSearch(query: AdminOrderSearchQueryParams): string {
  const params = new URLSearchParams()

  if (query.orderNumber !== undefined) params.set('orderNumber', query.orderNumber)
  if (query.buyerId !== undefined) params.set('buyerId', query.buyerId)
  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  if (query.from !== undefined) params.set('from', query.from)
  if (query.to !== undefined) params.set('to', query.to)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 주문을 가로질러 찾는다 (F4 · F5).
 *
 * 줄마다 **판매자별 묶음이 전부** 실려 온다. 하나만 보이면 다중 판매자 주문의 절반이
 * 화면에서 사라지고, CS 는 「그 주문 맞는데 그 상품이 없다」를 보게 된다 (4.3). 산
 * 사람의 이름은 **이미 가려진 채로** 오므로 화면은 가리지도 되돌리지도 않는다.
 */
export function fetchOrders(
  query: AdminOrderSearchQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminOrderSearchResponse> {
  return getApiClient().request({
    path: `/admin/orders${orderSearch(query)}`,
    schema: adminOrderSearchResponseSchema,
    ...options,
  })
}

/** 결제와 환불 (F6). 「돈이 어떻게 움직였나」에 한 화면에서 답한다. */
export function fetchOrderPayments(
  orderId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminOrderPaymentsResponse> {
  return getApiClient().request({
    path: `/admin/orders/${orderId}/payments`,
    schema: adminOrderPaymentsResponseSchema,
    ...options,
  })
}
