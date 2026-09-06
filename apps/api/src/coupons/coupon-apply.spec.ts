/**
 * 쿠폰이 주문서에 닿는 판단 (TASK-0075 6.2, Q5 강화). 입력 → 출력, 분기 100%.
 *
 * 세 가지를 잰다. **누가 닿는가**(범위) · **얼마를 깎는가**(기준 금액) · **어느
 * 조합이 낫는가**(추천). 셋 다 빨간 검사가 아니라 금액 하나로 틀리는 종류라, 여기서
 * 밟지 않은 갈래는 프로덕션에서 처음 밟힌다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ShippingPolicy } from '@shopping/shared'
import { calculateOrder } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

import type { CouponCandidate, CouponLine } from './coupon-apply.js'
import {
  applyCoupons,
  discountOf,
  evaluateCoupon,
  orderedSelection,
  reachOf,
  recommendCoupons,
  RECOMMENDATION_COMBINATION_LIMIT,
  selectionFault,
  toPricingDiscounts,
} from './coupon-apply.js'

const NOW = new Date('2026-09-06T00:00:00.000Z')

/** 한 줄. 10,000원짜리 하나가 기본이고, 스펙마다 한 칸씩만 어긋뜨린다. */
function line(overrides: Partial<CouponLine> & Pick<CouponLine, 'itemId'>): CouponLine {
  return {
    sellerId: 'seller-a',
    productId: `product-${overrides.itemId}`,
    categoryPath: '/1/5/',
    unitPrice: 10_000,
    quantity: 1,
    ...overrides,
  }
}

/** 전체 적용 · 정액 3,000원 · 유효기간 안. */
function coupon(overrides: Partial<CouponCandidate> = {}): CouponCandidate {
  return {
    userCouponId: 'uc-1',
    couponId: 'c-1',
    name: '가을 쿠폰',
    issuerType: 'PLATFORM',
    sellerId: null,
    status: 'ISSUED',
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    discountType: 'FIXED',
    discountValue: 3_000,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    scopeType: 'ALL',
    scopeIds: [],
    ...overrides,
  }
}

function sellerCoupon(sellerId: string, overrides: Partial<CouponCandidate> = {}): CouponCandidate {
  return coupon({
    userCouponId: `uc-${sellerId}`,
    couponId: `c-${sellerId}`,
    issuerType: 'SELLER',
    sellerId,
    scopeType: 'SELLER',
    scopeIds: [sellerId],
    ...overrides,
  })
}

const FREE_SHIPPING: readonly ShippingPolicy[] = [
  { sellerId: 'seller-a', fee: 0, freeThreshold: null },
  { sellerId: 'seller-b', fee: 0, freeThreshold: null },
]

/**
 * 이 파일이 유일하게 밖을 보는 자리 — 문서와 코드가 갈리지 않는지 재기 위해서다.
 *
 * 장을 못 찾았는데 조용히 빈 문자열을 돌려주면 이 절 전체가 「빈 것끼리 같다」로
 * 통과한다. 문서를 못 읽은 것과 문서가 비어 있는 것은 다른 사건이므로 던진다
 * (`refund-calc.spec.ts` 가 같은 장치를 쓴다).
 */
function couponChapter(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const document = readFileSync(join(root, 'docs', 'design', 'pricing.md'), 'utf8')
  const chapter = /^## 3\. 쿠폰 적용 규칙[\s\S]*?(?=^## )/mu.exec(document)

  if (chapter === null) throw new Error('pricing.md 의 3장을 찾지 못했습니다.')

  return chapter[0]
}

describe('0. 설계 문서와 같은 것을 말하는가', () => {
  /**
   * **표를 여기 다시 적으면 이 검사는 코드를 코드와 비교하게 된다.** 문서가
   * 기준이고(CLAUDE.md 1장), 문서가 바뀌었는데 코드가 안 바뀌면 여기가 빨개져야 한다.
   */
  it('중복 사용 규칙이 문서에 적혀 있다 (D2)', () => {
    expect(couponChapter()).toContain('**플랫폼 1장 + 판매자당 1장**')
  })

  it('적용 순서가 문서에 적혀 있다', () => {
    expect(couponChapter()).toContain('적용 순서는 **플랫폼 → 판매자**다')
  })

  /** 추천이 무엇을 최소화하는지 — 이 한 줄이 바뀌면 `recommendCoupons` 가 바뀐다. */
  it('최대 할인 조합의 기준이 「낼 돈」이라고 문서가 말한다', () => {
    expect(couponChapter()).toContain('최대 할인 조합은 **낼 돈이 가장 적은** 조합이다')
  })

  /** 상한이 코드와 문서에서 같은 수인가. 갈리면 근사로 답하는 지점이 갈린다. */
  it('전수 탐색의 상한이 코드와 같다', () => {
    expect(couponChapter()).toContain(`상한(${String(RECOMMENDATION_COMBINATION_LIMIT)})`)
  })
})

