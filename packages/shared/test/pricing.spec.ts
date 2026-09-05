/**
 * 금액 계산 (TASK-0047 F1–F8). Q5 강화 — 분기 커버리지 100%.
 *
 * **금액이 틀리면 실제 돈이 틀어진다.** 그리고 그 틀어짐은 실패하지 않는다 —
 * 화면은 숫자를 그대로 그리고, 어긋난 1원은 정산까지 조용히 따라간다. 그래서
 * 경계마다 짚고, 마지막에는 무작위 입력으로 합계 보존을 확인한다.
 *
 * `docs/design/pricing.md` 가 명세다. 여기 단언과 그 문서가 어긋나면 **문서를 먼저**
 * 고친다.
 */

import { describe, expect, it } from 'vitest'

import { allocate } from '../src/pricing/allocate.js'
import { calculateOrder } from '../src/pricing/calculate.js'
import { quoteRefund } from '../src/pricing/refund.js'
import type { PricingDiscount, PricingInput, PricingItem } from '../src/pricing/types.js'

function item(overrides: Partial<PricingItem> & { itemId: string }): PricingItem {
  return { sellerId: 's1', unitPrice: 10_000, quantity: 1, ...overrides }
}

function coupon(amount: number, overrides: Partial<PricingDiscount> = {}): PricingDiscount {
  return {
    id: `c-${String(amount)}`,
    type: 'COUPON',
    scope: 'ORDER',
    amount,
    bearer: 'PLATFORM',
    ...overrides,
  }
}

function point(amount: number): PricingDiscount {
  return { id: 'p', type: 'POINT', scope: 'ORDER', amount, bearer: 'PLATFORM' }
}

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  return { items: [], discounts: [], shippingPolicies: [], ...overrides }
}

describe('안분 (F2 · F3)', () => {
  it('splits in proportion', () => {
    const shares = [
      { item: 'a', weight: 30_000 },
      { item: 'b', weight: 20_000 },
    ]

    expect(allocate(5_000, shares)).toEqual([
      { item: 'a', amount: 3_000 },
      { item: 'b', amount: 2_000 },
    ])
  })

  it('never loses the remainder — the sum is exactly the total (F2)', () => {
    const shares = [
      { item: 'a', weight: 10_000 },
      { item: 'b', weight: 10_000 },
      { item: 'c', weight: 10_000 },
    ]
    const allocated = allocate(10_000, shares)

    // floor 셋의 합은 9,999다. 남은 1원을 버리면 「할인 10,000원」이라고 적힌
    // 화면과 실제로 빠진 금액이 어긋난다.
    expect(allocated.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10_000)
  })

  it('gives the remainder to the largest, and to the first of a tie (F3)', () => {
    const shares = [
      { item: 'a', weight: 10_000 },
      { item: 'b', weight: 10_000 },
      { item: 'c', weight: 10_000 },
    ]

    expect(allocate(10_000, shares).map((entry) => entry.amount)).toEqual([3_334, 3_333, 3_333])
  })

  it('gives it to the genuinely largest when there is one', () => {
    const allocated = allocate(10_000, [
      { item: 'small', weight: 1_000 },
      { item: 'big', weight: 9_001 },
    ])

    const amountOf = (name: string): number =>
      allocated.find((entry) => entry.item === name)?.amount ?? 0

    expect(allocated.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10_000)
    expect(amountOf('big')).toBeGreaterThan(amountOf('small'))
  })

  it('gives nobody anything when there is nothing to weigh by', () => {
    // 균등 분배는 그럴듯해 보이지만 「0원짜리 항목에 할인 3,333원이 붙어 있다」를
    // 만들고, 부분 취소에서 그 금액이 환불액에서 빠진다.
    expect(allocate(10_000, [{ item: 'a', weight: 0 }]).map((entry) => entry.amount)).toEqual([0])
    expect(allocate(10_000, [])).toEqual([])
  })

  it('allocates nothing for a zero or negative total', () => {
    expect(allocate(0, [{ item: 'a', weight: 100 }]).map((entry) => entry.amount)).toEqual([0])
    expect(allocate(-5, [{ item: 'a', weight: 100 }]).map((entry) => entry.amount)).toEqual([0])
  })
})

