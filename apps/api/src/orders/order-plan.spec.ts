/**
 * 저장할 행을 정하는 판단 (TASK-0049 6.2). 입력 → 출력, 분기 100%.
 */

import type { PricedOrder } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { OrderLine } from './order-plan.js'
import { planOrder } from './order-plan.js'

function line(overrides: Partial<OrderLine> & Pick<OrderLine, 'itemId' | 'sellerId'>): OrderLine {
  return {
    variantId: `variant-${overrides.itemId}`,
    brandName: `브랜드 ${overrides.sellerId}`,
    unitPrice: 10_000,
    quantity: 1,
    snapshot: {
      productId: `product-${overrides.itemId}`,
      productName: '오버사이즈 코트',
      optionLabel: '블랙 / M',
      sku: 'COAT-1',
      thumbnailUrl: null,
      brandName: `브랜드 ${overrides.sellerId}`,
    },
    ...overrides,
  }
}

/** 항목 하나에 10,000원, 배송비 없음 — 숫자가 아니라 배선을 보는 픽스처다. */
function priced(overrides: Partial<PricedOrder> = {}): PricedOrder {
  return {
    items: [
      {
        itemId: 'a',
        sellerId: 's1',
        productAmount: 10_000,
        couponDiscountAmount: 1_000,
        pointDiscountAmount: 500,
        discountAmount: 1_500,
      },
    ],
    sellerOrders: [
      {
        sellerId: 's1',
        productAmount: 10_000,
        couponDiscountAmount: 1_000,
        pointDiscountAmount: 500,
        shippingPointAmount: 200,
        discountAmount: 1_500,
        shippingFee: 3_000,
        paidAmount: 11_300,
      },
    ],
    totalProductAmount: 10_000,
    totalCouponDiscountAmount: 1_000,
    totalPointDiscountAmount: 700,
    totalDiscountAmount: 1_700,
    totalShippingFee: 3_000,
    paidAmount: 11_300,
    ...overrides,
  }
}

describe('묶기', () => {
  it('carries the calculation onto each line', () => {
    const plan = planOrder([line({ itemId: 'a', sellerId: 's1' })], priced())

    expect(plan.sellerOrders).toHaveLength(1)
    expect(plan.sellerOrders[0]?.items[0]).toMatchObject({
      productAmount: 10_000,
      couponDiscountAmount: 1_000,
      pointDiscountAmount: 500,
      discountAmount: 1_500,
    })
    expect(plan.sellerOrders[0]?.shippingPointAmount).toBe(200)
  })

  it('puts two lines of one seller in one group', () => {
    const plan = planOrder(
      [line({ itemId: 'a', sellerId: 's1' }), line({ itemId: 'b', sellerId: 's1' })],
      priced({
        items: [
          ...priced().items,
          {
            itemId: 'b',
            sellerId: 's1',
            productAmount: 5_000,
            couponDiscountAmount: 0,
            pointDiscountAmount: 0,
            discountAmount: 0,
          },
        ],
      }),
    )

    // 한 판매자는 한 몫이다. 두 줄이면 그 판매자의 배송비가 두 번 붙는다.
    expect(plan.sellerOrders).toHaveLength(1)
    expect(plan.sellerOrders[0]?.items).toHaveLength(2)
  })

  it('keeps the order the lines arrived in, not the calculation’s', () => {
    // 판매자 id 로 정렬하면 화면의 순서가 uuid 값으로 정해진다 — 사람에게 아무
    // 뜻이 없다. 장바구니에서 보던 순서가 유지되는 편이 낫다.
    const answer = priced({
      items: [
        {
          itemId: 'a',
          sellerId: 's1',
          productAmount: 10_000,
          couponDiscountAmount: 0,
          pointDiscountAmount: 0,
          discountAmount: 0,
        },
        {
          itemId: 'b',
          sellerId: 's2',
          productAmount: 5_000,
          couponDiscountAmount: 0,
          pointDiscountAmount: 0,
          discountAmount: 0,
        },
      ],
      sellerOrders: [
        {
          sellerId: 's2',
          productAmount: 5_000,
          couponDiscountAmount: 0,
          pointDiscountAmount: 0,
          shippingPointAmount: 0,
          discountAmount: 0,
          shippingFee: 0,
          paidAmount: 5_000,
        },
        {
          sellerId: 's1',
          productAmount: 10_000,
          couponDiscountAmount: 0,
          pointDiscountAmount: 0,
          shippingPointAmount: 0,
          discountAmount: 0,
          shippingFee: 0,
          paidAmount: 10_000,
        },
      ],
    })
    const plan = planOrder(
      [line({ itemId: 'a', sellerId: 's1' }), line({ itemId: 'b', sellerId: 's2' })],
      answer,
    )

    expect(plan.sellerOrders.map((entry) => entry.sellerId)).toEqual(['s1', 's2'])
  })
})

describe('어긋난 계산 결과', () => {
  it('refuses a line the calculation says nothing about', () => {
    // 조용히 건너뛰면 주문 금액이 항목 합보다 적어지고, 그 차액은 아무 데도
    // 기록되지 않는다.
    expect(() => planOrder([line({ itemId: 'ghost', sellerId: 's1' })], priced())).toThrow(
      '계산 결과에 없는 주문 줄입니다: ghost',
    )
  })

  it('refuses a seller the calculation has no total for', () => {
    expect(() =>
      planOrder([line({ itemId: 'a', sellerId: 's1' })], priced({ sellerOrders: [] })),
    ).toThrow('계산 결과에 없는 판매자입니다: s1')
  })
})

describe('합계', () => {
  it('is the calculation’s own, not a re-addition', () => {
    // 다시 더하면 반올림이 두 번 일어난다. 합계는 계산 엔진이 이미 낸 값이다.
    const plan = planOrder([line({ itemId: 'a', sellerId: 's1' })], priced())

    expect(plan).toMatchObject({
      totalProductAmount: 10_000,
      totalCouponDiscountAmount: 1_000,
      totalPointDiscountAmount: 700,
      totalShippingFee: 3_000,
      paidAmount: 11_300,
    })
  })
})
