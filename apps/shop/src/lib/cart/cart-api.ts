import type { CartResponse } from '@shopping/shared'
import { cartResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 장바구니를 읽고 고친다 (TASK-0045 의 라우트).
 *
 * **경로에 사용자 id 가 없다.** 소유자는 토큰이 정한다 — 그래서 인증된
 * 클라이언트여야 하고, 서버 렌더에서는 부를 수 없다.
 *
 * 모든 쓰기가 **장바구니 전체**를 돌려준다. 부분 응답을 합치는 코드가 화면에
 * 없어야 하기 때문이다: 수량 하나를 바꿨을 때 달라지는 것은 그 줄만이 아니다 —
 * 그룹 소계와 알림이 함께 움직이고, 그것을 화면이 다시 계산하면 서버와 갈린다.
 */

export function fetchCart(options: { readonly signal?: AbortSignal } = {}): Promise<CartResponse> {
  return getApiClient().request({ path: '/cart', schema: cartResponseSchema, ...options })
}

/** 수량 대입. 합산이 아니다 — 담기와 다른 동사이므로 다른 라우트다. */
export function updateQuantity(itemId: string, quantity: number): Promise<CartResponse> {
  return getApiClient().request({
    path: `/cart/items/${itemId}`,
    method: 'PATCH',
    body: { quantity },
    schema: cartResponseSchema,
  })
}

/** 선택 삭제. 한 줄을 지우는 것도 이쪽이다. */
export function removeItems(itemIds: readonly string[]): Promise<CartResponse> {
  return getApiClient().request({
    path: '/cart/items/remove',
    method: 'POST',
    body: { itemIds: [...itemIds] },
    schema: cartResponseSchema,
  })
}
