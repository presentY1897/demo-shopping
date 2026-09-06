import { describe, expect, it } from 'vitest'

import type { CouponPolicyInput } from './coupon-rules.js'
import {
  canonicalScopeIds,
  couponPolicyFaultFields,
  couponPolicyFaults,
  issuabilityFault,
  issueExhausted,
  policyFault,
  sellerScopeFault,
} from './coupon-rules.js'

/**
 * 쿠폰의 순수 판단 (TASK-0072 6.2, Q5 강화).
 *
 * 재는 것은 「함수가 도는가」가 아니라 **「거절해야 할 것을 거절하는가」**다. 이
 * 파일의 절반이 거절을 기대하는 단언인 것은 그래서이고, 아래 갈래 중 하나라도
 * 닿지 않으면 그것은 **아무도 거절하지 않는 조합**이라는 뜻이다.
 */

const SELLER = '0192f0c1-0000-7000-8000-00000000c001'
const OTHER_SELLER = '0192f0c1-0000-7000-8000-00000000c002'

/** 통과하는 플랫폼 쿠폰 하나. 스펙마다 한 칸씩만 어긋뜨린다. */
function platformCoupon(overrides: Partial<CouponPolicyInput> = {}): CouponPolicyInput {
  return {
    sellerId: null,
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: 5_000,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: new Date('2026-09-01T00:00:00.000Z'),
    validUntil: new Date('2026-09-30T00:00:00.000Z'),
    ...overrides,
  }
}

/** 통과하는 판매자 쿠폰 하나 — 자기 가게 범위. */
function sellerCoupon(overrides: Partial<CouponPolicyInput> = {}): CouponPolicyInput {
  return platformCoupon({
    sellerId: SELLER,
    scopeType: 'SELLER',
    scopeIds: [SELLER],
    ...overrides,
  })
}

describe('판매자 범위 강제 (F2)', () => {
  it('플랫폼 쿠폰에는 범위 제한이 없다', () => {
    // 부담이 플랫폼이므로 전체든 카테고리든 자기 돈이다. 제한이 판매자에게만
    // 붙는 이유가 그것이고, 그 비대칭이 이 함수의 첫 줄이다.
    for (const scopeType of ['ALL', 'CATEGORY', 'PRODUCT', 'SELLER'] as const) {
      expect(sellerScopeFault({ sellerId: null, scopeType, scopeIds: ['x'] })).toBeNull()
    }
  })

  it('판매자가 전체 범위를 고르면 거절한다', () => {
    expect(sellerScopeFault({ sellerId: SELLER, scopeType: 'ALL', scopeIds: [] })).toBe(
      'seller_scope_too_wide',
    )
  })

  it('카테고리 범위도 같은 이유로 거절한다', () => {
    // 카테고리는 플랫폼 공용이다. 「셔츠 10%」는 이름만 좁을 뿐 남의 셔츠까지
    // 덮으므로, 전체 범위와 결과가 같다.
    expect(sellerScopeFault({ sellerId: SELLER, scopeType: 'CATEGORY', scopeIds: ['3'] })).toBe(
      'seller_scope_too_wide',
    )
  })

  it('자기 가게를 범위로 고르면 통과한다', () => {
    expect(
      sellerScopeFault({ sellerId: SELLER, scopeType: 'SELLER', scopeIds: [SELLER] }),
    ).toBeNull()
  })

  it('남의 가게를 범위로 고르면 거절한다', () => {
    expect(
      sellerScopeFault({ sellerId: SELLER, scopeType: 'SELLER', scopeIds: [OTHER_SELLER] }),
    ).toBe('seller_scope_foreign')
  })

  it('자기 가게가 섞여 있어도 남의 가게가 하나 있으면 거절한다', () => {
    expect(
      sellerScopeFault({
        sellerId: SELLER,
        scopeType: 'SELLER',
        scopeIds: [SELLER, OTHER_SELLER],
      }),
    ).toBe('seller_scope_foreign')
  })

  it('상품 범위는 통과시킨다 — 소유는 여기서 잴 수 없다', () => {
    // 이 함수는 한 행만 본다. 「이 상품이 저 가게 것인가」는 조인이 필요하고,
    // 그래서 DB 의 CHECK 도 그 절반을 재지 못한다. 서비스가 확인한다.
    expect(
      sellerScopeFault({ sellerId: SELLER, scopeType: 'PRODUCT', scopeIds: ['product-1'] }),
    ).toBeNull()
  })
})

