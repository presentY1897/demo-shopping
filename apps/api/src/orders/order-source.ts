import type { PricedOrder, PricingDiscount, PricingItem, ShippingPolicy } from '@shopping/shared'
import { calculateOrder } from '@shopping/shared'

import type { CouponLine } from '../coupons/coupon-apply.js'
import type { OrderLine } from './order-plan.js'

/**
 * 주문될 것 한 벌 — 어디서 왔든 같은 모양 (TASK-0050 4.3).
 *
 * 장바구니에서 왔을 수도 있고(`POST /orders { itemIds }`) 이미 열린 주문서에서
 * 왔을 수도 있다(`{ checkoutId }`). **그다음부터는 구분이 없어야 한다** — 구분이
 * 남으면 두 길이 다른 금액을 내는 날이 온다.
 */
export interface OrderSource {
  readonly lines: readonly OrderLine[]
  readonly policies: readonly ShippingPolicy[]
  /** 이미 잡혀 있는 주문서. `null` 이면 아직 아무것도 잡히지 않았다. */
  readonly checkoutId: string | null
  /** 잡혀 있다면 언제 풀리는가. 주문서 화면의 타이머가 읽는다. */
  readonly expiresAt?: Date
}

/**
 * 한 줄이 계산 엔진에게 보이는 모양.
 *
 * 한 곳에서만 만든다. 아래 두 함수가 각자 이 네 값을 적으면 **두 벌이 되고**,
 * 한쪽만 고쳐지는 날 계산기는 A 를 깎는데 쿠폰 판정은 B 에 닿았다고 답한다 — 그
 * 어긋남은 오류가 아니라 금액 하나로만 나타난다.
 */
function itemOf(line: OrderLine): PricingItem {
  return {
    itemId: line.itemId,
    sellerId: line.sellerId,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
  }
}

/** 계산 엔진이 보는 항목들. */
export function itemsOf(source: OrderSource): readonly PricingItem[] {
  return source.lines.map(itemOf)
}

/**
 * 쿠폰 판정이 보는 줄들 — 계산 항목에 **범위 판정에 필요한 둘**을 얹은 것
 * (TASK-0075).
 *
 * 얹기만 하고 다시 만들지 않는다. 쿠폰이 「어느 줄에 닿는가」를 계산기가 보는 줄과
 * 다른 배열 위에서 판정하면, 그 배열이 갈리는 날 「보여 준 할인」과 「빠진 할인」이
 * 서로 다른 항목을 가리킨다.
 */
export function couponLinesOf(source: OrderSource): readonly CouponLine[] {
  return source.lines.map((line) => ({
    ...itemOf(line),
    productId: line.productId,
    categoryPath: line.categoryPath,
  }))
}

/** 이 한 벌의 금액. 주문서와 주문이 **같은 함수**로 낸다. */
export function priceOf(source: OrderSource, discounts: readonly PricingDiscount[]): PricedOrder {
  return calculateOrder({
    items: itemsOf(source),
    discounts,
    shippingPolicies: source.policies,
  })
}
