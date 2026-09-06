/**
 * 환불 재시도 배치의 순수 판단 (TASK-0068 F8 · R3). 입력 → 출력, 분기 100%.
 *
 * 여기서 재는 것은 **언제 다시 시도해도 되는가**이고, 틀려도 조용하다.
 *
 * - **유예**가 짧으면 배치가 방금 승인된 취소의 환불과 겹친다. 승인·검수는 커밋한
 *   뒤에 환불을 부르므로 정상 흐름도 반드시 이 창을 지난다.
 * - **찾는 상태 목록**이 어긋나면 그 경로의 환불은 영영 재시도되지 않는다. 실패한
 *   환불은 아무 오류도 내지 않으므로, 증상은 「돈이 안 들어온다」는 문의 하나뿐이다.
 * - **세는 자리**가 어긋나면 `AppMeta` 에 적히는 건수가 틀리고, 그 숫자는 「배치가
 *   일하고 있는가」를 묻는 유일한 자리다.
 */

import { describe, expect, it } from 'vitest'

import { RECONCILE_LOCK_KEY } from '../payment/payment-reconcile.js'
import { STRAGGLER_LOCK_KEY } from '../payment/payment-straggler.js'
import { SWEEP_LOCK_KEY } from '../reservation/reservation-sweeper.js'
import { claimStatuses } from './claim-rules.js'
import type { RefundTally } from './refund-retry.js'
import {
  CLAIM_REFUND_GRACE_MS,
  CLAIM_REFUND_INTERVAL_MS,
  CLAIM_REFUND_LOCK_KEY,
  CLAIM_REFUND_STALE_AFTER_MS,
  counted,
  fixedCount,
  isClaimRefundStale,
  NOTHING_REFUNDED,
  refundableStatuses,
  stuckBefore,
  worstCycleMs,
  worthLogging,
} from './refund-retry.js'

const NOW = new Date('2026-09-07T00:00:00.000Z')

/** `NOW` 에서 `ms` 만큼 이전. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

/** 이 주기가 만난 것들. 적지 않은 칸은 0 이다. */
function tally(parts: Partial<RefundTally> = {}): RefundTally {
  return { ...NOTHING_REFUNDED, ...parts }
}

describe('무엇을 찾는가', () => {
  it('takes the two places a claim waits for its money', () => {
    // 취소의 승인과 반품의 검수 통과. 두 경로가 만나는 자리가 `REFUNDED` 이므로
    // 그 앞자리도 정확히 둘이다.
    expect([...refundableStatuses].sort()).toEqual(['CANCEL_APPROVED', 'RETURN_COMPLETED'])
  })

  it('reads the list off the transition table rather than repeating it', () => {
    // 손으로 적으면 세 번째 경로가 `REFUNDED` 로 가는 화살표를 얻는 날 그 경로가
    // 조용히 빠지고, 재시도되지 않는 환불은 아무 오류도 내지 않는다.
    expect(refundableStatuses.every((status) => claimStatuses.includes(status))).toBe(true)
    expect(refundableStatuses).not.toContain('REFUNDED')
  })
})

describe('언제 다시 시도하는가', () => {
  it('leaves a claim that has only just been approved alone', () => {
    // **정상 흐름도 이 모양을 지난다.** 승인은 커밋한 뒤에 환불을 부르므로, 그
    // 사이의 한순간은 모든 클레임이 「승인됐는데 아직 `REFUNDED` 가 아닌」 상태다.
    expect(ago(0).getTime()).toBeGreaterThan(stuckBefore(NOW).getTime())
  })

  it('retries once the grace has passed', () => {
    expect(ago(CLAIM_REFUND_GRACE_MS + 1).getTime()).toBeLessThan(stuckBefore(NOW).getTime())
  })

  it('draws the line exactly one grace back', () => {
    expect(stuckBefore(NOW)).toEqual(ago(CLAIM_REFUND_GRACE_MS))
  })

  it('takes a grace of its own, so a spec need not wait a minute', () => {
    expect(stuckBefore(NOW, 1_000)).toEqual(ago(1_000))
  })
})

