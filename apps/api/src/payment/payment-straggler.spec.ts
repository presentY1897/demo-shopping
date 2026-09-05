/**
 * 낙오 배치의 순수 판단 (TASK-0057). 입력 → 출력, 분기 100%.
 *
 * 여기서 재는 것은 **언제 손대도 되는가**이고, 두 방향이 각각 다른 이유로 다른
 * 값을 쓴다. 둘 다 틀려도 조용하다.
 *
 * - **앞쪽 유예**가 짧으면 배치가 방금 매입한 결제의 `markPaid` 와 겹친다.
 *   `PAID` + `PAYMENT_PENDING` 은 정상 결제도 반드시 지나는 창이기 때문이고,
 *   증상은 「가끔 결제가 실패한다」다.
 * - **뒤쪽 임계치**가 짧으면 아직 살아 있는 승인을 우리가 취소한다 (R1). 그것은
 *   빨간 테스트가 아니라 산 사람의 결제가 사라지는 일이다.
 * - **세는 자리**가 어긋나면 `AppMeta` 에 적히는 건수가 틀리고, 그 숫자는
 *   「배치가 일하고 있는가」를 묻는 유일한 자리다.
 */

import { describe, expect, it } from 'vitest'

import { RESERVATION_TTL_MS } from '../reservation/reservation-rules.js'
import { SWEEP_LOCK_KEY } from '../reservation/reservation-sweeper.js'
import { RECONCILE_LOCK_KEY } from './payment-reconcile.js'
import {
  abandonedBefore,
  capturedBefore,
  counted,
  fixedCount,
  isStragglerStale,
  NOTHING_STRANDED,
  STRAGGLER_ABANDONED_AFTER_MS,
  STRAGGLER_COMPLETE_GRACE_MS,
  STRAGGLER_INTERVAL_MS,
  STRAGGLER_LOCK_KEY,
  STRAGGLER_STALE_AFTER_MS,
  worstCycleMs,
  worthLogging,
} from './payment-straggler.js'
import type { StragglerTally } from './payment-straggler.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

/** `NOW` 에서 `ms` 만큼 이전. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

/** 이 주기가 만난 것들. 적지 않은 칸은 0 이다. */
function tally(parts: Partial<StragglerTally> = {}): StragglerTally {
  return { ...NOTHING_STRANDED, ...parts }
}

describe('앞으로 — 언제 마저 끝내는가', () => {
  it('leaves a capture that has only just landed alone', () => {
    // **정상 결제도 이 모양을 지난다.** `settle` 은 매입을 `PAID` 로 커밋한 뒤에
    // `markPaid` 를 부르므로, 그 사이의 한순간은 모든 결제가 `PAID` +
    // `PAYMENT_PENDING` 이다. 유예 없이 집으면 배치가 그 `markPaid` 와 겹친다.
    expect(ago(0).getTime()).toBeGreaterThan(capturedBefore(NOW).getTime())
  })

  it('finishes the order once the grace has passed', () => {
    expect(ago(STRAGGLER_COMPLETE_GRACE_MS + 1).getTime()).toBeLessThan(
      capturedBefore(NOW).getTime(),
    )
  })

  it('draws the line exactly one grace back', () => {
    // 경계다. 한쪽으로 밀리면 돈을 이미 낸 사람이 물건을 기다리는 시간이 그만큼
    // 길어지거나, 정상 결제가 배치와 겹치기 시작한다.
    expect(capturedBefore(NOW)).toEqual(ago(STRAGGLER_COMPLETE_GRACE_MS))
  })

  it('takes a grace of its own, so a spec need not wait a minute', () => {
    expect(capturedBefore(NOW, 1_000)).toEqual(ago(1_000))
  })
})

describe('뒤로 — 언제 되감는가', () => {
  it('waits at least as long as a reservation could have lived', () => {
    // **예약 TTL 이 하한이다.** 이 결제로 물건을 살 수 있게 하는 것이 예약이고,
    // 승인은 예약을 잡은 뒤에 일어난다 — 그래서 `approvedAt` 에서 TTL 을 통째로
    // 세는 것은 그 사람이 가졌던 창을 전부 기다린 것보다 길다. 그보다 짧은 값은
    // 근거 없는 추측이고, 그 자리에서 나는 사고가 R1 이다.
    expect(STRAGGLER_ABANDONED_AFTER_MS).toBeGreaterThan(RESERVATION_TTL_MS)
  })

  it('leaves an authorization younger than the threshold alone', () => {
    expect(ago(STRAGGLER_ABANDONED_AFTER_MS - 1).getTime()).toBeGreaterThan(
      abandonedBefore(NOW).getTime(),
    )
  })

  it('considers one older than the threshold', () => {
    // **후보일 뿐이다.** 두 번째 조건 — 살아 있는 예약이 없다 — 은 시각이 아니라
    // 예약 표가 답하고, 그 AND 는 배치의 쿼리가 지킨다.
    expect(ago(STRAGGLER_ABANDONED_AFTER_MS + 1).getTime()).toBeLessThan(
      abandonedBefore(NOW).getTime(),
    )
  })

  it('draws the line exactly one threshold back', () => {
    expect(abandonedBefore(NOW)).toEqual(ago(STRAGGLER_ABANDONED_AFTER_MS))
  })

  it('takes a threshold of its own, so a spec need not wait sixteen minutes', () => {
    expect(abandonedBefore(NOW, 1_000)).toEqual(ago(1_000))
  })

  it('waits far longer than the forward direction does', () => {
    // 두 유예가 다른 값인 것이 이 배치의 성질이다. 앞쪽은 「이 창을 정상 결제도
    // 지난다」라 짧아도 되고, 뒤쪽은 「사람이 돌아올 수 있다」라 길어야 한다.
    expect(STRAGGLER_ABANDONED_AFTER_MS).toBeGreaterThan(STRAGGLER_COMPLETE_GRACE_MS)
  })
})

