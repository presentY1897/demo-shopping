/**
 * 예상 부담액과 부담 누계 — 입력에서 출력까지 (TASK-0074 F3 · F5).
 *
 * 화면을 렌더링하지 않는다. QUALITY-GATES Q5 가 순수 로직에 **분기 커버리지 100%** 를
 * 거는 자리이고, 여기서 재는 갈래 중 하나(「경계가 없다」)는 화면에서 확인하려면 폼을
 * 특정한 조합으로 채워야만 닿는다 — 그런 갈래는 늘 검사되지 않은 채 남는다.
 */

import { couponListEntrySchema, couponSchema } from '@shopping/shared'
import type { Coupon, CouponListEntry } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  canToggleIssuing,
  couponLiabilityTotals,
  estimateCouponLiability,
  isSellerCouponScopeType,
  isSuspended,
  SELLER_COUPON_SCOPE_TYPES,
} from '@/lib/coupons/coupon-console'

describe('예상 최대 부담 (F3)', () => {
  it('multiplies the fixed amount by the issue limit', () => {
    // TASK-0074 4장이 적어 둔 그 숫자다 — 100장 × 5,000원 = 500,000원.
    expect(
      estimateCouponLiability({
        discountType: 'FIXED',
        discountValue: 5_000,
        maxDiscountAmount: null,
        issueLimit: 100,
      }),
    ).toEqual({ kind: 'bounded', issueLimit: 100, perVoucher: 5_000, total: 500_000 })
  })

  it('uses the ceiling, not the rate, for a percentage coupon', () => {
    // 10% 라는 수는 부담이 아니다. 한 장이 최대로 깎는 금액이 부담이고, 정률에서
    // 그것은 상한이다.
    expect(
      estimateCouponLiability({
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscountAmount: 3_000,
        issueLimit: 200,
      }),
    ).toEqual({ kind: 'bounded', issueLimit: 200, perVoucher: 3_000, total: 600_000 })
  })

  it('says a percentage coupon with no ceiling has no bounded maximum', () => {
    // **0원이나 「—」 로 접지 않는다.** 상한 없는 정률의 최대 부담은 큰 수가 아니라
    // 없는 수이고, 숫자를 적으면 그것이 곧 「이만큼만 나가겠구나」가 된다.
    expect(
      estimateCouponLiability({
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscountAmount: null,
        issueLimit: 100,
      }),
    ).toEqual({ kind: 'unbounded', reason: 'noDiscountCeiling' })
  })

  it('says an unlimited issue count has no bounded maximum either', () => {
    expect(
      estimateCouponLiability({
        discountType: 'FIXED',
        discountValue: 5_000,
        maxDiscountAmount: null,
        issueLimit: null,
      }),
    ).toEqual({ kind: 'unbounded', reason: 'unlimitedIssue' })
  })

  it('names the missing ceiling first when both are missing', () => {
    // 곱할 첫 번째 수가 없으므로 수량을 봐도 소용이 없다. 판매자가 채워야 하는 칸은
    // 상한 쪽이고, 그것을 채우면 그 다음 문장이 수량을 가리킨다.
    expect(
      estimateCouponLiability({
        discountType: 'PERCENT',
        discountValue: 10,
        maxDiscountAmount: null,
        issueLimit: null,
      }),
    ).toEqual({ kind: 'unbounded', reason: 'noDiscountCeiling' })
  })

  it.each([
    ['아직 방식을 고르지 않았다', { discountType: null, discountValue: 5_000 }],
    ['아직 할인액을 입력하지 않았다', { discountType: 'FIXED' as const, discountValue: null }],
    ['0원짜리 할인은 금액이 아니다', { discountType: 'FIXED' as const, discountValue: 0 }],
    ['정수가 아닌 입력', { discountType: 'FIXED' as const, discountValue: 1_000.5 }],
  ])('stays quiet while the form is incomplete — %s', (_reason, input) => {
    // 빈 폼에 「상한이 없습니다」를 띄우면 그것은 경고가 아니라 소음이다.
    expect(estimateCouponLiability({ ...input, maxDiscountAmount: null, issueLimit: 100 })).toEqual(
      { kind: 'unknown' },
    )
  })

  it('refuses a fractional issue limit rather than rounding it', () => {
    expect(
      estimateCouponLiability({
        discountType: 'FIXED',
        discountValue: 5_000,
        maxDiscountAmount: null,
        issueLimit: 10.5,
      }),
    ).toEqual({ kind: 'unbounded', reason: 'unlimitedIssue' })
  })
})

describe('부담 누계 (F5)', () => {
  it('adds up what the rows on screen have already discounted', () => {
    expect(couponLiabilityTotals([entry(58_000, 12), entry(4_500, 2), entry(0, 0)])).toEqual({
      usedCount: 14,
      discountTotal: 62_500,
    })
  })

  it('is zero for an empty page rather than undefined', () => {
    expect(couponLiabilityTotals([])).toEqual({ usedCount: 0, discountTotal: 0 })
  })
})

describe('범위 (F1)', () => {
  it('offers exactly two scopes, and neither is the platform-wide pair', () => {
    expect([...SELLER_COUPON_SCOPE_TYPES]).toEqual(['SELLER', 'PRODUCT'])
  })

  it.each(['ALL', 'CATEGORY'])('does not recognise %s as a seller scope', (scope) => {
    expect(isSellerCouponScopeType(scope)).toBe(false)
  })

  it.each([...SELLER_COUPON_SCOPE_TYPES])('recognises %s', (scope) => {
    expect(isSellerCouponScopeType(scope)).toBe(true)
  })
})

describe('발행 중단', () => {
  it('reads the suspension off the stored instant, not off a flag', () => {
    expect(isSuspended(coupon(null))).toBe(false)
    expect(isSuspended(coupon('2026-09-05T06:30:00.000Z'))).toBe(true)
  })

  it('offers no button on a coupon whose period is over', () => {
    // `PATCH` 는 `suspendedAt` 하나만 움직이는데, 이미 끝난 쿠폰은 그 칸을 비워도
    // 여전히 끝나 있다 — 눌러도 아무 일이 없는 버튼은 거짓말이다.
    expect(canToggleIssuing('ENDED')).toBe(false)
  })

  it.each(['ACTIVE', 'SUSPENDED', 'SCHEDULED', 'EXHAUSTED'] as const)(
    'offers one on a %s coupon',
    (lifecycle) => {
      expect(canToggleIssuing(lifecycle)).toBe(true)
    },
  )
})

/** 통계만 다른 목록 줄 하나. 계약 스키마를 지나므로 모양이 틀리면 여기서 죽는다. */
function entry(discountTotal: number, usedCount: number): CouponListEntry {
  return couponListEntrySchema.parse({
    coupon: coupon(null),
    lifecycle: 'ACTIVE',
    stats: { discountTotal, usedCount },
  })
}

function coupon(suspendedAt: string | null): Coupon {
  return couponSchema.parse({
    id: '3c0a0000-0000-4000-8000-000000000001',
    issuerType: 'SELLER',
    sellerId: '019596d0-1f1c-7c2e-9a0e-5a0000000001',
    name: '가을 첫 구매 5,000원',
    code: null,
    discountType: 'FIXED',
    discountValue: 5_000,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    scopeType: 'SELLER',
    scopeIds: [],
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-09-30T14:59:59.000Z',
    issueLimit: 100,
    audience: 'ALL',
    suspendedAt,
    issuedCount: 37,
  })
}
