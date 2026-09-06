/**
 * 적립금 원장의 규칙, 입력 → 출력으로만 (TASK-0076 6.2 — Q5 강화).
 *
 * 이 파일이 재는 것 전부가 **틀려도 아무것도 실패하지 않는** 종류다. 부호가 뒤집힌
 * 행은 잘 만들어진 행이고, 반올림 방향이 뒤집힌 적립은 사람이 세어 보기 전까지
 * 아무도 모르며, 통을 비우지 않은 사용은 만료가 돌 때에야 잔액을 음수로 만들려 든다.
 * 그래서 분기 커버리지 100% 이고, 여기 닿지 않는 분기는 아무도 재지 않는 규칙이다.
 */

import { pointTransactionTypes } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { PointLedgerAudit, PointMovementDraft } from './point-ledger.js'
import {
  earnedAmount,
  expiryFrom,
  movementIssues,
  nextBalance,
  planConsumption,
  pointDirections,
  pointDiscount,
  POINT_MOVEMENT_LIMIT,
  reconciliationFaults,
  usageAmountIssue,
} from './point-ledger.js'

function draft(overrides: Partial<PointMovementDraft> = {}): PointMovementDraft {
  return { type: 'EARN', amount: 1_000, refType: null, refId: null, reason: null, ...overrides }
}

function codes(entry: PointMovementDraft): readonly string[] {
  return movementIssues(entry).map((issue) => issue.code)
}

describe('종류가 부호를 정한다', () => {
  it('모든 종류에 방향이 있다', () => {
    // 레코드가 빠짐없다는 것을 컴파일이 보장하지만, 그 보장은 **키에 대한 것**이고
    // 값이 비어 있지 않다는 말은 아니다. 새 종류가 `'either'` 로 조용히 들어오는
    // 것을 여기서 본다 — 양방향은 `ADJUST` 하나뿐이고, 그것이 사유를 요구받는 근거다.
    const twoWay = pointTransactionTypes.filter((type) => pointDirections[type] === 'either')

    expect(twoWay).toEqual(['ADJUST'])
  })

  it('적립·복구는 양수여야 한다', () => {
    expect(codes(draft({ type: 'EARN', amount: -1 }))).toEqual(['wrong_direction'])
    expect(codes(draft({ type: 'RESTORE', amount: -1 }))).toEqual(['wrong_direction'])
    expect(codes(draft({ type: 'RESTORE', amount: 1 }))).toEqual([])
  })

  it('사용·만료는 음수여야 한다', () => {
    expect(codes(draft({ type: 'USE', amount: 1 }))).toEqual(['wrong_direction'])
    expect(codes(draft({ type: 'EXPIRE', amount: 1 }))).toEqual(['wrong_direction'])
    expect(codes(draft({ type: 'USE', amount: -1 }))).toEqual([])
  })

  it('조정은 양쪽 다 되지만 사유를 요구한다', () => {
    expect(codes(draft({ type: 'ADJUST', amount: -5, reason: '고객센터 정정' }))).toEqual([])
    expect(codes(draft({ type: 'ADJUST', amount: 5, reason: '고객센터 정정' }))).toEqual([])
    expect(codes(draft({ type: 'ADJUST', amount: 5 }))).toEqual(['reason_required'])
  })

  it('0원은 종류와 무관하게 사건이 아니다', () => {
    expect(codes(draft({ amount: 0 }))).toEqual(['zero_amount'])
    expect(codes(draft({ type: 'ADJUST', amount: 0, reason: '정정' }))).toEqual(['zero_amount'])
  })

  it('한도를 넘는 자릿수를 거절한다', () => {
    expect(codes(draft({ amount: POINT_MOVEMENT_LIMIT }))).toEqual([])
    expect(codes(draft({ amount: POINT_MOVEMENT_LIMIT + 1 }))).toEqual(['amount_too_large'])
    expect(codes(draft({ type: 'USE', amount: -POINT_MOVEMENT_LIMIT - 1 }))).toEqual([
      'amount_too_large',
    ])
  })
})