describe('무엇을 세는가', () => {
  it('starts from nothing', () => {
    expect(fixedCount(NOTHING_STRANDED)).toBe(0)
  })

  it('counts each result in its own column', () => {
    // 네 결과가 각자의 칸에 들어간다. 하나가 다른 칸에 쌓이면 헬스체크의 숫자와
    // 로그가 서로 다른 이야기를 하게 된다.
    const counts = (['completed', 'canceled', 'overtaken', 'failed'] as const).reduce(
      counted,
      NOTHING_STRANDED,
    )

    expect(counts).toEqual(tally({ completed: 1, canceled: 1, overtaken: 1, failed: 1 }))
  })

  it('adds up, so two of one result are two', () => {
    expect(counted(counted(NOTHING_STRANDED, 'canceled'), 'canceled').canceled).toBe(2)
  })

  it('leaves the tally it was given alone', () => {
    // 배치는 이 값을 주기 내내 들고 다닌다. 제자리에서 고치면 「이번 주기가 만난
    // 것」과 「지금까지 만난 것」이 같은 객체가 된다.
    const before = tally({ completed: 1 })

    counted(before, 'failed')

    expect(before).toEqual(tally({ completed: 1 }))
  })

  it('records only what the batch itself finished', () => {
    // `overtaken` 은 사람이 돌아와 결제를 마친 것이고 `failed` 는 아직 안 고친
    // 것이다. 더하면 「배치가 몇 건을 끝냈나」에 사람이 한 일과 못 한 일이 섞인다.
    expect(fixedCount(tally({ completed: 2, canceled: 1, overtaken: 5, failed: 3 }))).toBe(3)
  })
})

describe('무엇을 로그로 남기는가', () => {
  it('says nothing about a cycle that only found people finishing their own payments', () => {
    // 사람이 돌아와 매입을 마친 것은 배치가 고칠 것이 없는 사실이다. 1분마다
    // 그것을 한 줄씩 쌓으면 정작 읽어야 할 줄이 그 사이에 묻힌다.
    expect(worthLogging(tally({ overtaken: 3 }))).toBe(false)
    expect(worthLogging(NOTHING_STRANDED)).toBe(false)
  })

  it('speaks when a payment actually moved', () => {
    expect(worthLogging(tally({ completed: 1 }))).toBe(true)
    expect(worthLogging(tally({ canceled: 1 }))).toBe(true)
  })

  it('speaks when one could not be handled', () => {
    // 이것은 결과가 아니라 사고다. 계속 늘어나면 배치가 한 건에 걸려 있다는 뜻이다.
    expect(worthLogging(tally({ failed: 1 }))).toBe(true)
  })
})

describe('멈췄는가', () => {
  it('treats a batch that has never run as stopped', () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없다. 돈을 낸
    // 사람의 주문이 멈춰 있을지 모르는 상태에서 안전한 해석은 멈췄다는 쪽이다.
    expect(isStragglerStale(null, NOW)).toBe(true)
  })

  it('is content while the batch is keeping up', () => {
    expect(isStragglerStale(ago(STRAGGLER_INTERVAL_MS), NOW)).toBe(false)
  })

  it('tolerates exactly the threshold, and nothing past it', () => {
    expect(isStragglerStale(ago(STRAGGLER_STALE_AFTER_MS), NOW)).toBe(false)
    expect(isStragglerStale(ago(STRAGGLER_STALE_AFTER_MS + 1), NOW)).toBe(true)
  })
})

describe('상수', () => {
  it('does not share a lock key with the sweeper or the reconciler', () => {
    // 세 잡이 우연히 같은 수를 고르면 그중 하나가 영문 모른 채 건너뛰고, 그
    // 증상은 「가끔 안 돈다」다. 열쇠를 문자열에서 만드는 이유가 이것이다.
    expect(STRAGGLER_LOCK_KEY).not.toBe(SWEEP_LOCK_KEY)
    expect(STRAGGLER_LOCK_KEY).not.toBe(RECONCILE_LOCK_KEY)
  })

  it('keeps the worst case of one cycle under the stale threshold', () => {
    // 두 방향이 한 주기 안에서 차례로 도므로 예산도 함께 쓴다. 이 합이 임계치를
    // 넘으면 **일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽는다** — 두 상한을
    // 이 부등식으로 정했고, 결제사 마감이 늘어나면 상한도 같이 움직여야 한다는
    // 사실이 이 한 줄로 남는다.
    expect(worstCycleMs()).toBeLessThan(STRAGGLER_STALE_AFTER_MS)
  })
})