describe('범위 — 누가 닿는가', () => {
  const lines = [
    line({ itemId: 'a', sellerId: 'seller-a', productId: 'p-1', categoryPath: '/1/5/' }),
    line({ itemId: 'b', sellerId: 'seller-b', productId: 'p-2', categoryPath: '/1/6/12/' }),
  ]

  it('reaches everything when the scope is ALL', () => {
    expect(reachOf(coupon(), lines).map((entry) => entry.itemId)).toEqual(['a', 'b'])
  })

  it('reaches one store when the scope is SELLER', () => {
    const scoped = coupon({ scopeType: 'SELLER', scopeIds: ['seller-b'] })

    expect(reachOf(scoped, lines).map((entry) => entry.itemId)).toEqual(['b'])
  })

  it('reaches one product when the scope is PRODUCT', () => {
    const scoped = coupon({ scopeType: 'PRODUCT', scopeIds: ['p-1'] })

    expect(reachOf(scoped, lines).map((entry) => entry.itemId)).toEqual(['a'])
  })

  /**
   * **조상이어도 닿는다.** 「셔츠」 쿠폰이 「반팔 셔츠」에 안 붙으면 발행자는 잎
   * 카테고리를 전부 나열해야 하고, 나중에 추가된 잎은 아무도 다시 나열해 주지 않는다.
   */
  it('reaches descendants of a CATEGORY scope', () => {
    const scoped = coupon({ scopeType: 'CATEGORY', scopeIds: ['6'] })

    expect(reachOf(scoped, lines).map((entry) => entry.itemId)).toEqual(['b'])
  })

  it('reaches both when the CATEGORY scope is their common ancestor', () => {
    const scoped = coupon({ scopeType: 'CATEGORY', scopeIds: ['1'] })

    expect(reachOf(scoped, lines).map((entry) => entry.itemId)).toEqual(['a', 'b'])
  })

  /**
   * **`/12/` 로 감싸 견주는 이유.** 감싸지 않으면 카테고리 1이 문자열 포함만으로
   * 11 · 21 · 120 에까지 붙고, 그 쿠폰은 발행자가 지정한 적 없는 상품을 깎는다.
   */
  it('does not confuse category 1 with category 12', () => {
    const scoped = coupon({ scopeType: 'CATEGORY', scopeIds: ['2'] })

    expect(reachOf(scoped, lines)).toEqual([])
  })
})

describe('할인액 — 얼마를 깎는가', () => {
  it('takes the fixed amount as it is', () => {
    expect(discountOf(coupon({ discountValue: 3_000 }), 10_000)).toBe(3_000)
  })

  /** 상품금액보다 큰 정액 쿠폰은 **거기까지만**이다. 나머지는 아무 데도 가지 않는다. */
  it('never promises more than the reach is worth', () => {
    expect(discountOf(coupon({ discountValue: 20_000 }), 10_000)).toBe(10_000)
  })

  it('floors a percentage', () => {
    const percent = coupon({ discountType: 'PERCENT', discountValue: 7 })

    expect(discountOf(percent, 10_050)).toBe(703)
  })

  it('stops at the ceiling of a percentage coupon', () => {
    const percent = coupon({ discountType: 'PERCENT', discountValue: 50, maxDiscountAmount: 3_000 })

    expect(discountOf(percent, 100_000)).toBe(3_000)
  })

  it('leaves a percentage alone when it stays under the ceiling', () => {
    const percent = coupon({ discountType: 'PERCENT', discountValue: 10, maxDiscountAmount: 5_000 })

    expect(discountOf(percent, 10_000)).toBe(1_000)
  })
})