describe('발행 규칙 (F1 · F2)', () => {
  it('제대로 된 요청은 아무 말도 하지 않는다', () => {
    // 통제군. 아래 단언들이 「무엇이든 거절하는 구현」에서도 통과하면 뜻이 없다.
    expect(policyFault(platformCoupon())).toBeNull()
    expect(policyFault(sellerCoupon())).toBeNull()
  })

  it('전체 범위에 대상을 지정하면 거절한다', () => {
    expect(policyFault(platformCoupon({ scopeIds: ['3'] }))).toBe('scope_targets_forbidden')
  })

  it('전체가 아닌데 대상이 없으면 거절한다', () => {
    // 아무것에도 붙지 않는 쿠폰이다. 받은 사람은 왜 적용이 안 되는지 알 수 없다.
    expect(policyFault(platformCoupon({ scopeType: 'CATEGORY', scopeIds: [] }))).toBe(
      'scope_targets_required',
    )
  })

  it('범위의 구조를 판매자 범위보다 먼저 본다', () => {
    // 순서가 뒤집히면 「대상이 비었다」와 「남의 가게다」가 같은 요청에서 갈린다.
    expect(policyFault(sellerCoupon({ scopeType: 'PRODUCT', scopeIds: [] }))).toBe(
      'scope_targets_required',
    )
  })

  it('판매자 범위를 금액보다 먼저 본다', () => {
    // 「할인율을 고치세요」를 받은 판매자는 그것을 고쳐 다시 시도하고, 또
    // 거절당한다. 사람이 할 일이 다르므로 먼저 나가야 하는 거절이 있다.
    expect(policyFault(sellerCoupon({ scopeType: 'ALL', scopeIds: [], discountValue: 200 }))).toBe(
      'seller_scope_too_wide',
    )
  })

  it('정률이 1~100 밖이면 거절한다', () => {
    // 100 은 전액이고 그것을 넘는 수는 존재하지 않는다 — 넘으면 계산기가 그
    // 주문에서 돈을 돌려준다.
    expect(policyFault(platformCoupon({ discountValue: 0 }))).toBe('percent_out_of_range')
    expect(policyFault(platformCoupon({ discountValue: 101 }))).toBe('percent_out_of_range')
    expect(policyFault(platformCoupon({ discountValue: 1 }))).toBeNull()
    expect(policyFault(platformCoupon({ discountValue: 100 }))).toBeNull()
  })

  it('정액에 상한을 걸면 거절한다', () => {
    expect(policyFault(platformCoupon({ discountType: 'FIXED', discountValue: 3_000 }))).toBe(
      'max_discount_meaningless',
    )
  })

  it('상한이 없는 정액은 통과한다', () => {
    expect(
      policyFault(
        platformCoupon({ discountType: 'FIXED', discountValue: 3_000, maxDiscountAmount: null }),
      ),
    ).toBeNull()
  })

  it('기간이 뒤집혀 있으면 거절한다', () => {
    const at = new Date('2026-09-10T00:00:00.000Z')

    expect(policyFault(platformCoupon({ validFrom: at, validUntil: at }))).toBe('period_inverted')
    expect(
      policyFault(
        platformCoupon({ validFrom: at, validUntil: new Date('2026-09-09T00:00:00.000Z') }),
      ),
    ).toBe('period_inverted')
  })
})

