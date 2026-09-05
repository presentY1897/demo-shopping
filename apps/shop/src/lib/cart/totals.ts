import type { CartGroup, CartResponse, PricedOrder } from '@shopping/shared'
import { calculateOrder } from '@shopping/shared'

import type { Selection } from './selection'

/**
 * 고른 것의 합계 (TASK-0046 F2 · F4 · F6).
 *
 * **`packages/shared` 의 계산 엔진을 그대로 부른다** (4.2). 곱하고 더하는 것이
 * 전부처럼 보이지만 무료배송 판정이 **쿠폰까지 반영한 상품금액** 기준이고
 * (`pricing.md` 1장), 적립금은 물건 값을 먼저 덮는다. 그 규칙이 화면에 두 번째
 * 구현으로 생기면 「장바구니가 보여 준 금액과 결제 금액이 다르다」가 되고, 그것은
 * **신고되지 않는 종류의 버그**다 — 사는 사람은 결제 금액이 맞는 줄 안다.
 *
 * 쿠폰도 적립금도 M11 이라 오늘 넘기는 할인 목록은 비어 있다. 그래도 엔진을 거치는
 * 이유가 위와 같다.
 */

/** 한 그룹의 몫. */
export interface GroupTotals {
  readonly productAmount: number
  readonly shippingFee: number
  /**
   * 무료배송까지 남은 금액. `null` 이면 보여 줄 것이 없다 — 무료 조건이 없거나,
   * 이미 채웠거나, 이 그룹에서 고른 것이 없다.
   */
  readonly freeShippingRemaining: number | null
}

export interface CartTotals {
  readonly productAmount: number
  readonly shippingFee: number
  readonly paidAmount: number
  /** 고른 줄의 수. 「3건 주문하기」의 3이다. */
  readonly selectedCount: number
  readonly groups: ReadonlyMap<string, GroupTotals>
}

/**
 * 무료배송까지 얼마 남았나.
 *
 * 세 경우가 `null` 이고 이유가 각각 다르다 — 무료 조건이 아예 없거나, 이미
 * 넘겼거나, 이 그룹에서 아무것도 안 골랐거나. 셋 다 **보여 줄 문장이 없다**는
 * 점에서 같아서 하나의 값으로 합친다.
 */
function remainingFor(group: CartGroup, productAmount: number): number | null {
  if (group.freeShippingThreshold === null) return null
  if (productAmount === 0) return null

  const remaining = group.freeShippingThreshold - productAmount

  return remaining > 0 ? remaining : null
}

/** 고른 것만으로 계산 엔진을 돌린다. */
function priceSelected(cart: CartResponse, selection: Selection): PricedOrder {
  const items = cart.groups.flatMap((group) =>
    group.items
      .filter((item) => selection.has(item.id))
      .map((item) => ({
        itemId: item.id,
        sellerId: group.sellerId,
        unitPrice: item.price,
        quantity: item.quantity,
      })),
  )

  return calculateOrder({
    items,
    discounts: [],
    // 고른 것이 없는 판매자의 정책도 함께 넘긴다. 엔진은 항목이 없는 판매자에게
    // 배송비를 붙이지 않으므로 걸러 낼 이유가 없고, 거르면 그 거르는 규칙이 또
    // 하나의 규칙이 된다.
    shippingPolicies: cart.groups.map((group) => ({
      sellerId: group.sellerId,
      fee: group.shippingFee,
      freeThreshold: group.freeShippingThreshold,
    })),
  })
}

export function cartTotals(cart: CartResponse, selection: Selection): CartTotals {
  const priced = priceSelected(cart, selection)
  const bySeller = new Map(priced.sellerOrders.map((entry) => [entry.sellerId, entry]))
  const groups = new Map<string, GroupTotals>(
    cart.groups.map((group) => {
      const share = bySeller.get(group.sellerId)
      const productAmount = share?.productAmount ?? 0

      return [
        group.sellerId,
        {
          productAmount,
          shippingFee: share?.shippingFee ?? 0,
          freeShippingRemaining: remainingFor(group, productAmount),
        },
      ]
    }),
  )

  return {
    productAmount: priced.totalProductAmount,
    shippingFee: priced.totalShippingFee,
    paidAmount: priced.paidAmount,
    selectedCount: priced.items.length,
    groups,
  }
}
