import type { PricedOrder, ShippingPolicy } from './types.js'

/**
 * 환불액 역산 (TASK-0047 F7). `docs/design/pricing.md` 3장이 규칙이다.
 *
 * ```
 * 환불액 = Σ (항목 상품금액 − 항목 쿠폰안분액 − 항목 적립금안분액) + 배송비 환불
 * ```
 *
 * **다시 계산하지 않고 저장된 안분액을 읽는다.** 그것이 안분액을 항목마다 저장한
 * 이유다 — 환불 시점에 다시 계산하면 그 사이 쿠폰 정책이 바뀌었을 때 값이 달라지고,
 * 사람이 낸 돈과 돌려받는 돈이 어긋난다.
 *
 * 배송비는 셋 중 하나다:
 *
 * | 상황 | 처리 |
 * | --- | --- |
 * | 그 판매자 항목 **전체** 취소 | 배송비 전액 환불 |
 * | **부분** 취소 후 남은 금액이 무료배송 조건 미달 | 배송비를 다시 부과 (환불액에서 차감) |
 * | 부분 취소인데 남은 금액이 조건 충족 | 배송비는 그대로 (환불도 재부과도 없다) |
 *
 * 가운데 줄이 이 함수에서 가장 조심스러운 곳이다. 처음에 무료였던 배송비가 **부분
 * 취소 때문에 되살아나는** 경우이고, 그때 환불액은 그만큼 줄어든다.
 */

export interface RefundQuote {
  /** 항목들의 상품금액에서 안분액을 뺀 합. */
  readonly itemAmount: number
  /**
   * 배송비 조정. 양수는 돌려주는 것, **음수는 다시 부과하는 것**이다.
   *
   * 부호를 하나로 합치지 않는 이유는 화면 때문이다 — 「배송비 3,000원 환불」과
   * 「배송비 3,000원 재부과」는 사람이 확인해야 할 서로 다른 줄이다.
   */
  readonly shippingAdjustment: number
  /** 실제로 돌려주는 돈. 음수가 되지는 않는다. */
  readonly refundAmount: number
}

/**
 * `cancelledItemIds` 를 취소했을 때 돌려줄 금액.
 *
 * 여러 판매자의 항목이 섞여 있어도 된다 — 배송비는 판매자마다 따로 판정한다.
 */
export function quoteRefund(
  order: PricedOrder,
  cancelledItemIds: readonly string[],
  shippingPolicies: readonly ShippingPolicy[],
): RefundQuote {
  const cancelled = new Set(cancelledItemIds)
  const targets = order.items.filter((item) => cancelled.has(item.itemId))

  const itemAmount = targets.reduce(
    (sum, item) => sum + item.productAmount - item.couponDiscountAmount - item.pointDiscountAmount,
    0,
  )

  let shippingAdjustment = 0

  // 취소된 항목이 있는 판매자만. `sellerOrders` 를 돌면 조회 실패라는 닿을 수 없는
  // 분기가 생기지 않는다 — 배송비가 그 행에 이미 있다.
  const affected = order.sellerOrders.filter((store) =>
    targets.some((item) => item.sellerId === store.sellerId),
  )

  for (const store of affected) {
    const sellerId = store.sellerId
    const own = order.items.filter((item) => item.sellerId === sellerId)
    const remaining = own.filter((item) => !cancelled.has(item.itemId))
    const charged = store.shippingFee

    if (remaining.length === 0) {
      // 전부 취소됐다. 배송할 것이 없으므로 받은 배송비를 돌려준다.
      shippingAdjustment += charged

      continue
    }

    const policy = shippingPolicies.find((entry) => entry.sellerId === sellerId) ?? null

    if (policy === null) continue

    // 남은 것으로 다시 판정한다. 기준은 처음과 같다 — 쿠폰까지 반영한 상품금액.
    const basis = remaining.reduce(
      (sum, item) => sum + item.productAmount - item.couponDiscountAmount,
      0,
    )
    const owedNow = policy.freeThreshold !== null && basis >= policy.freeThreshold ? 0 : policy.fee

    // 처음에 무료였는데 이제 받아야 하면 음수가 된다 — 그것이 「재부과」다.
    shippingAdjustment += charged - owedNow
  }

  return {
    itemAmount,
    shippingAdjustment,
    // 배송비 재부과가 항목 환불액보다 클 수는 없지만, 그렇게 되더라도 사람에게
    // 돈을 청구하지는 않는다. 환불은 돌려주는 일이고 받아내는 일이 아니다.
    refundAmount: Math.max(0, itemAmount + shippingAdjustment),
  }
}
