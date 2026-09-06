/**
 * 발행자 콘솔의 상태 판정 (TASK-0073 6.2). 입력 → 출력, 분기 100%.
 *
 * **가리는 순서가 이 표의 전부다.** 다섯 갈래가 각각 사람에게 다른 일을 시킨다 —
 * 기다리기 · 다시 열기 · 새로 내기 · 아무것도 못 하기 — 그리고 겹칠 때 어느 것을
 * 말하느냐가 그 사람이 다음에 하는 일을 정한다.
 */

import { describe, expect, it } from 'vitest'

import type { CouponLifecycleInput } from './coupon-console.js'
import { couponLifecycleOf } from './coupon-console.js'

const NOW = new Date('2026-09-06T00:00:00.000Z')

function coupon(overrides: Partial<CouponLifecycleInput> = {}): CouponLifecycleInput {
  return {
    validFrom: new Date('2026-09-01T00:00:00.000Z'),
    validUntil: new Date('2026-09-30T00:00:00.000Z'),
    suspendedAt: null,
    issueLimit: null,
    issuedCount: 0,
    ...overrides,
  }
}

describe('쿠폰의 지금 상태', () => {
  it('기간 안이고 멈추지 않았으면 발급 중이다', () => {
    expect(couponLifecycleOf(coupon(), NOW)).toBe('ACTIVE')
  })

  it('아직 시작 전이면 기다리면 되는 상태다', () => {
    const early = coupon({ validFrom: new Date(NOW.getTime() + 1) })

    expect(couponLifecycleOf(early, NOW)).toBe('SCHEDULED')
  })

  it('발행자가 멈췄으면 중단이다', () => {
    expect(couponLifecycleOf(coupon({ suspendedAt: NOW }), NOW)).toBe('SUSPENDED')
  })

  it('수량이 다 나갔으면 소진이다', () => {
    expect(couponLifecycleOf(coupon({ issueLimit: 10, issuedCount: 10 }), NOW)).toBe('EXHAUSTED')
  })

  it('수량이 남아 있으면 소진이 아니다', () => {
    expect(couponLifecycleOf(coupon({ issueLimit: 10, issuedCount: 9 }), NOW)).toBe('ACTIVE')
  })

  it('무제한 쿠폰은 아무리 나가도 소진되지 않는다', () => {
    expect(couponLifecycleOf(coupon({ issueLimit: null, issuedCount: 9_999 }), NOW)).toBe('ACTIVE')
  })

  /**
   * **끝은 열린 구간이다.** 발급 판정(`issuabilityFault`)과 같은 순간을 가리켜야
   * 하고, 어긋나면 목록이 「진행 중」이라고 적은 쿠폰을 발급 요청이 「기간이 지났다」로
   * 거절한다.
   */
  it('종료 시각 그 순간부터 끝난 것이다', () => {
    expect(couponLifecycleOf(coupon({ validUntil: NOW }), NOW)).toBe('ENDED')
  })

  describe('겹칠 때 무엇을 말하는가', () => {
    /** 끝난 쿠폰을 「중단」이라고 부르면 발행자는 다시 열면 되는 줄 안다. */
    it('끝난 쿠폰은 중단됐어도 끝난 것이다', () => {
      const both = coupon({ validUntil: NOW, suspendedAt: NOW })

      expect(couponLifecycleOf(both, NOW)).toBe('ENDED')
    })

    it('끝난 쿠폰은 소진됐어도 끝난 것이다', () => {
      const both = coupon({ validUntil: NOW, issueLimit: 1, issuedCount: 1 })

      expect(couponLifecycleOf(both, NOW)).toBe('ENDED')
    })

    /** 멈춰 둔 쿠폰에 「아직 시작 전」이라고 말하면 기다리면 되는 줄 안다. */
    it('시작 전이라도 멈춰 뒀으면 중단이다', () => {
      const both = coupon({ validFrom: new Date(NOW.getTime() + 1), suspendedAt: NOW })

      expect(couponLifecycleOf(both, NOW)).toBe('SUSPENDED')
    })

    /** 소진과 중단이 겹치면 **사람이 되돌릴 수 있는 쪽**을 말한다. */
    it('멈춰 뒀고 소진됐으면 중단이다', () => {
      const both = coupon({ suspendedAt: NOW, issueLimit: 1, issuedCount: 1 })

      expect(couponLifecycleOf(both, NOW)).toBe('SUSPENDED')
    })

    it('시작 전이고 소진됐으면 시작 전이다', () => {
      const both = coupon({
        validFrom: new Date(NOW.getTime() + 1),
        issueLimit: 1,
        issuedCount: 1,
      })

      expect(couponLifecycleOf(both, NOW)).toBe('SCHEDULED')
    })
  })
})