describe('참조는 두 칸 다이거나 아무것도 아니다', () => {
  it('반쪽 참조를 거절하고, 어느 칸이 비었는지 이름을 부른다', () => {
    expect(movementIssues(draft({ refType: 'ORDER' }))).toEqual([
      { code: 'unpaired_reference', field: 'refId' },
    ])
    expect(movementIssues(draft({ refId: 'a3f' }))).toEqual([
      { code: 'unpaired_reference', field: 'refType' },
    ])
  })

  it('둘 다 있으면 통과한다', () => {
    expect(codes(draft({ refType: 'SELLER_ORDER', refId: 'a3f' }))).toEqual([])
  })
})

describe('사유', () => {
  it('공백뿐인 사유는 사유가 아니다', () => {
    expect(codes(draft({ type: 'ADJUST', amount: 5, reason: '   ' }))).toEqual(['blank_reason'])
  })

  it('조정이 아닌 사건은 사유가 없어도 된다', () => {
    expect(codes(draft({ reason: null }))).toEqual([])
  })
})

describe('한 번에 여러 가지가 틀릴 수 있다', () => {
  it('전부 한꺼번에 답한다', () => {
    // 폼을 채우는 사람이 네 가지를 듣기 위해 네 번 보낼 이유가 없다.
    expect(codes(draft({ type: 'ADJUST', amount: 0, refType: 'ORDER' }))).toEqual([
      'zero_amount',
      'unpaired_reference',
      'reason_required',
    ])
  })
})

describe('사용 요청의 금액', () => {
  it('원 단위 양수만 받는다', () => {
    expect(usageAmountIssue(1_000)).toBeNull()
    expect(usageAmountIssue(0)?.code).toBe('not_positive')
    expect(usageAmountIssue(-1)?.code).toBe('not_positive')
    expect(usageAmountIssue(1.5)?.code).toBe('not_positive')
  })

  it('한도를 넘으면 거절한다', () => {
    expect(usageAmountIssue(POINT_MOVEMENT_LIMIT)).toBeNull()
    expect(usageAmountIssue(POINT_MOVEMENT_LIMIT + 1)?.code).toBe('amount_too_large')
  })
})

describe('잔액', () => {
  it('더하고, 음수가 되면 답하지 않는다', () => {
    expect(nextBalance(1_000, -400)).toBe(600)
    expect(nextBalance(1_000, -1_000)).toBe(0)
    expect(nextBalance(1_000, -1_001)).toBeNull()
  })
})

describe('지급액', () => {
  it('실결제금액 × 적립률(bp), 내림', () => {
    expect(earnedAmount(10_000, 100)).toBe(100)
    expect(earnedAmount(12_345, 100)).toBe(123)
    expect(earnedAmount(10_000, 10_000)).toBe(10_000)
  })

  it('0원이 나오는 것은 정상이다', () => {
    expect(earnedAmount(99, 100)).toBe(0)
    expect(earnedAmount(10_000, 0)).toBe(0)
    expect(earnedAmount(0, 100)).toBe(0)
    expect(earnedAmount(-1, 100)).toBe(0)
  })

  it('정수만 낸다 — 부동소수가 새어 나오지 않는다', () => {
    // 0.01% 짜리 적립률에 홀수 금액. 실수 연산이면 여기서 소수점이 남는다.
    expect(Number.isInteger(earnedAmount(33_333, 1))).toBe(true)
  })
})

describe('유효기간', () => {
  it('지급 시각으로부터 그만큼 뒤다', () => {
    const issued = new Date('2026-09-06T00:00:00.000Z')

    expect(expiryFrom(issued, 365).toISOString()).toBe('2027-09-06T00:00:00.000Z')
    expect(expiryFrom(issued, 1).toISOString()).toBe('2026-09-07T00:00:00.000Z')
  })
})