describe('F1 · F6 — 기본 계산', () => {
  it('adds up three items with no discounts at all', () => {
    const priced = calculateOrder(
      input({
        items: [
          item({ itemId: 'a', unitPrice: 10_000, quantity: 2 }),
          item({ itemId: 'b', unitPrice: 5_000 }),
          item({ itemId: 'c', unitPrice: 1_000, quantity: 3 }),
        ],
      }),
    )

    expect(priced.totalProductAmount).toBe(28_000)
    expect(priced.totalDiscountAmount).toBe(0)
    expect(priced.paidAmount).toBe(28_000)
  })

  it('answers for an empty order rather than dividing by nothing', () => {
    expect(calculateOrder(input())).toMatchObject({
      totalProductAmount: 0,
      paidAmount: 0,
      items: [],
      sellerOrders: [],
    })
  })
})

describe('F4 — 판매자 소계', () => {
  it('sums to the whole, seller by seller', () => {
    const priced = calculateOrder(
      input({
        items: [
          item({ itemId: 'a', sellerId: 's1', unitPrice: 30_000 }),
          item({ itemId: 'b', sellerId: 's2', unitPrice: 20_000 }),
        ],
        discounts: [coupon(5_000)],
      }),
    )

    expect(priced.sellerOrders).toHaveLength(2)
    expect(priced.sellerOrders.reduce((sum, entry) => sum + entry.productAmount, 0)).toBe(
      priced.totalProductAmount,
    )
    expect(priced.sellerOrders.reduce((sum, entry) => sum + entry.paidAmount, 0)).toBe(
      priced.paidAmount,
    )
  })

  it('confines a seller coupon to that seller’s items', () => {
    const priced = calculateOrder(
      input({
        items: [
          item({ itemId: 'a', sellerId: 's1', unitPrice: 30_000 }),
          item({ itemId: 'b', sellerId: 's2', unitPrice: 20_000 }),
        ],
        discounts: [coupon(5_000, { scope: 'SELLER', targetId: 's2', bearer: 'SELLER' })],
      }),
    )

    expect(priced.items.find((entry) => entry.itemId === 'a')?.couponDiscountAmount).toBe(0)
    expect(priced.items.find((entry) => entry.itemId === 'b')?.couponDiscountAmount).toBe(5_000)
  })

  it('puts an item coupon on that item alone', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a' }), item({ itemId: 'b' })],
        discounts: [coupon(3_000, { scope: 'ITEM', targetId: 'b' })],
      }),
    )

    expect(priced.items.find((entry) => entry.itemId === 'b')?.couponDiscountAmount).toBe(3_000)
  })

  it('drops a discount whose target is not in the order rather than throwing', () => {
    // 장바구니에서 항목 하나를 빼고 다시 계산하는 것이 정상 경로다. 그때 그 항목에
    // 붙어 있던 할인은 그냥 사라져야 한다.
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a' })],
        discounts: [coupon(3_000, { scope: 'ITEM', targetId: 'gone' })],
      }),
    )

    expect(priced.totalCouponDiscountAmount).toBe(0)
    expect(priced.paidAmount).toBe(10_000)
  })
})

