import type { PaymentStatus } from '@shopping/shared'
import { paymentStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { RefundablePayment } from './payment-rules.js'
import { canTransition, paymentTransitions, refundDecision } from './payment-rules.js'

/**
 * 결제의 순수 판단, 남김없이 (TASK-0052 6.2 — Q5 강화, 분기 100%).
 *
 * 여기서 거절되지 않은 것은 **돈으로 나타난다.** 그래서 「되는 경우」보다
 * 「거절되는 경우」가 많고, 표는 상태 하나씩 훑는다 — 빠뜨린 칸은 빨간
 * 테스트가 아니라 나중에 누가 전화로 알려 주는 종류의 실패다.
 */

/** 3만원이 승인됐고 아직 아무것도 환불되지 않은 결제. */
function payment(overrides: Partial<RefundablePayment> = {}): RefundablePayment {
  return { status: 'PAID', authorizedAmount: 30_000, canceledAmount: 0, ...overrides }
}

/** 환불을 받는 두 상태. 나머지는 전부 거절되어야 한다. */
const REFUNDABLE_STATUSES: readonly PaymentStatus[] = ['PAID', 'PARTIAL_CANCELED']

describe('상태 전이 표', () => {
  it('decides transitions for every declared status', () => {
    // 레코드로 쓴 것이 컴파일에서 이미 강제하는 성질이지만, 여기서 한 번 더 재는
    // 것은 「빈 배열로 채워 넣고 넘어간」 상태를 잡기 위해서다 — 컴파일은
    // 통과하고 그 결제는 어디로도 못 간다.
    for (const status of paymentStatuses) {
      expect(paymentTransitions[status].every((to) => paymentStatuses.includes(to))).toBe(true)
    }

    const movable = paymentStatuses.filter((status) => paymentTransitions[status].length > 0)

    // `UNRESOLVED` 가 여기 있는 것이 D-220 의 핵심이다. 「모른다」에 종착지를
    // 주면 그 결제는 영원히 모르는 채로 남고, 대사가 풀 길이 없다.
    expect(movable).toEqual(['READY', 'AUTHORIZED', 'PAID', 'PARTIAL_CANCELED', 'UNRESOLVED'])
  })

  it('lets a new payment be approved or declined, and nothing else', () => {
    expect(canTransition('READY', 'AUTHORIZED')).toBe(true)
    expect(canTransition('READY', 'FAILED')).toBe(true)
    // 결제사에 닿지 못한 경우다 (D-220). 거절과 **다른 상태**로 가는 이유는
    // 저쪽에서 승인이 나 있을 수 있기 때문이다.
    expect(canTransition('READY', 'UNRESOLVED')).toBe(true)
    // 승인을 건너뛴 매입은 「돈을 안 받고 물건을 보내는」 결제다.
    expect(canTransition('READY', 'PAID')).toBe(false)
    expect(canTransition('READY', 'CANCELED')).toBe(false)
  })

  it('lets an authorization only be captured', () => {
    // 승인만 된 건을 무르는 것은 환불이 아니라 승인 취소이고, 설계 문서 3장이
    // 그 화살표를 그리지 않았다. 여기에 몰래 그려 두면 프로바이더가 거절하는
    // 요청을 우리 쪽 상태만 성공으로 적는다.
    expect(canTransition('AUTHORIZED', 'PAID')).toBe(true)
    expect(canTransition('AUTHORIZED', 'CANCELED')).toBe(false)
    expect(canTransition('AUTHORIZED', 'PARTIAL_CANCELED')).toBe(false)
    expect(canTransition('AUTHORIZED', 'FAILED')).toBe(false)
  })

  it('lets a captured payment be canceled in part or in full', () => {
    expect(canTransition('PAID', 'PARTIAL_CANCELED')).toBe(true)
    expect(canTransition('PAID', 'CANCELED')).toBe(true)
  })

  it('lets a partially canceled payment be partially canceled again', () => {
    // 자기 자신으로 가는 화살표가 없으면 두 번째 부분 환불이 정의 밖 전이가
    // 되고, 그 결제는 잔액을 남긴 채 아무도 손댈 수 없게 된다 (F3).
    expect(canTransition('PARTIAL_CANCELED', 'PARTIAL_CANCELED')).toBe(true)
    expect(canTransition('PARTIAL_CANCELED', 'CANCELED')).toBe(true)
  })

  it('leaves the terminal statuses with nowhere to go', () => {
    for (const to of paymentStatuses) {
      expect(canTransition('CANCELED', to)).toBe(false)
      expect(canTransition('FAILED', to)).toBe(false)
    }
  })

  it('refuses every move backwards', () => {
    // 되돌아가는 화살표는 하나도 없다. 하나라도 있으면 「환불된 결제를 다시
    // 결제됨으로」 되돌리는 경로가 생기고, 그 결제의 이력은 더 이상 읽을 수 없다.
    expect(canTransition('AUTHORIZED', 'READY')).toBe(false)
    expect(canTransition('PAID', 'AUTHORIZED')).toBe(false)
    expect(canTransition('PARTIAL_CANCELED', 'PAID')).toBe(false)
  })
})

describe('환불 판단 — 허용', () => {
  it('allows a partial refund and leaves the payment partially canceled', () => {
    expect(refundDecision(payment(), 10_000)).toEqual({
      outcome: 'allowed',
      nextStatus: 'PARTIAL_CANCELED',
      canceledAmount: 10_000,
      remainingAmount: 20_000,
    })
  })

  it('lands CANCELED when the refund is exactly what remains', () => {
    // 경계다. 1원이라도 남으면 PARTIAL_CANCELED 여야 하고, 정확히 0이 되는
    // 순간에만 결제가 끝난다.
    expect(refundDecision(payment({ canceledAmount: 18_000 }), 12_000)).toEqual({
      outcome: 'allowed',
      nextStatus: 'CANCELED',
      canceledAmount: 30_000,
      remainingAmount: 0,
    })
  })

  it('still leaves a payment partially canceled when one won remains', () => {
    // 위 경계의 반대편. 999원을 환불하고 1원이 남았는데 CANCELED 로 적으면
    // 그 1원은 아무도 다시 찾아가지 못한다.
    const decision = refundDecision(payment({ authorizedAmount: 1_000 }), 999)

    expect(decision).toMatchObject({ nextStatus: 'PARTIAL_CANCELED', remainingAmount: 1 })
  })

  it('allows the whole authorized amount in one go', () => {
    expect(refundDecision(payment(), 30_000)).toMatchObject({
      nextStatus: 'CANCELED',
      remainingAmount: 0,
    })
  })

  it('allows a second refund on an already partially canceled payment', () => {
    // F3. 부분 환불은 여러 번 일어난다.
    expect(
      refundDecision(payment({ status: 'PARTIAL_CANCELED', canceledAmount: 10_000 }), 5_000),
    ).toEqual({
      outcome: 'allowed',
      nextStatus: 'PARTIAL_CANCELED',
      canceledAmount: 15_000,
      remainingAmount: 15_000,
    })
  })

  it('carries a running total that reaches the authorized amount after three refunds', () => {
    // F3 그대로 — 환불 3회, 누계 정확. 누계를 부르는 쪽이 다시 더하게 두지
    // 않는 이유는 4.4 다: 판단한 자리와 쓰는 자리가 같아야 한다.
    let current = payment()

    for (const amount of [10_000, 15_000, 5_000]) {
      const decision = refundDecision(current, amount)

      expect(decision.outcome).toBe('allowed')

      if (decision.outcome !== 'allowed') return

      current = { ...current, status: decision.nextStatus, canceledAmount: decision.canceledAmount }
    }

    expect(current).toEqual({
      status: 'CANCELED',
      authorizedAmount: 30_000,
      canceledAmount: 30_000,
    })
  })
})

describe('환불 판단 — 거절', () => {
  it('refuses one won more than remains', () => {
    // F4. 여기가 통과하면 승인액보다 많은 돈이 나간다. 프로바이더가 막아 주는
    // 날도 있지만 막아 주지 않는 날이 있고, 그날은 우리 장부에서만 음수가 된다.
    expect(refundDecision(payment(), 30_001)).toEqual({
      outcome: 'refused',
      reason: 'exceeds_remaining',
      refundableAmount: 30_000,
    })
  })

  it('refuses one won more than remains on a partially canceled payment', () => {
    expect(
      refundDecision(payment({ status: 'PARTIAL_CANCELED', canceledAmount: 18_000 }), 12_001),
    ).toEqual({
      outcome: 'refused',
      reason: 'exceeds_remaining',
      // 거절이 숫자를 들고 있어야 상담원이 다음 행동을 안다.
      refundableAmount: 12_000,
    })
  })

  it('refuses a refund of nothing', () => {
    expect(refundDecision(payment(), 0)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid_amount',
    })
  })

  it('refuses a negative refund, which would be a charge wearing a refund name', () => {
    expect(refundDecision(payment(), -1)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid_amount',
    })
  })

  it('refuses an amount that is not a whole won', () => {
    // 누계가 소수가 되는 순간 「잔액이 정확히 0」이 영원히 성립하지 않고, 결제는
    // CANCELED 에 닿지 못한 채 PARTIAL_CANCELED 로 남는다.
    expect(refundDecision(payment(), 1_000.5)).toMatchObject({
      outcome: 'refused',
      reason: 'invalid_amount',
    })
  })

  it('refuses a refund in every status that has not taken money', () => {
    // READY·AUTHORIZED 는 아직 우리 쪽으로 온 돈이 없고, CANCELED·FAILED 는
    // 끝난 결제다. `UNRESOLVED` 는 승인됐는지조차 모르는 것이라 환불할 대상이
    // 있는지를 우리가 모른다 — 다섯 다 환불이라는 사건 자체를 받지 않는다.
    const forbidden = paymentStatuses.filter((status) => !REFUNDABLE_STATUSES.includes(status))

    expect(forbidden).toEqual(['READY', 'AUTHORIZED', 'CANCELED', 'FAILED', 'UNRESOLVED'])

    for (const status of forbidden) {
      expect(refundDecision(payment({ status }), 10_000)).toEqual({
        outcome: 'refused',
        reason: 'status_forbidden',
        // 승인 전이거나 이미 끝난 결제에 남은 금액을 알려 주면, 낼 수 없는 돈을
        // 낼 수 있다고 말하는 셈이 된다.
        refundableAmount: 0,
      })
    }
  })

  it('refuses everything in a terminal status, whatever the amount', () => {
    for (const status of ['CANCELED', 'FAILED'] as const) {
      for (const amount of [-1, 0, 1, 30_000, 30_001]) {
        expect(refundDecision(payment({ status, canceledAmount: 30_000 }), amount)).toMatchObject({
          outcome: 'refused',
          reason: 'status_forbidden',
        })
      }
    }
  })
})