describe('판정 — 쓸 수 있는가', () => {
  const lines = [line({ itemId: 'a' })]

  it('accepts a live coupon', () => {
    expect(evaluateCoupon(coupon(), lines, NOW)).toEqual({
      fault: null,
      discountAmount: 3_000,
      reach: lines,
    })
  })

  it('refuses a coupon that is already spent', () => {
    expect(evaluateCoupon(coupon({ status: 'USED' }), lines, NOW).fault).toBe('already_used')
  })

  it('refuses a coupon the batch has already retired', () => {
    expect(evaluateCoupon(coupon({ status: 'EXPIRED' }), lines, NOW).fault).toBe('expired')
  })

  /**
   * **배치보다 시각이 먼저다.** 만료 전환은 1분마다 도는 배치이므로(`coupon-expiry.ts`)
   * 그 사이에 만료된 장은 아직 `ISSUED` 다. 시각을 보지 않으면 주문서가 그것을 쓸 수
   * 있는 쿠폰으로 그리고, 고른 사람은 주문 직전에 거절당한다.
   */
  it('refuses a coupon whose moment has passed even while the row still says ISSUED', () => {
    const passed = coupon({ expiresAt: new Date(NOW.getTime() - 1) })

    expect(evaluateCoupon(passed, lines, NOW).fault).toBe('expired')
  })

  /** 끝은 열린 구간이다 — 발급 판정(`issuabilityFault`)과 같은 순간을 가리켜야 한다. */
  it('treats the expiry instant itself as expired', () => {
    expect(evaluateCoupon(coupon({ expiresAt: NOW }), lines, NOW).fault).toBe('expired')
  })

  it('refuses a coupon whose policy has not started', () => {
    const early = coupon({ validFrom: new Date(NOW.getTime() + 1) })

    expect(evaluateCoupon(early, lines, NOW).fault).toBe('not_started')
  })

  it('refuses a coupon that reaches nothing in this order', () => {
    const elsewhere = coupon({ scopeType: 'SELLER', scopeIds: ['seller-z'] })

    expect(evaluateCoupon(elsewhere, lines, NOW).fault).toBe('out_of_scope')
  })

  it('refuses a coupon below its minimum', () => {
    const strict = coupon({ minOrderAmount: 10_001 })

    expect(evaluateCoupon(strict, lines, NOW).fault).toBe('below_minimum')
  })

  it('accepts a coupon exactly at its minimum', () => {
    expect(evaluateCoupon(coupon({ minOrderAmount: 10_000 }), lines, NOW).fault).toBeNull()
  })

  /**
   * **최소 주문금액도 쿠폰이 닿는 줄로 잰다.** 주문 전체로 재면 「최소 주문금액은
   * 넘었는데 할인은 0원」이 생기고, 그 화면은 설명할 수 없다.
   */
  it('measures the minimum against the reach, not the whole order', () => {
    const two = [
      line({ itemId: 'a', sellerId: 'seller-a' }),
      line({ itemId: 'b', sellerId: 'seller-b' }),
    ]
    const scoped = coupon({ scopeType: 'SELLER', scopeIds: ['seller-a'], minOrderAmount: 15_000 })

    expect(evaluateCoupon(scoped, two, NOW).fault).toBe('below_minimum')
  })

  /** 0원짜리를 「쓸 수 있음」으로 내려보내면 사람이 그것을 골라 한 장을 태운다. */
  it('refuses a percentage that rounds down to nothing', () => {
    const tiny = coupon({ discountType: 'PERCENT', discountValue: 1 })

    expect(evaluateCoupon(tiny, [line({ itemId: 'a', unitPrice: 50 })], NOW).fault).toBe(
      'no_discount',
    )
  })
})

describe('중복 규칙 (F4)', () => {
  it('allows one platform coupon and one per seller', () => {
    const selected = [coupon(), sellerCoupon('seller-a'), sellerCoupon('seller-b')]

    expect(selectionFault(selected)).toBeNull()
  })

  it('refuses two platform coupons', () => {
    expect(selectionFault([coupon(), coupon({ userCouponId: 'uc-2' })])).toBe('duplicate_platform')
  })

  it('refuses two coupons of the same seller', () => {
    const twice = [sellerCoupon('seller-a'), sellerCoupon('seller-a', { userCouponId: 'uc-2' })]

    expect(selectionFault(twice)).toBe('duplicate_seller')
  })

  it('has nothing to say about an empty selection', () => {
    expect(selectionFault([])).toBeNull()
  })
})