describe('범위 대상의 표준형', () => {
  it('uuid 범위는 소문자로 내린다', () => {
    // 텍스트 배열이라 대소문자만 다른 두 문자열이 **같은 대상을 가리키면서 다른
    // 값**이 된다. 그때 `Coupon_seller_scope_check` 는 거절하고 서버는 통과시키며,
    // 어느 쪽도 「대소문자」라고 말해 주지 않는다.
    expect(canonicalScopeIds('SELLER', [SELLER.toUpperCase()])).toEqual([SELLER])
    expect(canonicalScopeIds('PRODUCT', [OTHER_SELLER.toUpperCase()])).toEqual([OTHER_SELLER])
  })

  it('카테고리 범위는 손대지 않는다 — 정수라 대소문자가 없다', () => {
    expect(canonicalScopeIds('CATEGORY', ['12', '7'])).toEqual(['12', '7'])
  })

  it('중복을 뺀다', () => {
    // `['s1','s1']` 은 `ARRAY['s1']` 과 다른 배열이라 CHECK 에서 거절되는데,
    // 발행자는 대상을 두 번 골랐을 뿐이다.
    expect(canonicalScopeIds('SELLER', [SELLER, SELLER])).toEqual([SELLER])
    expect(canonicalScopeIds('SELLER', [SELLER, SELLER.toUpperCase()])).toEqual([SELLER])
    expect(canonicalScopeIds('ALL', [])).toEqual([])
  })
})

describe('거절이 가리키는 입력', () => {
  it('모든 이유가 칸 하나를 가리킨다', () => {
    // 가리키는 칸이 없는 거절은 화면 위쪽의 배너가 된다. 이유가 하나 늘 때
    // 표를 함께 늘리게 하는 것이 이 단언의 일이다.
    for (const fault of couponPolicyFaults) {
      expect(couponPolicyFaultFields[fault], fault).toBeTruthy()
    }
  })
})

describe('발급 가능 판정 (F8)', () => {
  const period = {
    validFrom: new Date('2026-09-10T00:00:00.000Z'),
    validUntil: new Date('2026-09-20T00:00:00.000Z'),
  }

  it('시작 전에는 not_started 다', () => {
    expect(issuabilityFault(period, new Date('2026-09-09T23:59:59.999Z'))).toBe('not_started')
  })

  it('시작 시각 정각부터 받을 수 있다', () => {
    expect(issuabilityFault(period, period.validFrom)).toBeNull()
  })

  it('끝나기 직전까지 받을 수 있다', () => {
    expect(issuabilityFault(period, new Date('2026-09-19T23:59:59.999Z'))).toBeNull()
  })

  it('끝 시각 정각부터 ended 다 — 만료 배치와 같은 순간이다', () => {
    // 배치의 조건은 `"expiresAt" <= now` 이고 `expiresAt` 은 `validUntil` 의
    // 사본이다. 여기가 `>` 였다면 그 한 순간에 발급된 쿠폰이 **받자마자 만료된
    // 채로** 쿠폰함에 앉는다.
    expect(issuabilityFault(period, period.validUntil)).toBe('ended')
    expect(issuabilityFault(period, new Date('2026-09-21T00:00:00.000Z'))).toBe('ended')
  })
})

describe('소진 설명 (F5)', () => {
  it('무제한 쿠폰은 소진되지 않는다', () => {
    expect(issueExhausted(null, 1_000_000)).toBe(false)
  })

  it('남아 있으면 소진이 아니다', () => {
    expect(issueExhausted(10, 9)).toBe(false)
  })

  it('꼭 맞게 나갔으면 소진이다', () => {
    expect(issueExhausted(10, 10)).toBe(true)
  })

  it('넘어 있어도 소진이다 — 그 행은 DB 가 만들지 않지만 읽는 쪽이 답을 가져야 한다', () => {
    expect(issueExhausted(10, 11)).toBe(true)
  })
})