describe('무엇을 세는가', () => {
  it('starts from nothing', () => {
    expect(fixedCount(NOTHING_REFUNDED)).toBe(0)
  })

  it('counts each result in its own column', () => {
    const counts = (['refunded', 'settled', 'ignored', 'failed'] as const).reduce(
      counted,
      NOTHING_REFUNDED,
    )

    expect(counts).toEqual(tally({ refunded: 1, settled: 1, ignored: 1, failed: 1 }))
  })

  it('adds up, so two of one result are two', () => {
    expect(counted(counted(NOTHING_REFUNDED, 'failed'), 'failed').failed).toBe(2)
  })

  it('leaves the tally it was given alone', () => {
    const before = tally({ refunded: 1 })

    counted(before, 'failed')

    expect(before).toEqual(tally({ refunded: 1 }))
  })

  it('records only the refunds this batch actually sent', () => {
    // `settled` 는 멱등이 막아 준 재호출이고 `ignored` 는 손댈 것이 없던 건이며
    // `failed` 는 아직 못 한 것이다. 셋 중 하나라도 더하면 「배치가 몇 건을
    // 구했나」에 한 적 없는 일이 섞인다.
    expect(fixedCount(tally({ refunded: 2, settled: 5, ignored: 3, failed: 1 }))).toBe(2)
  })
})

describe('무엇을 로그로 남기는가', () => {
  it('says nothing about a cycle that found only finished work', () => {
    expect(worthLogging(tally({ settled: 3, ignored: 2 }))).toBe(false)
    expect(worthLogging(NOTHING_REFUNDED)).toBe(false)
  })

  it('speaks when money actually moved', () => {
    expect(worthLogging(tally({ refunded: 1 }))).toBe(true)
  })

  it('speaks when one could not be handled', () => {
    // 결과가 아니라 사고다. 계속 늘어나면 배치가 한 건에 걸려 있다는 뜻이다.
    expect(worthLogging(tally({ failed: 1 }))).toBe(true)
  })
})

describe('멈췄는가', () => {
  it('treats a batch that has never run as stopped', () => {
    expect(isClaimRefundStale(null, NOW)).toBe(true)
  })

  it('is content while the batch is keeping up', () => {
    expect(isClaimRefundStale(ago(CLAIM_REFUND_INTERVAL_MS), NOW)).toBe(false)
  })

  it('tolerates exactly the threshold, and nothing past it', () => {
    expect(isClaimRefundStale(ago(CLAIM_REFUND_STALE_AFTER_MS), NOW)).toBe(false)
    expect(isClaimRefundStale(ago(CLAIM_REFUND_STALE_AFTER_MS + 1), NOW)).toBe(true)
  })
})

describe('상수', () => {
  it('does not share a lock key with the other three jobs', () => {
    // 네 잡이 우연히 같은 수를 고르면 그중 하나가 영문 모른 채 건너뛰고, 그 증상은
    // 「가끔 안 돈다」다. 열쇠를 문자열에서 만드는 이유가 이것이다.
    expect(CLAIM_REFUND_LOCK_KEY).not.toBe(SWEEP_LOCK_KEY)
    expect(CLAIM_REFUND_LOCK_KEY).not.toBe(RECONCILE_LOCK_KEY)
    expect(CLAIM_REFUND_LOCK_KEY).not.toBe(STRAGGLER_LOCK_KEY)
  })

  it('keeps the worst case of one cycle under the stale threshold', () => {
    // 한 건이 결제사 마감을 통째로 쓰고 그 위에 우리 트랜잭션 하나가 얹히는 최악을
    // 가정한다. 이 곱이 임계치를 넘으면 **일하느라 늦은 배치를 「멈췄다」로 읽는다**
    // — 상한을 이 부등식으로 정했고, 결제사 마감이 늘어나면 상한도 같이 움직여야
    // 한다는 사실이 이 한 줄로 남는다.
    expect(worstCycleMs()).toBeLessThan(CLAIM_REFUND_STALE_AFTER_MS)
  })

  it('waits at least one provider deadline before retrying', () => {
    // 유예가 인라인 시도 하나의 최악보다 짧으면, 배치가 아직 결제사를 기다리는
    // 환불을 집어 와 같은 클레임에 두 번째 호출을 건다. 그 둘은 클레임 행 잠금에서
    // 줄을 서므로 돈이 두 번 나가지는 않지만, 연결 하나가 그동안 헛돈다.
    expect(CLAIM_REFUND_GRACE_MS).toBeGreaterThan(worstCycleMs() / 10)
  })
})