describe('F5 — 배송비', () => {
  it('charges when the threshold is not met', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 })],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
      }),
    )

    expect(priced.totalShippingFee).toBe(3_000)
    expect(priced.paidAmount).toBe(13_000)
  })

  it('waives it at exactly the threshold', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 50_000 })],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
      }),
    )

    expect(priced.totalShippingFee).toBe(0)
  })

  it('always charges when there is no free condition', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 999_000 })],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: null }],
      }),
    )

    expect(priced.totalShippingFee).toBe(3_000)
  })

  it('charges nothing when no policy was given', () => {
    // 「모르니까 일단 3,000원」은 아무도 동의한 적 없는 금액을 청구하는 일이다.
    expect(calculateOrder(input({ items: [item({ itemId: 'a' })] })).totalShippingFee).toBe(0)
  })

  it('judges the threshold after coupons — a coupon can bring the fee back', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 50_000 })],
        discounts: [coupon(5_000)],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
      }),
    )

    // 쿠폰이 값을 깎으므로 판매자가 물건 값으로 받는 돈이 실제로 줄었다.
    expect(priced.totalShippingFee).toBe(3_000)
  })

  it('does not let points cost somebody their free shipping', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 50_000 })],
        discounts: [point(5_000)],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
      }),
    )

    // 「적립금 5,000원을 썼더니 배송비 3,000원이 붙었다」는 설명할 수 없는 화면이다.
    expect(priced.totalShippingFee).toBe(0)
  })

  it('charges each seller its own', () => {
    const priced = calculateOrder(
      input({
        items: [
          item({ itemId: 'a', sellerId: 's1', unitPrice: 10_000 }),
          item({ itemId: 'b', sellerId: 's2', unitPrice: 60_000 }),
        ],
        shippingPolicies: [
          { sellerId: 's1', fee: 3_000, freeThreshold: 50_000 },
          { sellerId: 's2', fee: 2_500, freeThreshold: 50_000 },
        ],
      }),
    )

    expect(priced.totalShippingFee).toBe(3_000)
  })
})

describe('적립금 (⑤)', () => {
  it('comes off after coupons and shipping are settled', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 20_000 })],
        discounts: [coupon(5_000), point(3_000)],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: null }],
      }),
    )

    // 20,000 − 5,000 + 3,000 − 3,000
    expect(priced.paidAmount).toBe(15_000)
  })

  it('is capped at what is left to pay rather than throwing', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 })],
        discounts: [point(99_000)],
      }),
    )

    // 「그만큼 쓸 수 있는가」는 잔액을 아는 쪽이 물을 질문이다. 여기서 할 수 있는
    // 정직한 일은 낼 돈보다 많이 깎지 않는 것뿐이다.
    expect(priced.totalPointDiscountAmount).toBe(10_000)
    expect(priced.paidAmount).toBe(0)
  })

  it('is weighed by what a coupon left on each item', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 }), item({ itemId: 'b', unitPrice: 10_000 })],
        discounts: [coupon(10_000, { scope: 'ITEM', targetId: 'a' }), point(4_000)],
      }),
    )

    // a 는 쿠폰으로 0원이 됐다. 거기에 적립금을 더 붙이면 그 항목의 할인이
    // 상품금액을 넘는다.
    expect(priced.items.find((entry) => entry.itemId === 'a')?.pointDiscountAmount).toBe(0)
    expect(priced.items.find((entry) => entry.itemId === 'b')?.pointDiscountAmount).toBe(4_000)
  })
})

