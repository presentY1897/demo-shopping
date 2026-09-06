/**
 * 환불이 되돌리는 할인 (TASK-0078 6.2, Q5 강화). 입력 → 출력, 분기 100%.
 *
 * 재는 것이 셋이다. **부분 환불을 두 번 한 뒤의 합이 전체 환불 한 번과 같은가**(F1 ·
 * F2) · **부분 취소에 쿠폰이 돌아오지 않는가**(F4) · **회수가 잔액을 넘지 않는가**(F6).
 *
 * 셋 다 빨간 검사가 아니라 **사람의 잔액**으로 틀린다. 덜 돌려주면 쓴 적립금이
 * 사라지고, 더 돌려주면 없는 돈이 생기며, 그쪽은 정산일까지 아무 데도 나타나지 않는다.
 */

import { describe, expect, it } from 'vitest'

import {
  clawbackAmount,
  clawbackPlan,
  couponRestoreDecision,
  pointRestoreAmount,
  pointRestoreTotal,
} from './discount-restore.js'
import type { RefundLedgerItem } from './refund-plan.js'

function item(overrides: Partial<RefundLedgerItem> = {}): RefundLedgerItem {
  return {
    orderItemId: 'item-1',
    quantity: 3,
    productAmount: 30_000,
    couponDiscountAmount: 0,
    pointDiscountAmount: 3_000,
    refundedUnits: 0,
    units: 3,
    ...overrides,
  }
}

describe('적립금 복구 (F1 · F2)', () => {
  it('전량 환불이면 붙어 있던 적립금이 전부 돌아온다', () => {
    expect(pointRestoreAmount(item())).toBe(3_000)
  })

  it('한 개만 환불하면 그 몫만 돌아온다', () => {
    expect(pointRestoreAmount(item({ units: 1 }))).toBe(1_000)
  })

  it('적립금을 쓰지 않은 항목은 돌려줄 것이 없다', () => {
    expect(pointRestoreAmount(item({ pointDiscountAmount: 0 }))).toBe(0)
  })

  /**
   * **누계에서 빼는 장치가 이것을 지킨다** (`refundThroughUnits` 와 같은 이유).
   * 「이번 몫」을 따로 반올림하면 나눠 환불한 사람이 1원을 잃거나 얻는다.
   */
  it('나눠 환불해도 합이 한 번에 환불한 것과 같다', () => {
    const line = { quantity: 3, pointDiscountAmount: 1_000 }
    const first = pointRestoreAmount(item({ ...line, refundedUnits: 0, units: 1 }))
    const second = pointRestoreAmount(item({ ...line, refundedUnits: 1, units: 1 }))
    const third = pointRestoreAmount(item({ ...line, refundedUnits: 2, units: 1 }))

    expect(first + second + third).toBe(1_000)
    expect(pointRestoreAmount(item({ ...line, refundedUnits: 0, units: 3 }))).toBe(1_000)
  })

  it('이미 다 돌려준 항목은 더 돌려주지 않는다', () => {
    expect(pointRestoreAmount(item({ refundedUnits: 3, units: 3 }))).toBe(0)
  })

  it('여러 항목의 몫을 더한다', () => {
    const total = pointRestoreTotal([
      item({ orderItemId: 'a', pointDiscountAmount: 1_000 }),
      item({ orderItemId: 'b', pointDiscountAmount: 2_000 }),
    ])

    expect(total).toBe(3_000)
  })

  it('아무 항목도 없으면 0이다', () => {
    expect(pointRestoreTotal([])).toBe(0)
  })
})

describe('쿠폰 복원 (F3 · F4 · F8)', () => {
  it('닿은 몫이 전부 환불되면 되돌린다', () => {
    expect(couponRestoreDecision({ used: true, reach: [{ fullyRefunded: true }] })).toBeNull()
  })

  /** 돌아온 쿠폰으로 최소 주문금액을 우회해 다시 쓸 수 있다. */
  it('부분 취소면 되돌리지 않는다', () => {
    expect(couponRestoreDecision({ used: true, reach: [{ fullyRefunded: false }] })).toBe('partial')
  })

  /**
   * **두 가게에 걸친 플랫폼 쿠폰이 한쪽만 취소돼도 돌아오면 안 된다.** 그때 사는
   * 사람은 쿠폰을 돌려받은 채 남은 가게에서 그 할인을 계속 누린다 (D-225).
   */
  it('한 가게만 전부 환불된 플랫폼 쿠폰은 되돌리지 않는다', () => {
    const decision = couponRestoreDecision({
      used: true,
      reach: [{ fullyRefunded: true }, { fullyRefunded: false }],
    })

    expect(decision).toBe('partial')
  })

  it('닿은 몫이 여럿이어도 전부 환불되면 되돌린다', () => {
    const decision = couponRestoreDecision({
      used: true,
      reach: [{ fullyRefunded: true }, { fullyRefunded: true }],
    })

    expect(decision).toBeNull()
  })

  /** 환불 재시도가 여기서 멈춘다 — 되돌린 것을 또 되돌리지 않는다. */
  it('이미 되돌아온 쿠폰은 건드리지 않는다', () => {
    expect(couponRestoreDecision({ used: false, reach: [{ fullyRefunded: true }] })).toBe(
      'already_restored',
    )
  })

  /** 닿은 몫이 하나도 없으면 되돌릴 수 없는 이유가 없다 — 빈 집합은 전부 참이다. */
  it('닿은 몫이 없으면 되돌린다', () => {
    expect(couponRestoreDecision({ used: true, reach: [] })).toBeNull()
  })
})

