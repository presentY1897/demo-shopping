import type { CartItem, CartResponse } from '@shopping/shared'
import {
  addCartItemRequestSchema,
  cartResponseSchema,
  removeCartItemsRequestSchema,
  updateCartItemRequestSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { shopperCart } from '../fixtures/cart'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 장바구니 (TASK-0045 의 라우트, TASK-0046 의 화면이 읽는다).
 *
 * **상태를 갖는다.** 이 화면이 묻는 것은 「API 가 무엇을 주느냐」가 아니라 「요청에
 * 무엇을 하느냐」다 — 수량을 늘리면 그룹 소계가 따라 움직이는가, 한 줄을 지우면
 * 선택이 어떻게 되는가, 마지막 줄을 지우면 빈 상태가 나오는가. 얼어붙은 픽스처는
 * 그중 어느 것에도 답하지 못한다.
 *
 * **재현하는 것과 일부러 재현하지 않는 것.** 합산·상한·소계는 여기 있다. 화면이
 * 그리는 것이기 때문이다. 재고 검사와 동시성은 없다 — 그것은 실제 PostgreSQL 에
 * 대고 도는 `apps/api` 의 검사가 이미 증명하는 것이고, 여기서 흉내 내면 더 약한
 * 두 번째 구현이 된다 (QUALITY-GATES 6장).
 *
 * 모든 응답이 `defineFixture` 를 지나므로 계약에서 벗어난 페이로드는 그것을 잘못
 * 그리는 화면이 아니라 **여기서** 실패한다 (게이트 C2).
 */

let store: CartResponse = shopperCart

/** 그룹 소계와 총계를 다시 낸다. 저장된 숫자가 아니라 담긴 것의 결과다. */
function retotal(cart: CartResponse): CartResponse {
  const groups = cart.groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      ...group,
      productAmount: group.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    }))

  return {
    groups,
    totalProductAmount: groups.reduce((sum, group) => sum + group.productAmount, 0),
    itemCount: groups.reduce((sum, group) => sum + group.items.length, 0),
  }
}

function answer(): Response {
  return HttpResponse.json(defineFixture(cartResponseSchema, retotal(store)))
}

function findItem(itemId: string): CartItem | undefined {
  return store.groups.flatMap((group) => group.items).find((item) => item.id === itemId)
}

/** 줄 하나를 바꾼 장바구니. */
function withItem(itemId: string, change: (item: CartItem) => CartItem): CartResponse {
  return {
    ...store,
    groups: store.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => (item.id === itemId ? change(item) : item)),
    })),
  }
}

export const cartHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.cart, () => answer()),

  /**
   * 담기. 같은 Variant 면 **수량이 합산된다** (TASK-0045 F1).
   *
   * 요청의 수량이 아니라 합산된 수량으로 상한을 검사하는 것이 F2c 이고, 그 규칙이
   * 여기 있는 이유는 화면이 그 거절을 그리기 때문이다.
   */
  http.post(mockPaths.cartItems, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, addCartItemRequestSchema)
      const held = store.groups
        .flatMap((group) => group.items)
        .find((item) => item.variantId === body.variantId)

      if (held === undefined) {
        throw new MockApiError(400, '이 목에는 담을 수 없는 조합이에요.', {
          code: 'CART_ITEM_UNAVAILABLE',
        })
      }

      const wanted = held.quantity + body.quantity

      assertWithinLimit(held, wanted)
      store = withItem(held.id, (item) => ({ ...item, quantity: wanted }))

      return answer()
    }),
  ),

  /** 수량 **대입**. 합산이 아니다. */
  http.patch(mockPaths.cartItem, ({ request, params }) =>
    answering(async () => {
      const body = await readBody(request, updateCartItemRequestSchema)
      const itemId = String(params.id)
      const held = findItem(itemId)

      if (held === undefined) throw new MockApiError(404, '장바구니에서 찾을 수 없어요.')

      assertWithinLimit(held, body.quantity)
      store = withItem(itemId, (item) => ({ ...item, quantity: body.quantity }))

      return answer()
    }),
  ),

  /**
   * 선택 삭제.
   *
   * 남의 줄 id 를 섞어 보내도 **거절이 아니라 무시**다 — 요청한 사람이 볼 수 있는
   * 결과는 「내 것이 지워졌다」로 같다.
   */
  http.post(mockPaths.cartItemsRemove, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, removeCartItemsRequestSchema)
      const removing = new Set(body.itemIds)

      store = {
        ...store,
        groups: store.groups.map((group) => ({
          ...group,
          items: group.items.filter((item) => !removing.has(item.id)),
        })),
      }

      return answer()
    }),
  ),
]

/** 1회 구매 상한. 재고는 여기서 보지 않는다 — 그것은 실 DB 검사의 몫이다. */
function assertWithinLimit(item: CartItem, quantity: number): void {
  if (item.maxPurchaseQuantity !== null && quantity > item.maxPurchaseQuantity) {
    throw new MockApiError(400, `1회 ${String(item.maxPurchaseQuantity)}개까지 구매할 수 있어요.`, {
      code: 'CART_PURCHASE_LIMIT',
      field: 'quantity',
    })
  }
}

/** 이 목의 장바구니를 처음 상태로. 비운 상태로 시작하려면 `emptyCart` 를 넘긴다. */
export function resetCartStore(seed: CartResponse = shopperCart): void {
  store = seed
}
