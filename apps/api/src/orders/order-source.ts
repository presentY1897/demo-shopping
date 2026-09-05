import type { PricedOrder, PricingDiscount, ShippingPolicy } from '@shopping/shared'
import { calculateOrder } from '@shopping/shared'

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

/** 이 한 벌의 금액. 주문서와 주문이 **같은 함수**로 낸다. */
export function priceOf(source: OrderSource, discounts: readonly PricingDiscount[]): PricedOrder {
  return calculateOrder({
    items: source.lines.map((line) => ({
      itemId: line.itemId,
      sellerId: line.sellerId,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    })),
    discounts,
    shippingPolicies: source.policies,
  })
}
