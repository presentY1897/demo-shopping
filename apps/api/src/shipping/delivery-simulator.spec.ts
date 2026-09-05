/**
 * 배송 진행의 순수 판단 (TASK-0062, Q5 강화 — 분기 커버리지 100%).
 *
 * **이 파일이 지키는 것은 두 문장이다.**
 *
 * ① **다음 단계가 무엇인가.** 표에 빈 칸이 하나 생기면 그 상태에 들어간 배송은
 *    아무도 모르게 멈추고, 화면은 「배송중」이라고 정직하게 말한다 — 빨간 검사가
 *    아니라 영영 도착하지 않는 주문으로 나타난다.
 * ② **그 때가 언제인가.** 여기 적힌 숫자들이 이 TASK 의 존재 이유를 직접 결정한다.
 *    데모 단계가 길어지면 방문자가 배송완료를 못 보고 그 뒤의 구매확정 · 정산 ·
 *    반품이 전부 닫히는데, **그것도 아무것도 실패시키지 않는다.** 그래서 시간에
 *    걸린 부등식들을 아래에서 직접 단언한다 — `payment-straggler.spec.ts` 가
 *    상한과 임계치의 부등식을 단언하는 것과 같은 이유다.
 */

import type { ShipmentStatus } from '@shopping/shared'
import { DEMO_ACCOUNT_TTL_HOURS, shipmentStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { RECONCILE_LOCK_KEY } from '../payment/payment-reconcile.js'
import { STRAGGLER_LOCK_KEY } from '../payment/payment-straggler.js'
import { SWEEP_LOCK_KEY } from '../reservation/reservation-sweeper.js'
import type { DeliveryTally } from './delivery-simulator.js'
import {
  advanceableBefore,
  advanceableShipmentStatuses,
  advancedCount,
  counted,
  DELIVERY_BATCH_LIMIT,
  DELIVERY_INTERVAL_MS,
  DELIVERY_LAST_ADVANCED_KEY,
  DELIVERY_LAST_RUN_KEY,
  DELIVERY_LOCK_KEY,
  DELIVERY_STALE_AFTER_MS,
  DELIVERY_STEP_BUDGET_MS,
  DELIVERY_STEP_MS,
  DELIVERY_STEPS,
  deliveryStepMs,
  dueAt,
  isDeliveryStale,
  nextTrackingEvent,
  NOTHING_ADVANCED,
  worstCycleMs,
  worthLogging,
} from './delivery-simulator.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** F2 가 재는 값 — 「데모 모드에서 발송하면 10분 안에 배송완료에 닿는다」. */
const DEMO_BUDGET_MS = 10 * MINUTE_MS

describe('다음 단계 (F1)', () => {
  it.each([
    ['READY', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
    ['OUT_FOR_DELIVERY', 'DELIVERED'],
  ] as const)('moves %s on to %s', (status, kind) => {
    expect(nextTrackingEvent(status)).toBe(kind)
  })

  it('does not push a delivered shipment any further', () => {
    // 사다리의 끝이다. 여기서 무언가를 돌려주면 도착한 배송이 매 주기 새 줄을
    // 쌓고, 추적 화면은 배송완료 뒤에도 계속 움직인다.
    expect(nextTrackingEvent('DELIVERED')).toBeNull()
  })

  it('never starts over from the pickup that shipping already recorded', () => {
    // 집화는 발송 처리가 남긴다 (TASK-0061 `ShipmentService.issue`). `READY` 를
    // 「아직 아무 일도 없다」로 읽고 여기서 다시 적으면 이력에 같은 줄이 둘 생긴다.
    expect(shipmentStatuses.map(nextTrackingEvent)).not.toContain('PICKED_UP')
  })

  it('decides for every shipment status there is', () => {
    // 상태가 하나 늘면 컴파일이 먼저 깨지지만, 그 표가 실제로 전부 채워졌는지는
    // 값으로 확인한다 — `undefined` 가 섞이면 배치는 그 배송을 조용히 건너뛴다.
    for (const status of shipmentStatuses) {
      expect(nextTrackingEvent(status)).not.toBeUndefined()
    }
  })
})

describe('배치가 손대는 상태 (F1)', () => {
  it('is exactly the statuses that have a next step', () => {
    // 질의의 `WHERE` 가 이 목록을 그대로 쓴다. 표와 갈라지면 배치가 매 주기 같은
    // 건에서 실패하고, 그 증상은 「밀린 것이 안 줄어든다」다.
    const withNext = shipmentStatuses.filter((status) => nextTrackingEvent(status) !== null)

    expect([...advanceableShipmentStatuses]).toEqual([...withNext])
  })

  it('leaves the delivered ones alone', () => {
    expect(advanceableShipmentStatuses).not.toContain<ShipmentStatus>('DELIVERED')
  })

  it('counts the steps the simulator actually creates', () => {
    // 집화를 빼고 셋이다. 이 수가 아래 시간 예산의 곱하는 쪽이라, 손으로 적은 3 은
    // 상태가 하나 늘어난 날 조용히 틀린다.
    expect(DELIVERY_STEPS).toBe(3)
    expect(DELIVERY_STEPS).toBe(advanceableShipmentStatuses.length)
  })
})

describe('시간 압축 (F2)', () => {
  it('spaces demo steps two minutes apart', () => {
    expect(deliveryStepMs('demo')).toBe(2 * MINUTE_MS)
    expect(DELIVERY_STEP_MS.demo).toBe(2 * MINUTE_MS)
  })

  it('spaces realistic steps four hours apart', () => {
    expect(deliveryStepMs('realistic')).toBe(4 * HOUR_MS)
  })

  it('reaches delivery inside the demo budget', () => {
    // **이 부등식이 TASK 의 존재 이유다.** 넘기면 방문자가 배송완료를 못 보고,
    // 그 뒤의 구매확정 · 정산 · 반품이 전부 닫힌다 — 그런데 아무것도 실패하지
    // 않으므로 이 한 줄 말고는 그것을 잡을 자리가 없다.
    expect(DELIVERY_STEP_MS.demo * DELIVERY_STEPS).toBeLessThanOrEqual(DEMO_BUDGET_MS)
  })

  it('still finishes inside a demo account lifetime on the realistic pace', () => {
    // 느린 모드도 24시간 안에는 끝나야 한다. 그러지 않으면 그 모드에서는 배송
    // 뒤의 흐름을 **아예** 시연할 수 없고, 그것은 「선택할 수 있는 값」이 아니라
    // 「고르면 안 되는 값」이다.
    expect(DELIVERY_STEP_MS.realistic * DELIVERY_STEPS).toBeLessThan(
      DEMO_ACCOUNT_TTL_HOURS * HOUR_MS,
    )
  })

  it('keeps the realistic pace slower than the demo one', () => {
    // 두 값이 뒤집히면 이름이 거짓이 된다. 숫자를 손보다 실수하는 방향이 이쪽이다.
    expect(DELIVERY_STEP_MS.realistic).toBeGreaterThan(DELIVERY_STEP_MS.demo)
  })

  it('ticks more often than the shortest step lasts', () => {
    // 주기가 단계보다 길면 「2분마다 한 단계」가 실제로는 주기마다 한 단계가 되고,
    // 이 TASK 가 약속한 숫자가 거짓이 된다.
    expect(DELIVERY_INTERVAL_MS).toBeLessThan(DELIVERY_STEP_MS.demo)
  })
})

describe('때를 재는 기준', () => {
  it('measures the deadline back from now by one step', () => {
    expect(advanceableBefore(NOW, 2 * MINUTE_MS)).toEqual(new Date('2026-09-04T23:58:00.000Z'))
  })

  it('stamps the event at the moment it came due, not at the moment it is written', () => {
    // 주기가 1분이고 단계가 2분이라 사건은 늘 늦게 적힌다. 그 늦음을 시각에 넣으면
    // **다음 단계의 기준이 밀린 시각**이 되어 오차가 단계마다 쌓이고, 세 단계면
    // 데모의 6분이 9분이 된다 — F2 가 재는 바로 그 숫자다.
    expect(dueAt(new Date('2026-09-04T23:58:00.000Z'), 2 * MINUTE_MS)).toEqual(NOW)
  })

  it('is the exact inverse of the deadline it selects by', () => {
    // 둘이 어긋나면 경계에 선 배송이 「고르기에는 때가 됐는데 적히는 시각은 아직
    // 미래」가 되고, 그 사건은 다음 주기에 곧바로 또 때가 된다.
    const step = DELIVERY_STEP_MS.demo

    expect(dueAt(advanceableBefore(NOW, step), step)).toEqual(NOW)
  })
})

describe('한 주기의 예산 (배치 상한의 근거)', () => {
  it('keeps the worst cycle well under the stale threshold', () => {
    // **넘겨 잡으면 일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽는다.**
    // `payment-straggler.spec.ts` 가 같은 부등식을 같은 이유로 단언한다.
    expect(worstCycleMs()).toBe(DELIVERY_BATCH_LIMIT * DELIVERY_STEP_BUDGET_MS)
    expect(worstCycleMs()).toBeLessThan(DELIVERY_STALE_AFTER_MS)
  })

  it('gives the stale threshold five cycles of slack', () => {
    // 한 번 걸러 뛰는 것은 재시작이나 배포로도 일어난다. 그것까지 알람으로 만들면
    // 아무도 알람을 안 본다 — 옆의 세 잡과 같은 근거다.
    expect(DELIVERY_STALE_AFTER_MS).toBe(5 * DELIVERY_INTERVAL_MS)
  })
})

describe('한 주기가 무엇을 만났나', () => {
  it('starts from nothing', () => {
    expect(NOTHING_ADVANCED).toEqual({ advanced: 0, delivered: 0, failed: 0 })
  })

  it.each(['advanced', 'delivered', 'failed'] as const)('counts a %s outcome', (outcome) => {
    expect(counted(NOTHING_ADVANCED, outcome)[outcome]).toBe(1)
  })

  it('adds up only what it actually moved', () => {
    // 던진 건을 더하면 계속 실패하는 한 건이 「배치가 일하고 있다」의 근거로
    // 둔갑하고, 헬스체크의 숫자가 아무 말도 못 하게 된다.
    const tally: DeliveryTally = { advanced: 2, delivered: 1, failed: 4 }

    expect(advancedCount(tally)).toBe(3)
  })

  it('says nothing about a quiet cycle', () => {
    // 1분마다 「0건」을 쌓으면 정작 읽어야 할 줄 — 배송 하나가 도착했다 — 이 그
    // 사이에 묻힌다.
    expect(worthLogging(NOTHING_ADVANCED)).toBe(false)
  })

  it.each([
    ['advanced', { advanced: 1, delivered: 0, failed: 0 }],
    ['delivered', { advanced: 0, delivered: 1, failed: 0 }],
    ['failed', { advanced: 0, delivered: 0, failed: 1 }],
  ] as const)('logs a cycle that %s something', (_name, tally) => {
    expect(worthLogging(tally)).toBe(true)
  })
})

describe('멈췄는가 (F6)', () => {
  it('calls a batch that has never run stale', () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없고, 둘 중 안전한
    // 해석은 멈췄다는 쪽이다 — 스위퍼의 `isStale` 을 그대로 쓰는 이유다.
    expect(isDeliveryStale(null, NOW)).toBe(true)
  })

  it('is still healthy exactly at the threshold', () => {
    expect(isDeliveryStale(new Date(NOW.getTime() - DELIVERY_STALE_AFTER_MS), NOW)).toBe(false)
  })

  it('goes stale one millisecond later', () => {
    expect(isDeliveryStale(new Date(NOW.getTime() - DELIVERY_STALE_AFTER_MS - 1), NOW)).toBe(true)
  })
})

describe('다른 잡과 부딪히지 않는다 (F7)', () => {
  it('takes a lock key none of the other batches took', () => {
    // 우연히 같은 수를 고르면 둘 중 하나가 영문 모른 채 건너뛰고, 그 증상은
    // 「가끔 안 돈다」다. 같은 함수에 다른 문자열을 넣는 것이 「다르다」의 증명이다.
    const keys = [SWEEP_LOCK_KEY, RECONCILE_LOCK_KEY, STRAGGLER_LOCK_KEY, DELIVERY_LOCK_KEY]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('writes its own two AppMeta rows', () => {
    expect(DELIVERY_LAST_RUN_KEY).toBe('shipping.delivery.lastRunAt')
    expect(DELIVERY_LAST_ADVANCED_KEY).toBe('shipping.delivery.lastAdvanced')
  })
})
