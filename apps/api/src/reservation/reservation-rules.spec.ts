/**
 * 예약의 순수 판단 (TASK-0048). 입력 → 출력, 분기 100% (6.2 Q5 강화).
 */

import { describe, expect, it } from 'vitest'

import { availableStock, expiryFrom, RESERVATION_TTL_MS, settlement } from './reservation-rules.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

describe('가용재고', () => {
  it('is what is left after the holds', () => {
    expect(availableStock(10, 3)).toBe(7)
  })

  it('is zero when everything is held', () => {
    expect(availableStock(3, 3)).toBe(0)
  })

  it('never goes below zero', () => {
    // 「-2개 남음」은 아무 뜻이 아니다. 제약이 이미 그 상태를 막지만 여기가 만드는
    // 것은 사람이 볼 숫자다.
    expect(availableStock(1, 3)).toBe(0)
  })
})

describe('만료 시각', () => {
  it('is the TTL from now by default', () => {
    expect(expiryFrom(NOW).getTime()).toBe(NOW.getTime() + RESERVATION_TTL_MS)
  })

  it('takes a TTL of its own, so a test need not wait fifteen minutes', () => {
    expect(expiryFrom(NOW, 1_000).getTime()).toBe(NOW.getTime() + 1_000)
  })
})

describe('정산 판단', () => {
  it('applies to a reservation still held, whichever way it is being settled', () => {
    expect(settlement('HELD', 'CONFIRMED')).toBe('apply')
    expect(settlement('HELD', 'RELEASED')).toBe('apply')
  })

  it('does nothing when it is already in the state asked for (F4)', () => {
    // 결제 승인 웹훅은 두 번 온다고 가정한다. 만료 스케줄러와 이탈한 사용자는 같은
    // 예약을 동시에 해제한다.
    expect(settlement('CONFIRMED', 'CONFIRMED')).toBe('noop')
    expect(settlement('RELEASED', 'RELEASED')).toBe('noop')
  })

  it('refuses to settle a reservation the other way', () => {
    // 해제된 것을 확정하면 없는 재고를 파는 것이고, 확정된 것을 해제하면 이미 팔린
    // 재고를 되돌려 놓는 것이다.
    expect(settlement('RELEASED', 'CONFIRMED')).toBe('refuse')
    expect(settlement('CONFIRMED', 'RELEASED')).toBe('refuse')
  })
})