describe('적용 순서', () => {
  /**
   * **플랫폼이 먼저다.** 잘리는 쪽이 판매자여야 정산 차감이 줄고, 반대로 두면
   * 플랫폼이 광고한 금액이 판매자 쿠폰 때문에 줄어든 채 화면에 남는다.
   */
  it('puts platform coupons first whatever order they arrived in', () => {
    const ordered = orderedSelection([sellerCoupon('seller-a'), coupon()])

    expect(ordered.map((entry) => entry.issuerType)).toEqual(['PLATFORM', 'SELLER'])
  })

  it('keeps the given order among sellers', () => {
    const ordered = orderedSelection([sellerCoupon('seller-b'), sellerCoupon('seller-a')])

    expect(ordered.map((entry) => entry.sellerId)).toEqual(['seller-b', 'seller-a'])
  })
})

describe('계산기가 아는 모양으로 (F1 · F3)', () => {
  const lines = [
    line({ itemId: 'a', sellerId: 'seller-a', productId: 'p-1' }),
    line({ itemId: 'b', sellerId: 'seller-a', productId: 'p-2' }),
    line({ itemId: 'c', sellerId: 'seller-b', productId: 'p-3' }),
  ]

  it('sends an order-wide coupon as one ORDER discount', () => {
    expect(toPricingDiscounts(coupon(), 3_000, lines, lines)).toEqual([
      { id: 'uc-1', type: 'COUPON', scope: 'ORDER', amount: 3_000, bearer: 'PLATFORM' },
    ])
  })

  it('sends a whole store’s reach as one SELLER discount', () => {
    const scoped = sellerCoupon('seller-a')
    const reach = reachOf(scoped, lines)

    expect(toPricingDiscounts(scoped, 3_000, reach, lines)).toEqual([
      {
        id: 'uc-seller-a',
        type: 'COUPON',
        scope: 'SELLER',
        targetId: 'seller-a',
        amount: 3_000,
        bearer: 'SELLER',
      },
    ])
  })

  /**
   * **상품·카테고리 범위는 계산기의 어느 범위에도 맞지 않는다.** 주문의 일부만,
   * 그것도 여러 판매자에 걸쳐 가리킬 수 있어서다. 그래서 그때만 우리가 안분하고,
   * 안분에 계산기와 **같은 `allocate`** 를 쓰는 것이 F8 을 지키는 자리다.
   */
  it('splits a product-scoped reach across the items itself', () => {
    const scoped = coupon({ scopeType: 'PRODUCT', scopeIds: ['p-1', 'p-3'] })
    const reach = reachOf(scoped, lines)

    expect(toPricingDiscounts(scoped, 3_000, reach, lines)).toEqual([
      {
        id: 'uc-1:a',
        type: 'COUPON',
        scope: 'ITEM',
        targetId: 'a',
        amount: 1_500,
        bearer: 'PLATFORM',
      },
      {
        id: 'uc-1:c',
        type: 'COUPON',
        scope: 'ITEM',
        targetId: 'c',
        amount: 1_500,
        bearer: 'PLATFORM',
      },
    ])
  })

  /**
   * 두 줄이 **다른 가게**라 위의 `SELLER` 갈래가 아니다. 같은 가게였다면 그쪽이
   * 먼저 잡고, 안분은 계산기가 한다.
   */
  it('leaves out an item whose share rounds to nothing', () => {
    const uneven = [
      line({ itemId: 'a', sellerId: 'seller-a', unitPrice: 100_000 }),
      line({ itemId: 'b', sellerId: 'seller-b', unitPrice: 1 }),
      line({ itemId: 'c', sellerId: 'seller-b' }),
    ]
    const scoped = coupon({ scopeType: 'PRODUCT', scopeIds: ['product-a', 'product-b'] })
    const reach = reachOf(scoped, uneven)

    expect(toPricingDiscounts(scoped, 3, reach, uneven).map((entry) => entry.targetId)).toEqual([
      'a',
    ])
  })

  /** 안분의 합은 언제나 쿠폰 할인액이다 (F8) — 잔여를 버리지 않는다. */
  it('never loses a won to rounding', () => {
    const three = [
      line({ itemId: 'a', unitPrice: 3_333 }),
      line({ itemId: 'b', unitPrice: 3_333 }),
      line({ itemId: 'c', unitPrice: 3_334 }),
      line({ itemId: 'd', sellerId: 'seller-b' }),
    ]
    const scoped = coupon({
      scopeType: 'PRODUCT',
      scopeIds: ['product-a', 'product-b', 'product-c'],
    })
    const shares = toPricingDiscounts(scoped, 1_000, reachOf(scoped, three), three)

    expect(shares.reduce((sum, entry) => sum + entry.amount, 0)).toBe(1_000)
  })
})