describe('F7 — 환불 역산', () => {
  const order = calculateOrder(
    input({
      items: [item({ itemId: 'a', unitPrice: 30_000 }), item({ itemId: 'b', unitPrice: 20_000 })],
      discounts: [coupon(5_000)],
      shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 40_000 }],
    }),
  )

  it('subtracts the discount that was sitting on the cancelled item', () => {
    const quote = quoteRefund(order, ['b'], [{ sellerId: 's1', fee: 3_000, freeThreshold: 40_000 }])

    // 20,000원이 아니라 18,000원이다 — b 에 붙어 있던 할인 2,000원을 빼야 한다.
    expect(quote.itemAmount).toBe(18_000)
  })

  it('charges the shipping again when what is left no longer qualifies', () => {
    const quote = quoteRefund(order, ['b'], [{ sellerId: 's1', fee: 3_000, freeThreshold: 40_000 }])

    // 처음 45,000원(쿠폰 반영)이라 무료였다. a 만 남으면 27,000원이라 미달이다.
    expect(quote.shippingAdjustment).toBe(-3_000)
    expect(quote.refundAmount).toBe(15_000)
  })

  it('returns the shipping in full when the whole store is cancelled', () => {
    const charged = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 })],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
      }),
    )
    const quote = quoteRefund(
      charged,
      ['a'],
      [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
    )

    expect(quote.shippingAdjustment).toBe(3_000)
    expect(quote.refundAmount).toBe(13_000)
  })

  it('leaves the shipping alone when what is left still qualifies', () => {
    const big = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 60_000 }), item({ itemId: 'b', unitPrice: 10_000 })],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }],
      }),
    )
    const quote = quoteRefund(big, ['b'], [{ sellerId: 's1', fee: 3_000, freeThreshold: 50_000 }])

    expect(quote.shippingAdjustment).toBe(0)
  })

  it('makes no shipping judgement without a policy', () => {
    const quote = quoteRefund(order, ['b'], [])

    expect(quote.shippingAdjustment).toBe(0)
  })

  it('never asks the person for money', () => {
    const tiny = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 49_000 }), item({ itemId: 'b', unitPrice: 1_000 })],
        shippingPolicies: [{ sellerId: 's1', fee: 30_000, freeThreshold: 50_000 }],
      }),
    )
    const quote = quoteRefund(tiny, ['b'], [{ sellerId: 's1', fee: 30_000, freeThreshold: 50_000 }])

    // 재부과 30,000원이 항목 환불액 1,000원보다 크다. 환불은 돌려주는 일이지
    // 받아내는 일이 아니다.
    expect(quote.refundAmount).toBe(0)
  })

  it('answers zero for cancelling nothing', () => {
    expect(quoteRefund(order, [], []).refundAmount).toBe(0)
  })
})

describe('적립금이 배송비를 낼 때', () => {
  it('keeps the shipping share off the items', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 })],
        discounts: [point(13_000)],
        shippingPolicies: [{ sellerId: 's1', fee: 3_000, freeThreshold: null }],
      }),
    )

    // 명세가 「① − ③ + ④ 범위 내에서」라 적립금은 배송비도 낼 수 있다. 그 몫까지
    // 항목에 붙이면 항목의 할인이 상품금액을 넘고, 부분 취소에서 환불액이 음수가
    // 된다 — F8 이 실제로 그 상태를 잡아냈다.
    expect(priced.items[0]?.pointDiscountAmount).toBe(10_000)
    expect(priced.sellerOrders[0]?.shippingPointAmount).toBe(3_000)
    expect(priced.totalPointDiscountAmount).toBe(13_000)
    expect(priced.paidAmount).toBe(0)
  })

  it('splits the shipping share between stores by what each charges', () => {
    const priced = calculateOrder(
      input({
        items: [
          item({ itemId: 'a', sellerId: 's1', unitPrice: 1_000 }),
          item({ itemId: 'b', sellerId: 's2', unitPrice: 1_000 }),
        ],
        discounts: [point(8_000)],
        shippingPolicies: [
          { sellerId: 's1', fee: 3_000, freeThreshold: null },
          { sellerId: 's2', fee: 3_000, freeThreshold: null },
        ],
      }),
    )

    expect(priced.sellerOrders.map((entry) => entry.shippingPointAmount)).toEqual([3_000, 3_000])
    expect(priced.paidAmount).toBe(0)
  })
})

describe('깎을 수 있는 것보다 큰 쿠폰', () => {
  it('is applied as far as it reaches and no further', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 })],
        discounts: [coupon(20_000)],
      }),
    )

    // 나머지 10,000원은 아무 데도 가지 않는다. 안분해 버리면 항목의 할인이
    // 상품금액을 넘는다.
    expect(priced.totalCouponDiscountAmount).toBe(10_000)
    expect(priced.items[0]?.couponDiscountAmount).toBe(10_000)
    expect(priced.paidAmount).toBe(0)
  })

  it('leaves nothing for a second coupon once the first used it all up', () => {
    const priced = calculateOrder(
      input({
        items: [item({ itemId: 'a', unitPrice: 10_000 })],
        discounts: [
          coupon(10_000, { scope: 'ORDER' }),
          coupon(5_000, { scope: 'ITEM', targetId: 'a' }),
        ],
      }),
    )

    expect(priced.totalCouponDiscountAmount).toBe(10_000)
  })
})

