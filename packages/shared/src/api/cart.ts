import { z } from 'zod'

import { priceSchema, productIdSchema, variantIdSchema } from './products.js'

/**
 * 장바구니의 계약 (TASK-0045).
 *
 * 담는 단위는 **Variant** 다. 가격과 재고를 들고 있는 것이 Variant 이고,
 * 「검정 M」과 「검정 L」은 다른 물건이다.
 *
 * **배송비는 여기 없다** (4.1). `pricing.md` 의 배송비는 「SellerOrder 단위로
 * 부과, 조건부 무료」이고 그 조건이 아직 스키마에 없다 — 없는 규칙으로 지어낸
 * 숫자를 실으면 화면이 그대로 그리고, TASK-0047 이 진짜 규칙을 넣는 날 금액이
 * 바뀐다. **응답에 없는 것과 `0` 은 다르다**: `0` 은 「무료다」라는 약속이다.
 */

/** 한 사람이 한 Variant 를 담을 수 있는 절대 상한. 판매자 제한과는 별개다. */
export const CART_ITEM_MAX_QUANTITY = 99

/** 장바구니에 들어갈 수 있는 줄 수. 화면이 감당할 수 있는 범위. */
export const CART_MAX_ITEMS = 100

export const cartQuantitySchema = z.int().min(1).max(CART_ITEM_MAX_QUANTITY)

/**
 * 담은 뒤에 달라진 것.
 *
 * **비어 있는 것이 정상이다.** 무언가 들어 있으면 화면이 그 줄에 표시를 붙인다.
 * 하나의 불리언으로 뭉치지 않는 이유는 사람이 할 일이 다르기 때문이다 — 가격이
 * 올랐으면 다시 볼지 정하는 것이고, 품절이면 뺄지 정하는 것이다.
 */
export const cartItemNoticeSchema = z.enum([
  /** 담을 때보다 가격이 올랐다. */
  'price_increased',
  /** 담을 때보다 내렸다. 알려 주면 반가운 쪽이다. */
  'price_decreased',
  /** 재고가 0이다. */
  'sold_out',
  /** 재고가 담은 수량보다 적다. */
  'stock_reduced',
  /** 판매가 중단됐거나 상품이 내려갔다. */
  'unavailable',
])

export type CartItemNotice = z.infer<typeof cartItemNoticeSchema>

export const cartItemSchema = z.object({
  id: z.uuid(),
  variantId: variantIdSchema,
  productId: productIdSchema,
  productName: z.string(),
  /** 옵션 조합을 사람이 읽는 형태로: `블랙 / M`. 옵션이 없으면 빈 문자열. */
  optionLabel: z.string(),
  thumbnailUrl: z.string().nullable(),
  sku: z.string(),
  quantity: cartQuantitySchema,
  /** 지금 가격. 화면이 그리는 것은 이쪽이다. */
  price: priceSchema,
  /** 담을 때의 가격. 위와 다르면 `notices` 에 그 사실이 들어 있다. */
  priceAtAdded: priceSchema,
  /** 지금 재고. `notices` 를 화면이 다시 계산하지 않아도 되게 함께 보낸다. */
  stock: z.int().min(0),
  /**
   * 이 Variant 를 1회에 몇 개까지 살 수 있나 (TASK-0032).
   *
   * 상품 기본값이 이미 풀린 값이다 — 네 군데가 이 제한을 강제해야 하고, 네 개의
   * `variant.max ?? product.max` 는 네 번째가 우선순위를 뒤집는 방법이다.
   */
  maxPurchaseQuantity: z.int().min(1).nullable(),
  notices: z.array(cartItemNoticeSchema),
})

export type CartItem = z.infer<typeof cartItemSchema>

/**
 * 한 판매자의 몫.
 *
 * **그룹핑을 API 가 한다** — 배송비가 판매자 단위로 붙고(D-023) 주문도 판매자별로
 * 쪼개진다. 클라이언트가 매번 묶으면 그 규칙이 여러 곳에 흩어진다.
 */
export const cartGroupSchema = z.object({
  sellerId: z.uuid(),
  brandName: z.string(),
  items: z.array(cartItemSchema),
  /** Σ(`price` × `quantity`). 계산 규칙이 아니라 담긴 것 자체다. */
  productAmount: priceSchema,
})

export type CartGroup = z.infer<typeof cartGroupSchema>

export const cartResponseSchema = z.object({
  groups: z.array(cartGroupSchema),
  totalProductAmount: priceSchema,
  /** 줄 수. 헤더의 배지가 읽는다. */
  itemCount: z.int().min(0),
})

export type CartResponse = z.infer<typeof cartResponseSchema>

/** `POST /cart/items` — 담기. 같은 Variant 면 수량이 합산된다 (F1). */
export const addCartItemRequestSchema = z.object({
  variantId: variantIdSchema,
  quantity: cartQuantitySchema,
})

export type AddCartItemRequest = z.infer<typeof addCartItemRequestSchema>

/**
 * `PATCH /cart/items/:id` — 수량 바꾸기.
 *
 * 합산이 아니라 **대입**이다. 담기와 다른 동사이므로 다른 라우트다 — 하나로
 * 합치고 플래그로 가르면 그 플래그를 잘못 보내는 날 수량이 두 배가 된다.
 */
export const updateCartItemRequestSchema = z.object({
  quantity: cartQuantitySchema,
})

export type UpdateCartItemRequest = z.infer<typeof updateCartItemRequestSchema>

/**
 * `POST /cart/items/remove` — 선택 삭제.
 *
 * 하나를 지우는 것도 이쪽이다. `DELETE /cart/items/:id` 를 따로 두면 화면이
 * 「선택한 셋」을 지울 때 요청을 셋 보내게 되고, 그중 둘만 성공한 상태가 생긴다.
 */
export const removeCartItemsRequestSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(CART_MAX_ITEMS),
})

export type RemoveCartItemsRequest = z.infer<typeof removeCartItemsRequestSchema>

/**
 * `POST /cart/merge` — 비로그인 장바구니를 로그인한 계정에 합친다 (F6).
 *
 * 브라우저가 들고 있던 것을 그대로 보낸다. 서버에 이미 있는 Variant 면 수량이
 * 합산되고, 상한을 넘으면 상한까지만 남는다 — **거절하지 않는다.** 로그인 직후에
 * 「장바구니를 합칠 수 없습니다」를 보여 주는 것은 아무도 원하지 않는 화면이고,
 * 사람이 할 수 있는 일도 없다.
 */
export const mergeCartRequestSchema = z.object({
  items: z.array(addCartItemRequestSchema).max(CART_MAX_ITEMS),
})

export type MergeCartRequest = z.infer<typeof mergeCartRequestSchema>