describe('어느 통에서 빼는가', () => {
  const lots = [
    { id: 'a', remainingAmount: 300 },
    { id: 'b', remainingAmount: 500 },
    { id: 'c', remainingAmount: 200 },
  ]

  it('먼저 사라질 통부터 비운다', () => {
    const plan = planConsumption(lots, 400)

    expect(plan).toEqual({
      outcome: 'planned',
      draws: [
        { lotId: 'a', amount: 300, remainingAfter: 0 },
        { lotId: 'b', amount: 100, remainingAfter: 400 },
      ],
    })
  })

  it('다 채우면 남은 통은 보지 않는다', () => {
    const plan = planConsumption(lots, 300)

    expect(plan.outcome === 'planned' && plan.draws.map((draw) => draw.lotId)).toEqual(['a'])
  })

  it('딱 맞게 비울 수 있다', () => {
    const plan = planConsumption(lots, 1_000)

    expect(
      plan.outcome === 'planned' && plan.draws.every((draw) => draw.remainingAfter === 0),
    ).toBe(true)
  })

  it('모자라면 거절하고 **지금 쓸 수 있는 금액**을 말한다', () => {
    expect(planConsumption(lots, 1_001)).toEqual({ outcome: 'refused', available: 1_000 })
    expect(planConsumption([], 1)).toEqual({ outcome: 'refused', available: 0 })
  })
})

describe('대사 — 다섯 진술 중 무엇이 깨졌나', () => {
  const healthy: PointLedgerAudit = {
    balance: 1_000,
    entries: 2,
    sum: 1_000,
    lastBalanceAfter: 1_000,
    maxSeq: 2,
    chainBreaks: 0,
    lotRemaining: 1_000,
  }

  it('설명되는 계정은 아무 결함도 없다', () => {
    expect(reconciliationFaults(healthy)).toEqual([])
  })

  it('사건이 하나도 없는 계정은 잔액이 0이어야 한다', () => {
    const empty: PointLedgerAudit = {
      balance: 0,
      entries: 0,
      sum: 0,
      lastBalanceAfter: 0,
      maxSeq: 0,
      chainBreaks: 0,
      lotRemaining: 0,
    }

    expect(reconciliationFaults(empty)).toEqual([])
    expect(reconciliationFaults({ ...empty, balance: 5 })).toEqual([
      'sum_mismatch',
      'endpoint_mismatch',
      'lot_mismatch',
    ])
  })

  it('합계가 어긋난 것과 사슬이 끊긴 것을 가른다', () => {
    expect(reconciliationFaults({ ...healthy, sum: 900 })).toEqual(['sum_mismatch'])
    expect(reconciliationFaults({ ...healthy, chainBreaks: 1 })).toEqual(['chain_break'])
  })

  it('마지막 행이 지금 잔액을 말하지 못하는 것을 잡는다', () => {
    expect(reconciliationFaults({ ...healthy, lastBalanceAfter: 900 })).toEqual([
      'endpoint_mismatch',
    ])
  })

  it('빈칸 난 자리를 잡는다 — 행이 지워졌거나 잠금 없이 쓰였다', () => {
    expect(reconciliationFaults({ ...healthy, maxSeq: 3 })).toEqual(['seq_gap'])
  })

  it('통과 잔액이 갈라진 것을 잡는다 — 적립금에만 있는 다섯째', () => {
    expect(reconciliationFaults({ ...healthy, lotRemaining: 700 })).toEqual(['lot_mismatch'])
  })
})

describe('계산 엔진에 꽂히는 모양', () => {
  it('주문 전체에 붙고 플랫폼이 부담한다', () => {
    // `bearer` 가 틀리면 판매자가 자기가 주지도 않은 할인을 정산에서 물어낸다
    // (`pricing.md` 6장). 계산 결과는 그것과 무관하므로 금액을 재는 검사로는
    // 절대 잡히지 않는다.
    expect(pointDiscount(3_000)).toEqual({
      id: 'point',
      type: 'POINT',
      scope: 'ORDER',
      amount: 3_000,
      bearer: 'PLATFORM',
    })
  })
})
