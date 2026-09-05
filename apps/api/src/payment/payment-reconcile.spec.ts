/**
 * 대사 배치의 순수 판단 (TASK-0056). 입력 → 출력, 분기 100%.
 *
 * 여기서 재는 셋은 전부 **틀려도 조용한** 것들이다. 유예가 어긋나면 배치는 매
 * 주기 `pending` 만 받아 오는데 그 모양은 로그에도 헬스체크에도 정상으로 보이고,
 * 세는 자리가 어긋나면 「대사가 일하고 있는가」를 묻는 유일한 숫자가 틀리며, 로그
 * 판단이 어긋나면 읽어야 할 한 줄이 「0건」 사이에 묻힌다.
 */

import { describe, expect, it } from 'vitest'

import { SWEEP_LOCK_KEY } from '../reservation/reservation-sweeper.js'
import {
  askableBefore,
  counted,
  isReconcileStale,
  NOTHING_RECONCILED,
  RECONCILE_BATCH_LIMIT,
  RECONCILE_GRACE_MS,
  RECONCILE_INTERVAL_MS,
  RECONCILE_LOCK_KEY,
  RECONCILE_STALE_AFTER_MS,
  resolvedCount,
  worthLogging,
} from './payment-reconcile.js'
import type { ReconcileTally } from './payment-reconcile.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

/** `NOW` 에서 `ms` 만큼 이전. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

/** 이 주기가 만난 것들. 적지 않은 칸은 0 이다. */
function tally(parts: Partial<ReconcileTally> = {}): ReconcileTally {
  return { ...NOTHING_RECONCILED, ...parts }
}

describe('언제 물어보는가', () => {
  it('leaves a payment that has only just been cut off alone', () => {
    // 우리 요청은 이미 15초를 기다리다 끊긴 것이고, 저쪽의 카드 승인은 그 뒤로도
    // 진행 중일 수 있다. 지금 물어봐야 돌아오는 답은 `pending` 뿐이다.
    expect(ago(0).getTime()).toBeGreaterThan(askableBefore(NOW).getTime())
  })

  it('asks once the grace has passed', () => {
    expect(ago(RECONCILE_GRACE_MS + 1).getTime()).toBeLessThan(askableBefore(NOW).getTime())
  })

  it('draws the line exactly one grace back', () => {
    // 경계다. 한쪽으로 밀리면 유예가 한 주기씩 길어지거나 짧아지는데, 그 차이는
    // 사람이 「확인 중」 화면 앞에 서 있는 시간이다.
    expect(askableBefore(NOW)).toEqual(ago(RECONCILE_GRACE_MS))
  })

  it('takes a grace of its own, so a spec need not wait a minute', () => {
    expect(askableBefore(NOW, 1_000)).toEqual(ago(1_000))
  })
})

describe('무엇을 세는가', () => {
  it('starts from nothing', () => {
    expect(resolvedCount(NOTHING_RECONCILED)).toBe(0)
  })

  it('counts each answer in its own column', () => {
    // 다섯 답이 각자의 칸에 들어간다. 하나가 다른 칸에 쌓이면 헬스체크의 숫자와
    // 로그가 서로 다른 이야기를 하게 된다.
    const counts = (['settled', 'failed', 'pending', 'noop', 'unreachable'] as const).reduce(
      counted,
      NOTHING_RECONCILED,
    )

    expect(counts).toEqual(tally({ settled: 1, failed: 1, pending: 1, noop: 1, unreachable: 1 }))
  })

  it('adds up, so two of one answer are two', () => {
    expect(counted(counted(NOTHING_RECONCILED, 'settled'), 'settled').settled).toBe(2)
  })

  it('leaves the tally it was given alone', () => {
    // 배치는 이 값을 주기 내내 들고 다닌다. 제자리에서 고치면 「이번 주기가
    // 만난 것」과 「지금까지 만난 것」이 같은 객체가 된다.
    const before = tally({ settled: 1 })

    counted(before, 'failed')

    expect(before).toEqual(tally({ settled: 1 }))
  })

  it('records only what reconciliation itself moved', () => {
    // `pending` 과 `noop` 은 빠진다. 앞은 상태가 그대로이고 뒤는 옮긴 것이
    // 우리가 아니다 — 더하면 이 숫자가 웹훅이 한 일과 섞인다.
    expect(resolvedCount(tally({ settled: 2, failed: 1, pending: 5, noop: 3 }))).toBe(3)
  })
})

describe('무엇을 로그로 남기는가', () => {
  it('says nothing about a cycle that only found normal answers', () => {
    // **`pending` 과 `noop` 은 둘 다 정상이다.** 저쪽이 아직 처리 중인 것과
    // 웹훅이 먼저 일한 것은 배치가 고칠 것이 없는 사실이고, 1분마다 그것을 한
    // 줄씩 쌓으면 정작 읽어야 할 줄이 그 사이에 묻힌다.
    expect(worthLogging(tally({ pending: 3, noop: 2 }))).toBe(false)
    expect(worthLogging(NOTHING_RECONCILED)).toBe(false)
  })

  it('speaks when a payment actually moved', () => {
    expect(worthLogging(tally({ settled: 1 }))).toBe(true)
    expect(worthLogging(tally({ failed: 1 }))).toBe(true)
  })

  it('speaks when a payment could not be asked about', () => {
    // 이것은 답이 아니라 사고다. 계속 늘어나면 배치가 한 건에 걸려 있다는 뜻이다.
    expect(worthLogging(tally({ unreachable: 1 }))).toBe(true)
  })
})

describe('멈췄는가', () => {
  it('treats a reconciliation that has never run as stopped', () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없다. 결과를
    // 모르는 결제가 갇혀 있을지 모르는 상태에서 안전한 해석은 멈췄다는 쪽이다.
    expect(isReconcileStale(null, NOW)).toBe(true)
  })

  it('is content while the batch is keeping up', () => {
    expect(isReconcileStale(ago(RECONCILE_INTERVAL_MS), NOW)).toBe(false)
  })

  it('tolerates exactly the threshold, and nothing past it', () => {
    expect(isReconcileStale(ago(RECONCILE_STALE_AFTER_MS), NOW)).toBe(false)
    expect(isReconcileStale(ago(RECONCILE_STALE_AFTER_MS + 1), NOW)).toBe(true)
  })
})

describe('상수', () => {
  it('does not share a lock key with the reservation sweeper', () => {
    // 두 잡이 우연히 같은 수를 고르면 둘 중 하나가 영문 모른 채 건너뛰고, 그
    // 증상은 「가끔 안 돈다」다. 열쇠를 문자열에서 만드는 이유가 이것이다.
    expect(RECONCILE_LOCK_KEY).not.toBe(SWEEP_LOCK_KEY)
  })

  it('keeps the worst case of one cycle under the stale threshold', () => {
    // 한 건이 결제사 마감(15초)을 통째로 쓰는 최악을 가정한다. 이 곱이 임계치를
    // 넘으면 **일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽는다** — 상한을
    // 스위퍼의 200 이 아니라 이 부등식으로 정한 이유다.
    expect(RECONCILE_BATCH_LIMIT * 15_000).toBeLessThan(RECONCILE_STALE_AFTER_MS)
  })
})