describe('한도가 걸린 안분', () => {
  it('spills to the next share rather than overshooting the largest', () => {
    // 무게 `[2,2,2]` 에 5원: `floor` 셋이 1원씩이고 잔여가 2원인데, 그것을 첫
    // 항목에 다 주면 3원이 되어 자기 무게보다 많다.
    const allocated = allocate(5, [
      { item: 'a', weight: 2, cap: 2 },
      { item: 'b', weight: 2, cap: 2 },
      { item: 'c', weight: 2, cap: 2 },
    ])

    expect(allocated.map((entry) => entry.amount)).toEqual([2, 2, 1])
    expect(allocated.reduce((sum, entry) => sum + entry.amount, 0)).toBe(5)
  })

  it('stops when every share is full', () => {
    expect(allocate(10, [{ item: 'a', weight: 2, cap: 2 }])[0]?.amount).toBe(2)
  })
})

describe('F8 — 무작위 입력에서 합계가 보존된다', () => {
  /** 재현 가능한 난수. 실패했을 때 같은 입력을 다시 만들 수 있어야 한다. */
  function mulberry32(seed: number): () => number {
    let state = seed

    return () => {
      state = (state + 0x6d2b79f5) | 0

      let t = Math.imul(state ^ (state >>> 15), 1 | state)

      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('holds over a thousand random orders', () => {
    const random = mulberry32(20260905)

    for (let round = 0; round < 1_000; round += 1) {
      const itemCount = 1 + Math.floor(random() * 6)
      const sellerCount = 1 + Math.floor(random() * 3)
      const items = Array.from({ length: itemCount }, (_unused, index) =>
        item({
          itemId: `i${String(index)}`,
          sellerId: `s${String(Math.floor(random() * sellerCount))}`,
          unitPrice: Math.floor(random() * 100_000),
          quantity: 1 + Math.floor(random() * 4),
        }),
      )
      const discounts: PricingDiscount[] = []

      if (random() < 0.7) discounts.push(coupon(Math.floor(random() * 30_000)))
      if (random() < 0.5) discounts.push(point(Math.floor(random() * 30_000)))

      const priced = calculateOrder(
        input({
          items,
          discounts,
          shippingPolicies: Array.from({ length: sellerCount }, (_unused, index) => ({
            sellerId: `s${String(index)}`,
            fee: 3_000,
            freeThreshold: random() < 0.5 ? 50_000 : null,
          })),
        }),
      )

      const itemCoupons = priced.items.reduce((sum, entry) => sum + entry.couponDiscountAmount, 0)
      const itemPoints = priced.items.reduce((sum, entry) => sum + entry.pointDiscountAmount, 0)
      const shippingPoints = priced.sellerOrders.reduce(
        (sum, entry) => sum + entry.shippingPointAmount,
        0,
      )

      // ① 안분의 합이 전체와 1원도 어긋나지 않는다. 적립금은 **배송비를 낸 몫까지
      // 더해야** 전체가 된다 — 그 몫은 항목에 붙지 않는다.
      expect(itemCoupons).toBe(priced.totalCouponDiscountAmount)
      expect(itemPoints + shippingPoints).toBe(priced.totalPointDiscountAmount)

      // ② 판매자 소계의 합이 전체와 일치한다.
      expect(priced.sellerOrders.reduce((sum, entry) => sum + entry.paidAmount, 0)).toBe(
        priced.paidAmount,
      )
      expect(priced.sellerOrders.reduce((sum, entry) => sum + entry.productAmount, 0)).toBe(
        priced.totalProductAmount,
      )

      // ③ 전부 정수이고, 낼 돈이 음수가 되지 않는다.
      expect(Number.isInteger(priced.paidAmount)).toBe(true)
      expect(priced.paidAmount).toBeGreaterThanOrEqual(0)

      // ④ 어떤 항목도 자기 상품금액보다 많이 할인되지 않는다.
      for (const entry of priced.items) {
        expect(entry.discountAmount).toBeLessThanOrEqual(entry.productAmount)
      }
    }
  })
})