describe('장별 실제 금액 (F6 · F8)', () => {
  const lines = [
    line({ itemId: 'a', sellerId: 'seller-a' }),
    line({ itemId: 'b', sellerId: 'seller-b' }),
  ]

  it('reports what each coupon actually took off', () => {
    const { applied, discounts } = applyCoupons(
      [coupon(), sellerCoupon('seller-b', { discountValue: 2_000 })],
      lines,
      FREE_SHIPPING,
      NOW,
    )

    expect(applied).toEqual([
      {
        userCouponId: 'uc-1',
        couponId: 'c-1',
        name: '가을 쿠폰',
        issuerType: 'PLATFORM',
        discountAmount: 3_000,
      },
      {
        userCouponId: 'uc-seller-b',
        couponId: 'c-seller-b',
        name: '가을 쿠폰',
        issuerType: 'SELLER',
        discountAmount: 2_000,
      },
    ])

    const priced = calculateOrder({ items: lines, discounts, shippingPolicies: FREE_SHIPPING })

    expect(priced.totalCouponDiscountAmount).toBe(5_000)
  })

  /**
   * **겹쳐 덮이면 뒤엣것이 잘린다.** 그 사실이 드러나는 유일한 자리가 이 값이고,
   * 합계만 보면 「두 장을 썼는데 한 장 값만 빠졌다」로 보인다.
   */
  it('shows the second coupon taking only what is left', () => {
    const one = [line({ itemId: 'a', unitPrice: 4_000 })]
    const { applied } = applyCoupons(
      [coupon({ discountValue: 3_000 }), sellerCoupon('seller-a', { discountValue: 3_000 })],
      one,
      FREE_SHIPPING,
      NOW,
    )

    expect(applied.map((entry) => entry.discountAmount)).toEqual([3_000, 1_000])
  })

  it('applies nothing when nothing was chosen', () => {
    expect(applyCoupons([], lines, FREE_SHIPPING, NOW)).toEqual({ discounts: [], applied: [] })
  })
})

