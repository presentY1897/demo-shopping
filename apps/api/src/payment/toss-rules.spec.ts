import type { PaymentStatus } from '@shopping/shared'
import { paymentProviders, paymentStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { ConfirmCandidate, TossStatus } from './toss-rules.js'
import { confirmDecision, paymentStatusFromToss, tossStatuses } from './toss-rules.js'

/**
 * 토스 연동의 순수 판단, 남김없이 (TASK-0055 6.2 — Q5 강화, 금액 대조·승인 경로
 * 분기 100%).
 *
 * 두 함수가 재는 것은 「토스가 잘 도는가」가 아니라 **「우리가 토스를 잘못 믿지
 * 않는가」**다(4.2). 그래서 둘 다 틀려도 빨간 테스트로 나타나지 않는다 — 금액
 * 대조가 어긋나면 조작된 금액으로 결제가 끝나고, 상태 매핑이 한 칸 비면 대사가
 * 「저쪽이 아는 상태」를 영영 읽지 못한다. 여기서 안 잰 갈래는 나중에 돈으로 센다.
 */

/** 3만원짜리, 결제창에서 막 돌아온 토스 결제. 아직 승인 전이다. */
function candidate(overrides: Partial<ConfirmCandidate> = {}): ConfirmCandidate {
  return { provider: 'TOSS', status: 'READY', authorizedAmount: 30_000, ...overrides }
}

/**
 * 옮겨 적은 표.
 *
 * 구현의 `Record` 를 베낀 것처럼 보이지만 **따로 적은 것이 요점**이다 — 구현에서
 * 값을 읽어 오면 무엇으로 옮기든 통과하는 검사가 된다.
 *
 * 토스가 상태를 하나 더하는 날 이 리터럴이 `Record<TossStatus, …>` 를 채우지
 * 못해 컴파일이 멈추고, 아래 `it.each` 는 그 상태를 새 케이스로 돌린다. 이 검사의
 * 값이 정확히 그 두 가지다.
 */
const EXPECTED: Readonly<Record<TossStatus, PaymentStatus>> = {
  READY: 'READY',
  IN_PROGRESS: 'READY',
  WAITING_FOR_DEPOSIT: 'READY',
  DONE: 'PAID',
  CANCELED: 'CANCELED',
  PARTIAL_CANCELED: 'PARTIAL_CANCELED',
  ABORTED: 'FAILED',
  EXPIRED: 'FAILED',
}

describe('토스 상태를 우리 상태로 옮긴다', () => {
  it.each(tossStatuses)('maps %s onto the status our ledger keeps', (status) => {
    expect(paymentStatusFromToss(status)).toBe(EXPECTED[status])
  })

  it('answers for every status Toss declares, and for nothing else', () => {
    // `it.each` 가 도는 목록과 위 표가 같은 집합인지 본다. 한쪽만 늘어나면
    // 「케이스는 늘었는데 아무도 안 도는」 칸이나 그 반대가 조용히 생긴다.
    expect(Object.keys(EXPECTED)).toEqual([...tossStatuses])
  })

  it('declares each status once', () => {
    // 중복이 있으면 `it.each` 의 케이스 수가 실제로 덮는 상태 수보다 많아진다.
    expect(new Set(tossStatuses).size).toBe(tossStatuses.length)
  })

  it('never invents a status our own machine does not have', () => {
    // 우리 상태 목록에 없는 값이 나오면 그 결제는 어떤 전이 표에도 걸리지 않고,
    // 그때부터 아무도 손댈 수 없다.
    for (const status of tossStatuses) {
      expect(paymentStatuses).toContain(paymentStatusFromToss(status))
    }
  })

  it('never lands on AUTHORIZED, because Toss has no such moment', () => {
    // 토스의 `DONE` 은 승인과 매입이 함께 끝났다는 뜻이다. 그것을 `AUTHORIZED` 로
    // 적으면 이미 매입된 결제를 「매입 대기」로 들고 있게 되고, 정산이 그 차이를
    // 본다.
    expect(tossStatuses.map((status) => paymentStatusFromToss(status))).not.toContain('AUTHORIZED')
  })

  it('leaves the three waiting statuses indistinguishable from a fresh payment', () => {
    // 결제창을 안 닫았든 입금을 기다리든 우리 쪽에서 한 일은 없다. 셋을 갈라
    // 적으면 「아직 아무 돈도 안 움직였다」가 세 가지 뜻을 갖는다.
    for (const status of ['READY', 'IN_PROGRESS', 'WAITING_FOR_DEPOSIT'] as const) {
      expect(paymentStatusFromToss(status)).toBe('READY')
    }
  })

  it('keeps the two dead ends apart from a cancellation', () => {
    // 창을 닫은 것과 시간이 지난 것은 둘 다 승인이 끝내 안 된 것이라 `FAILED` 이고,
    // 취소는 승인된 뒤 무른 것이라 다른 상태다. 이 둘을 섞으면 환불 대상이 아닌
    // 결제가 환불 목록에 올라온다.
    expect(paymentStatusFromToss('ABORTED')).toBe('FAILED')
    expect(paymentStatusFromToss('EXPIRED')).toBe('FAILED')
    expect(paymentStatusFromToss('CANCELED')).toBe('CANCELED')
    expect(paymentStatusFromToss('PARTIAL_CANCELED')).toBe('PARTIAL_CANCELED')
  })
})

describe('승인 판단 — 통과', () => {
  it('confirms when the redirect agrees with the ledger', () => {
    expect(confirmDecision(candidate(), 30_000)).toEqual({ outcome: 'confirm' })
  })
})

describe('승인 판단 — 거절', () => {
  it('refuses a payment that belongs to another provider', () => {
    // 토스 승인 라우트에 가상 카드 결제 id 를 넣어 부르는 경우다. 여기서 안 막으면
    // **남의 결제 흐름**에 토스 승인이 날아간다.
    const others = paymentProviders.filter((provider) => provider !== 'TOSS')

    expect(others).toEqual(['VIRTUAL_CARD'])

    for (const provider of others) {
      expect(confirmDecision(candidate({ provider }), 30_000)).toEqual({
        outcome: 'refused',
        reason: 'provider_mismatch',
      })
    }
  })

  it('names the payment still being looked up, instead of calling it finished', () => {
    // 「승인됐는지 모른다」에 결제창의 답을 덧씌우지 않는다 (D-220) — 그 결제를 푸는
    // 것은 대사이지 다시 열린 리다이렉트가 아니다. 그리고 거절의 **이름이 달라야**
    // 화면이 「확인 중」과 「이미 끝났다」를 다르게 말할 수 있다.
    expect(confirmDecision(candidate({ status: 'UNRESOLVED' }), 30_000)).toEqual({
      outcome: 'refused',
      reason: 'awaiting_result',
    })
  })

  it('refuses every status that is not READY', () => {
    // 뒤로 가기·새로고침으로 같은 리다이렉트가 두 번 열리는 것이 정확히 이 경우다.
    // 막지 않으면 토스에 같은 승인을 두 번 보낸다.
    const forbidden = paymentStatuses.filter(
      // `UNRESOLVED` 는 다른 이유로 거절된다 (아래 검사). 「모른다」와 「이미
      // 처리됐다」를 같은 답으로 접으면, 승인이 끊긴 사람이 새로고침했을 때
      // 끝나지도 않은 결제를 끝났다고 듣는다.
      (status) => status !== 'READY' && status !== 'UNRESOLVED',
    )

    expect(forbidden).toEqual(['AUTHORIZED', 'PAID', 'PARTIAL_CANCELED', 'CANCELED', 'FAILED'])

    for (const status of forbidden) {
      expect(confirmDecision(candidate({ status }), 30_000)).toEqual({
        outcome: 'refused',
        reason: 'status_forbidden',
      })
    }
  })

  it('refuses one won less than the order decided', () => {
    // F2. 이 방향이 공격이다 — 결제창 리다이렉트의 쿼리스트링은 사용자가 고칠 수
    // 있는 값이고, 그것을 그대로 믿으면 3만원짜리를 1원에 판다.
    expect(confirmDecision(candidate(), 29_999)).toEqual({
      outcome: 'refused',
      reason: 'amount_mismatch',
    })
  })

  it('refuses one won more than the order decided', () => {
    // 반대 방향도 거절이다. 더 받는 것도 우리가 정하지 않은 금액이고, 그 결제는
    // 주문서와 맞지 않아 환불 안분이 성립하지 않는다.
    expect(confirmDecision(candidate(), 30_001)).toEqual({
      outcome: 'refused',
      reason: 'amount_mismatch',
    })
  })

  it('refuses a redirect that claims nothing was paid', () => {
    expect(confirmDecision(candidate(), 0)).toMatchObject({ reason: 'amount_mismatch' })
  })

  it('compares against the ledger, not against itself', () => {
    // 승인액이 얼마든 「돌아온 값과 같으면 통과」여야 한다. 두 값 중 하나를
    // 고정해 두면 그 검사는 다른 금액의 주문에서 아무것도 막지 못한다.
    for (const amount of [1, 999, 1_000_000]) {
      expect(confirmDecision(candidate({ authorizedAmount: amount }), amount)).toEqual({
        outcome: 'confirm',
      })
      expect(confirmDecision(candidate({ authorizedAmount: amount }), amount + 1)).toMatchObject({
        reason: 'amount_mismatch',
      })
    }
  })
})

/**
 * 거절 이유의 **순서**.
 *
 * 셋이 동시에 어긋난 입력에 어떤 답이 오는지가 이 절의 전부다. 순서가 뒤집히면
 * 「금액이 틀렸다」를 **남의 결제에 대해** 돌려주게 된다 — 그 답은 부르는 쪽에서
 * 사용자에게 보여 줄 문장이 되고, 그 문장은 자기 결제가 아닌 것에 대해 금액을
 * 알려 주는 셈이다.
 */
describe('거절 이유는 앞의 것부터 나온다', () => {
  it('names the provider first when all three disagree', () => {
    expect(
      confirmDecision(candidate({ provider: 'VIRTUAL_CARD', status: 'PAID' }), 1),
    ).toMatchObject({ reason: 'provider_mismatch' })
  })

  it('names the status before the amount', () => {
    // 이미 승인된 결제에 대고 금액을 따지면, 두 번 열린 리다이렉트가 「금액이
    // 조작됐다」로 기록된다. 실제로 일어난 일은 새로고침이다.
    expect(confirmDecision(candidate({ status: 'PAID' }), 1)).toMatchObject({
      reason: 'status_forbidden',
    })
  })

  it('reaches the amount only when the provider and the status are both fine', () => {
    expect(confirmDecision(candidate(), 1)).toMatchObject({ reason: 'amount_mismatch' })
  })
})
