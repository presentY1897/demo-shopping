/**
 * 저장된 사실에서 환불 입력을 만드는 규칙 (TASK-0068). 입력 → 출력, 분기 100%.
 *
 * 여기서 재는 것은 **누계가 접히는가**이고, 틀려도 조용하다.
 *
 * - **배송비 차분**이 없으면 무료배송 주문의 전량 취소가 실결제금액보다 적게
 *   돌아간다. 그 차액은 아무 데도 안 가고, 어느 요청도 실패하지 않는다.
 * - **재부과가 두 번** 일어나면 사람이 물어야 할 배송비가 두 배가 된다. 화면에는
 *   「배송비 조정 −3,000원」이 두 번 찍히고, 그 둘은 각자 옳아 보인다.
 * - **문턱을 재는 금액**이 1원 어긋나면 경계에 앉은 주문에서 배송비 3,000원이
 *   갈린다.
 */

import { describe, expect, it } from 'vitest'

import type { RefundLedgerItem, SellerShippingFacts } from './refund-plan.js'
import { cancelShipping, claimRefundBreakdown, returnShipping } from './refund-plan.js'

/** 무료배송으로 산 가게. 문턱이 무너지면 3,000원이 되살아난다. */
const FREE_SHIPPING: SellerShippingFacts = {
  chargedShippingFee: 0,
  standardShippingFee: 3_000,
  freeShippingThreshold: 25_000,
}

/** 항목 하나. 적지 않은 칸은 「할인 없음 · 아직 아무것도 환불 안 함」이다. */
function item(
  parts: Partial<RefundLedgerItem> & { readonly orderItemId: string },
): RefundLedgerItem {
  return {
    quantity: 1,
    productAmount: 10_000,
    couponDiscountAmount: 0,
    pointDiscountAmount: 0,
    refundedUnits: 0,
    units: 0,
    ...parts,
  }
}

/** 이 항목들을 취소 경로로 환불했을 때의 이번 몫. */
function cancelOf(items: readonly RefundLedgerItem[], facts: SellerShippingFacts = FREE_SHIPPING) {
  return claimRefundBreakdown(items, cancelShipping(items, facts))
}

describe('항목 몫 — 누적으로 센다', () => {
  it('splits one line across three refunds without losing a won', () => {
    // 10,000원짜리 3개를 하나씩 세 번. 매번 따로 반올림하면 9,999원이 된다.
    const line = { orderItemId: 'A', quantity: 3, productAmount: 10_000 }
    const amounts = [0, 1, 2].map(
      (refunded) => cancelOf([item({ ...line, refundedUnits: refunded, units: 1 })]).itemsAmount,
    )

    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(10_000)
    // 마지막 환불이 잔여를 가져간다.
    expect(amounts).toEqual([3_333, 3_333, 3_334])
  })

  it('subtracts the allocated coupon and points, not the list price', () => {
    // 안분액은 이미 저장돼 있다. 여기서 비율을 다시 세지 않는 것이 `pricing.md`
    // 2장이고, 뺄셈 하나로 끝나는 것이 그 저장의 값이다.
    const breakdown = cancelOf([
      item({
        orderItemId: 'A',
        productAmount: 30_000,
        couponDiscountAmount: 3_000,
        pointDiscountAmount: 2_000,
        units: 1,
      }),
    ])

    expect(breakdown.itemsAmount).toBe(25_000)
  })

  it('leaves the lines this claim does not touch out of the refund', () => {
    // 판매자 몫의 항목이 **전부** 들어온다 — 무료배송 문턱을 다시 보려면 남는 것을
    // 알아야 하기 때문이다. 그렇다고 남는 것에 돈을 돌려주지는 않는다.
    const breakdown = cancelOf([
      item({ orderItemId: 'A', productAmount: 30_000, units: 1 }),
      item({ orderItemId: 'B', productAmount: 20_000 }),
    ])

    expect(breakdown.lines.map((line) => line.orderItemId)).toEqual(['A'])
  })
})

describe('배송비 — 네 줄', () => {
  it('gives the whole shipping fee back when nothing is left', () => {
    const paid: SellerShippingFacts = {
      chargedShippingFee: 3_000,
      standardShippingFee: 3_000,
      freeShippingThreshold: null,
    }

    expect(cancelOf([item({ orderItemId: 'A', units: 1 })], paid).shippingAmount).toBe(3_000)
  })

  it('adjusts nothing while what remains still clears the threshold', () => {
    const breakdown = cancelOf([
      item({ orderItemId: 'A', productAmount: 10_000, units: 1 }),
      item({ orderItemId: 'B', productAmount: 30_000 }),
    ])

    expect(breakdown.shippingAmount).toBe(0)
  })

  it('rebills the shipping the free-shipping threshold had waived', () => {
    // 무료배송이었다가 문턱이 무너지는 경우. 재부과는 **환불액에서 차감**이라 음수다.
    const breakdown = cancelOf([
      item({ orderItemId: 'A', productAmount: 30_000, units: 1 }),
      item({ orderItemId: 'B', productAmount: 20_000 }),
    ])

    expect(breakdown.shippingAmount).toBe(-3_000)
    expect(breakdown.total).toBe(27_000)
  })

  it('rebills nothing to someone who already paid the shipping', () => {
    // **재부과액은 「기본 배송비 − 이미 낸 배송비」다.** 3,000원을 낸 사람에게 또
    // 3,000원을 물리면 배송비를 두 번 받는다.
    const paid: SellerShippingFacts = { ...FREE_SHIPPING, chargedShippingFee: 3_000 }
    const breakdown = cancelOf(
      [
        item({ orderItemId: 'A', productAmount: 30_000, units: 1 }),
        item({ orderItemId: 'B', productAmount: 20_000 }),
      ],
      paid,
    )

    expect(breakdown.shippingAmount).toBe(0)
  })
})