describe('최대 할인 조합 (F7)', () => {
  const lines = [
    line({ itemId: 'a', sellerId: 'seller-a' }),
    line({ itemId: 'b', sellerId: 'seller-b' }),
  ]

  it('recommends nothing when there is nothing to recommend', () => {
    expect(recommendCoupons([], lines, FREE_SHIPPING, NOW)).toEqual({
      userCouponIds: [],
      discountAmount: 0,
      exhaustive: true,
    })
  })

  it('takes the best of each group at once', () => {
    const usable = [
      coupon({ userCouponId: 'small', discountValue: 1_000 }),
      coupon({ userCouponId: 'big', discountValue: 5_000 }),
      sellerCoupon('seller-a', { userCouponId: 'store', discountValue: 2_000 }),
    ]
    const answer = recommendCoupons(usable, lines, FREE_SHIPPING, NOW)

    expect([...answer.userCouponIds].sort()).toEqual(['big', 'store'])
    expect(answer.discountAmount).toBe(7_000)
  })

  /**
   * **할인액이 아니라 낼 돈으로 고른다.** 무료배송 판정이 쿠폰까지 반영한 상품금액
   * 기준이므로(`pricing.md` 1장), 큰 쿠폰이 문턱 아래로 끌어내리면 배송비가
   * 되살아난다 — 쿠폰을 더 쓰고 더 내는 조합을 권하는 것은 우리가 만든 결함이다.
   */
  it('refuses a bigger coupon that would cost the free shipping', () => {
    const policies: readonly ShippingPolicy[] = [
      { sellerId: 'seller-a', fee: 3_000, freeThreshold: 9_000 },
    ]
    const one = [line({ itemId: 'a', unitPrice: 10_000 })]
    const usable = [
      coupon({ userCouponId: 'small', discountValue: 1_000 }),
      coupon({ userCouponId: 'big', discountValue: 2_000 }),
    ]
    const answer = recommendCoupons(usable, one, policies, NOW)

    // 2,000원을 깎으면 상품금액이 8,000원이 되어 배송비 3,000원이 붙는다.
    expect(answer.userCouponIds).toEqual(['small'])
    expect(answer.discountAmount).toBe(1_000)
  })

  /** 같은 금액이면 적게 쓴다 — 남은 한 장은 다음 주문에서 쓸 수 있는 값이다. */
  it('spends fewer coupons when two combinations pay the same', () => {
    // 그리고 그 동점이 플랫폼과 판매자 사이면 플랫폼을 쓴다. 사는 사람이 내는 돈이
    // 같으니 **정산에서 아무도 차감되지 않는 쪽**을 권한다.
    const one = [line({ itemId: 'a', unitPrice: 3_000 })]
    const usable = [
      coupon({ userCouponId: 'platform', discountValue: 3_000 }),
      sellerCoupon('seller-a', { userCouponId: 'store', discountValue: 3_000 }),
    ]
    const answer = recommendCoupons(usable, one, FREE_SHIPPING, NOW)

    expect(answer.userCouponIds).toEqual(['platform'])
  })

  /**
   * 조합이 상한을 넘으면 근사로 답하고 **그 사실을 말한다.** 상한이 없으면 한
   * 사람의 쿠폰함이 서버의 CPU 를 정한다.
   */
  it('falls back to a greedy answer past the combination limit', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      line({ itemId: `i-${String(index)}`, sellerId: `seller-${String(index)}` }),
    )
    const policies = many.map((entry) => ({
      sellerId: entry.sellerId,
      fee: 0,
      freeThreshold: null,
    }))
    const usable = many.map((entry) =>
      sellerCoupon(entry.sellerId, {
        userCouponId: `uc-${entry.sellerId}`,
        discountValue: 1_000,
      }),
    )
    const answer = recommendCoupons(usable, many, policies, NOW)

    expect(2 ** many.length).toBeGreaterThan(RECOMMENDATION_COMBINATION_LIMIT)
    expect(answer.exhaustive).toBe(false)
    expect(answer.discountAmount).toBe(12_000)
  })

  /**
   * 근사가 하는 두 가지를 한 번에 잰다 — **그룹 안에서 더 나은 장을 고르는 것**과
   * **아무것도 줄이지 못하는 그룹을 비우는 것**.
   *
   * 아홉 가게에 각각 두 장이라 3^9 = 19,683 조합이고, 전수 탐색의 상한을 한참 넘는다.
   * 「죽은」 장은 자기 가게가 아닌 곳을 가리켜 아무 줄에도 닿지 않고, 마지막 가게는
   * 그런 장만 갖고 있어 추천에 한 장도 내지 못한다.
   */
  it('picks the better coupon of a group and skips a group that cannot help', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      line({ itemId: `i-${String(index)}`, sellerId: `seller-${String(index)}` }),
    )
    const policies = many.map((entry) => ({
      sellerId: entry.sellerId,
      fee: 0,
      freeThreshold: null,
    }))
    const dead = (sellerId: string, suffix: string): CouponCandidate =>
      sellerCoupon(sellerId, {
        userCouponId: `dead${suffix}-${sellerId}`,
        discountValue: 1_000,
        scopeIds: ['seller-nowhere'],
      })
    const usable = many.flatMap((entry, index) =>
      index === many.length - 1
        ? // 마지막 가게는 죽은 장만 갖고 있다 — 이 그룹은 비워진다.
          [dead(entry.sellerId, '-1'), dead(entry.sellerId, '-2')]
        : // 죽은 장이 **먼저** 온다. 그래야 그룹 안의 비교가 뒤엣것을 고르는 갈래를 밟는다.
          [
            dead(entry.sellerId, ''),
            sellerCoupon(entry.sellerId, {
              userCouponId: `good-${entry.sellerId}`,
              discountValue: 1_000,
            }),
          ],
    )
    const answer = recommendCoupons(usable, many, policies, NOW)

    expect(answer.exhaustive).toBe(false)
    expect(answer.userCouponIds.every((id) => id.startsWith('good-'))).toBe(true)
    expect(answer.userCouponIds).toHaveLength(8)
  })
})
