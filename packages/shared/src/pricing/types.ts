import { z } from 'zod'

/**
 * 금액 계산의 입출력 (TASK-0047).
 *
 * `docs/design/pricing.md` 가 이 코드의 명세다. 어긋나면 **문서를 먼저 고친다** —
 * 계산 순서가 바뀌는 것은 코드의 사정이 아니라 정책의 변경이다.
 *
 * 금액은 전부 **정수(원)** 다. 부동소수를 쓰면 안분에서 잔여가 생기고, 그 잔여는
 * 합계가 1원 어긋나는 것으로 나타난다 — 그리고 그 1원은 실제 돈이다.
 */

/** 원 단위 정수. 음수는 금액이 아니다. */
export const wonSchema = z.int().min(0)

/**
 * 할인의 종류.
 *
 * **쿠폰과 적립금을 가르는 것은 계산 순서다** (`pricing.md` 1장): 쿠폰은 값을 깎고
 * 적립금은 그 뒤에 낼 것을 줄인다. 적립금은 「① − ③ + ④」 범위 안에서만 쓸 수
 * 있고, 무료배송 판정에도 들어가지 않는다.
 */
export const discountTypes = ['COUPON', 'POINT'] as const

export type DiscountType = (typeof discountTypes)[number]

/**
 * 할인이 미치는 범위.
 *
 * `ORDER` 는 주문 전체 항목에, `SELLER` 는 한 판매자의 항목에, `ITEM` 은 한 항목에
 * 붙는다 — 앞의 둘은 안분되고 마지막은 안분할 것이 없다.
 */
export const discountScopes = ['ORDER', 'SELLER', 'ITEM'] as const

export type DiscountScope = (typeof discountScopes)[number]

/**
 * 누가 부담하나. 정산에서 쓴다 (`pricing.md` 5장).
 *
 * 계산 결과는 이것과 무관하다 — 사는 사람이 내는 돈은 누가 부담하든 같다. 그래도
 * 입력에 있는 이유는 **안분액이 정산의 입력**이기 때문이다: 판매자 부담 쿠폰의
 * 안분액이 그 판매자의 정산액에서 빠진다.
 */
export const discountBearers = ['PLATFORM', 'SELLER'] as const

export type DiscountBearer = (typeof discountBearers)[number]

export const pricingItemSchema = z.object({
  /** 이 계산 안에서 항목을 가리키는 이름. 장바구니 줄 id 든 variant id 든 좋다. */
  itemId: z.string().min(1),
  sellerId: z.string().min(1),
  unitPrice: wonSchema,
  quantity: z.int().min(1),
})

export type PricingItem = z.infer<typeof pricingItemSchema>

export const pricingDiscountSchema = z.object({
  id: z.string().min(1),
  type: z.enum(discountTypes),
  scope: z.enum(discountScopes),
  amount: wonSchema,
  /**
   * `SELLER` 면 판매자 id, `ITEM` 이면 항목 id. `ORDER` 면 없다.
   *
   * 가리키는 것이 이 계산에 없으면 그 할인은 **적용되지 않는다** — 던지지 않는다.
   * 장바구니에서 항목 하나를 빼고 다시 계산하는 것이 정상 경로이고, 그때 그 항목에
   * 붙어 있던 할인은 그냥 사라져야 한다.
   */
  targetId: z.string().min(1).optional(),
  bearer: z.enum(discountBearers),
})

export type PricingDiscount = z.infer<typeof pricingDiscountSchema>

/**
 * 한 판매자의 배송 정책.
 *
 * `freeThreshold` 가 `null` 이면 무료 조건이 없다 — 언제나 `fee` 를 받는다. `0` 은
 * 다른 뜻이다: 0원 이상이면 무료, 즉 **언제나 무료**다.
 */
export const shippingPolicySchema = z.object({
  sellerId: z.string().min(1),
  fee: wonSchema,
  freeThreshold: wonSchema.nullable(),
})

export type ShippingPolicy = z.infer<typeof shippingPolicySchema>

export interface PricingInput {
  readonly items: readonly PricingItem[]
  readonly discounts: readonly PricingDiscount[]
  readonly shippingPolicies: readonly ShippingPolicy[]
}

/** 한 항목의 계산 결과. 주문 저장 시 `OrderItem` 이 이대로 받는다. */
export interface PricedItem {
  readonly itemId: string
  readonly sellerId: string
  readonly productAmount: number
  /** 이 항목에 안분된 쿠폰 할인. */
  readonly couponDiscountAmount: number
  /** 이 항목에 안분된 적립금. */
  readonly pointDiscountAmount: number
  /** 위 둘의 합. 부분 취소 때 「이 항목에 얼마가 붙어 있었나」가 이것이다. */
  readonly discountAmount: number
}

export interface PricedSellerOrder {
  readonly sellerId: string
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly pointDiscountAmount: number
  /**
   * 배송비를 낸 적립금 (TASK-0047).
   *
   * 항목에 안분되지 **않는** 몫이다. 적립금은 「① − ③ + ④ 범위 내에서」 쓸 수
   * 있으므로 배송비도 낼 수 있는데, 그 몫까지 항목에 붙이면 항목의 할인이
   * 상품금액을 넘고 부분 취소에서 환불액이 음수가 된다.
   *
   * `pointDiscountAmount` 들의 합에 이것을 더해야 주문 전체의 적립금 사용액이 된다.
   */
  readonly shippingPointAmount: number
  readonly discountAmount: number
  readonly shippingFee: number
  /** 이 판매자 몫의 실결제금액. 전부 더하면 주문의 실결제금액이다. */
  readonly paidAmount: number
}

export interface PricedOrder {
  readonly items: readonly PricedItem[]
  readonly sellerOrders: readonly PricedSellerOrder[]
  readonly totalProductAmount: number
  readonly totalCouponDiscountAmount: number
  readonly totalPointDiscountAmount: number
  readonly totalDiscountAmount: number
  readonly totalShippingFee: number
  readonly paidAmount: number
}