describe('배송비 — 누계', () => {
  /**
   * 10,000원짜리 3개, 문턱 25,000원이라 처음엔 무료배송. 하나씩 세 번 취소한다.
   *
   * ① 첫 취소가 문턱을 무너뜨려 3,000원을 재부과하고, ② 두 번째는 **이미 무너진
   * 문턱을 다시 무너뜨릴 수 없으므로** 아무것도 하지 않으며, ③ 마지막은 전량이
   * 되면서 ①의 재부과를 **되돌린다.**
   */
  const line = { orderItemId: 'A', quantity: 3, productAmount: 30_000 }
  const steps = [0, 1, 2].map((refunded) =>
    cancelOf([item({ ...line, refundedUnits: refunded, units: 1 })]),
  )

  it('rebills once when the threshold breaks', () => {
    expect(steps[0]?.shippingAmount).toBe(-3_000)
  })

  it('does not rebill a second time on the next partial refund', () => {
    expect(steps[1]?.shippingAmount).toBe(0)
  })

  it('undoes the rebill when the last unit leaves', () => {
    // 여기가 이 파일의 요점이다. 차분이 없으면 이 값이 0 이고, 전량 취소한 사람의
    // 장부에서 3,000원이 사라진다.
    expect(steps[2]?.shippingAmount).toBe(3_000)
  })

  it('adds up to exactly what the buyer paid', () => {
    const refunded = steps.reduce((sum, step) => sum + step.total, 0)

    // 무료배송이었으므로 실결제금액은 상품금액 그대로다.
    expect(refunded).toBe(30_000)
  })

  it('hands the whole shipping fee to whichever refund finishes the order', () => {
    // 낸 배송비가 있는 주문도 같다 — 마지막 한 건만 그것을 가져간다.
    const paid: SellerShippingFacts = {
      chargedShippingFee: 3_000,
      standardShippingFee: 3_000,
      freeShippingThreshold: null,
    }
    const halves = [0, 1].map((refunded) =>
      cancelOf(
        [
          item({
            orderItemId: 'A',
            quantity: 2,
            productAmount: 20_000,
            refundedUnits: refunded,
            units: 1,
          }),
        ],
        paid,
      ),
    )

    expect(halves.map((half) => half.shippingAmount)).toEqual([0, 3_000])
    expect(halves.reduce((sum, half) => sum + half.total, 0)).toBe(23_000)
  })
})

describe('반품', () => {
  it('gives the original shipping back when the seller is at fault', () => {
    const items = [item({ orderItemId: 'A', productAmount: 20_000, units: 1 })]
    const breakdown = claimRefundBreakdown(
      items,
      returnShipping({
        originalShippingRefund: 3_000,
        returnShippingDeduction: 0,
        sellerAtFault: true,
      }),
    )

    expect(breakdown).toMatchObject({ itemsAmount: 20_000, shippingAmount: 3_000, total: 23_000 })
  })

  it('deducts the return shipping from a change of mind', () => {
    const items = [item({ orderItemId: 'A', productAmount: 20_000, units: 1 })]
    const breakdown = claimRefundBreakdown(
      items,
      returnShipping({
        originalShippingRefund: 0,
        returnShippingDeduction: 3_000,
        sellerAtFault: false,
      }),
    )

    expect(breakdown).toMatchObject({ shippingAmount: -3_000, total: 17_000 })
  })

  it('never turns a refund into a bill', () => {
    // 반품비가 항목 환불액보다 큰 경우 — 아주 싼 물건의 변심 반품이다. 그 차액을
    // 어떻게 받을지는 이 TASK 의 것이 아니고, 여기서는 0에서 바닥을 친다.
    const items = [item({ orderItemId: 'A', productAmount: 2_000, units: 1 })]
    const breakdown = claimRefundBreakdown(
      items,
      returnShipping({
        originalShippingRefund: 0,
        returnShippingDeduction: 3_000,
        sellerAtFault: false,
      }),
    )

    expect(breakdown.total).toBe(0)
    // 총액이 바닥을 쳐도 **조정액의 부호는 남는다.** 화면이 「반품비 3,000원 차감」을
    // 그려야 하고, 두 값을 합쳐 버리면 아무 일도 없었던 것처럼 보인다.
    expect(breakdown.shippingAmount).toBe(-3_000)
  })
})
