/**
 * 정산서의 상태 전이 (TASK-0081). 입력 → 출력, 분기 100%.
 *
 * **없는 화살표가 불가능한가**를 재는 검사다. 있는 화살표가 되는 것은 서비스 스펙이
 * 이미 재고, 여기서 값이 나오는 곳은 반대쪽이다 — 지급완료된 정산서를 다시 승인하는
 * 길이 열려 있으면 그것은 돈이 두 번 나가는 길이다.
 */

import { describe, expect, it } from 'vitest'

import type { SettlementStatus } from '@prisma/client'

import {
  canTransition,
  isAmendable,
  settlementTransitions,
  sourcesOf,
} from './settlement-transitions.js'

const statuses: readonly SettlementStatus[] = ['PENDING', 'HOLD', 'APPROVED', 'PAID']

describe('설계 문서의 화살표 (D2)', () => {
  it.each([
    ['PENDING', 'APPROVED'],
    ['PENDING', 'HOLD'],
    ['HOLD', 'APPROVED'],
    ['APPROVED', 'PAID'],
  ] as const)('%s → %s 가 열려 있다', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  /**
   * **되돌아가는 화살표가 하나도 없다.** 승인은 「금액이 굳었다」이고 지급완료는
   * 「돈이 나갔다」인데, 되돌릴 수 있으면 그 선언에 뜻이 없어진다.
   */
  it('되돌아가는 화살표가 없다', () => {
    const order = new Map(statuses.map((status, index) => [status, index]))

    for (const [from, targets] of Object.entries(settlementTransitions)) {
      for (const to of targets) {
        expect(order.get(to)).toBeGreaterThan(order.get(from as SettlementStatus) ?? -1)
      }
    }
  })

  it('지급완료에서 갈 수 있는 곳이 없다 (F5)', () => {
    expect(settlementTransitions.PAID).toEqual([])
    for (const status of statuses) expect(canTransition('PAID', status)).toBe(false)
  })

  /** 보류는 승인의 반대가 아니라 **판단을 미룬 상태**다 — 그래서 「거절」이 없다. */
  it('보류에서 갈 수 있는 곳은 승인뿐이다', () => {
    expect(settlementTransitions.HOLD).toEqual(['APPROVED'])
  })

  it('대기에서 바로 지급할 수 없다', () => {
    expect(canTransition('PENDING', 'PAID')).toBe(false)
  })

  it('자기 자신으로 가는 화살표가 없다', () => {
    for (const status of statuses) expect(canTransition(status, status)).toBe(false)
  })
})

describe('배치가 고칠 수 있는가', () => {
  it('대기 중일 때만 고칠 수 있다', () => {
    expect(isAmendable('PENDING')).toBe(true)
  })

  /** 사람이 들여다보고 있는 숫자가 그 사이에 움직이면 무엇을 보류한 것인지 모른다. */
  it.each(['HOLD', 'APPROVED', 'PAID'] as const)('%s 는 고칠 수 없다', (status) => {
    expect(isAmendable(status)).toBe(false)
  })
})

describe('이 상태로 올 수 있는 곳', () => {
  /** 승인은 두 곳에서 온다 — 조건부 갱신이 이 목록을 그대로 쓴다. */
  it('승인은 대기와 보류에서 온다', () => {
    expect(sourcesOf('APPROVED')).toEqual(['PENDING', 'HOLD'])
  })

  it('지급은 승인에서만 온다', () => {
    expect(sourcesOf('PAID')).toEqual(['APPROVED'])
  })

  it('보류는 대기에서만 온다', () => {
    expect(sourcesOf('HOLD')).toEqual(['PENDING'])
  })

  /** 처음 상태로 돌아오는 길이 없다 — 배치가 만든 뒤로는 아무도 되돌리지 못한다. */
  it('대기로 오는 길이 없다', () => {
    expect(sourcesOf('PENDING')).toEqual([])
  })
})