describe('회수할 금액 (F5)', () => {
  const rate = 100 // 1%

  it('전량 반품이면 지급된 만큼 되가져온다', () => {
    const amount = clawbackAmount({
      paidAmount: 100_000,
      refundedBefore: 0,
      refundedNow: 100_000,
      earnRateBp: rate,
    })

    expect(amount).toBe(1_000)
  })

  it('절반을 반품하면 절반을 되가져온다', () => {
    const amount = clawbackAmount({
      paidAmount: 100_000,
      refundedBefore: 0,
      refundedNow: 50_000,
      earnRateBp: rate,
    })

    expect(amount).toBe(500)
  })

  /**
   * **누계에서 빼는 장치가 이것을 지킨다.** 「이번 환불액 × 적립률」로 계산하면
   * 세 번 나눠 반품한 사람의 회수 합이 한 번에 반품한 사람과 달라진다.
   */
  it('나눠 반품해도 회수 합이 한 번에 반품한 것과 같다', () => {
    const base = { paidAmount: 100_000, earnRateBp: rate }
    const steps = [
      clawbackAmount({ ...base, refundedBefore: 0, refundedNow: 33_333 }),
      clawbackAmount({ ...base, refundedBefore: 33_333, refundedNow: 33_333 }),
      clawbackAmount({ ...base, refundedBefore: 66_666, refundedNow: 33_334 }),
    ]

    expect(steps.reduce((sum, step) => sum + step, 0)).toBe(1_000)
  })

  it('환불이 결제금액을 넘어도 지급된 것보다 많이 가져가지 않는다', () => {
    const amount = clawbackAmount({
      paidAmount: 100_000,
      refundedBefore: 0,
      refundedNow: 200_000,
      earnRateBp: rate,
    })

    expect(amount).toBe(1_000)
  })

  it('적립률이 0이면 회수할 것도 없다', () => {
    const amount = clawbackAmount({
      paidAmount: 100_000,
      refundedBefore: 0,
      refundedNow: 100_000,
      earnRateBp: 0,
    })

    expect(amount).toBe(0)
  })
})

describe('구매확정 후 회수 (F5 · F6)', () => {
  it('잔액이 넉넉하면 지급한 만큼 회수한다', () => {
    expect(clawbackPlan({ earned: 3_000, balance: 10_000 })).toEqual({ taken: 3_000, shortfall: 0 })
  })

  /**
   * **음수 잔액을 만들지 않는다.** -3,000 으로 두면 그 사람은 다음에 적립받는
   * 3,000원을 잃는데, 그 사실을 아무 화면도 설명하지 못한다.
   */
  it('잔액이 모자라면 있는 만큼만 가져가고 나머지를 남긴다', () => {
    expect(clawbackPlan({ earned: 3_000, balance: 1_000 })).toEqual({
      taken: 1_000,
      shortfall: 2_000,
    })
  })

  it('잔액이 없으면 하나도 가져가지 못한다', () => {
    expect(clawbackPlan({ earned: 3_000, balance: 0 })).toEqual({ taken: 0, shortfall: 3_000 })
  })

  it('지급된 적이 없으면 회수할 것도 없다', () => {
    expect(clawbackPlan({ earned: 0, balance: 10_000 })).toEqual({ taken: 0, shortfall: 0 })
  })

  /** 음수는 입력으로 오지 않지만, 왔을 때 **돈을 만들어 내지 않는다.** */
  it('음수 입력에서도 돈을 만들지 않는다', () => {
    expect(clawbackPlan({ earned: -1_000, balance: 10_000 })).toEqual({ taken: 0, shortfall: 0 })
    expect(clawbackPlan({ earned: 1_000, balance: -5_000 })).toEqual({
      taken: 0,
      shortfall: 1_000,
    })
  })
})
