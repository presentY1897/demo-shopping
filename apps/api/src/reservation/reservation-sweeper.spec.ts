/**
 * 만료 청소의 순수 판단 (TASK-0051). 입력 → 출력, 분기 100%.
 */

import { describe, expect, it } from 'vitest'

import {
  isStale,
  lockKeyOf,
  SWEEP_INTERVAL_MS,
  SWEEP_STALE_AFTER_MS,
} from './reservation-sweeper.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

/** `NOW` 에서 `ms` 만큼 이전. */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

describe('멈췄는가', () => {
  it('treats a sweep that has never run as stopped', () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없다. 안전한
    // 해석은 멈췄다는 쪽이다 — 부팅 직후 한 주기 동안 degraded 로 보이는 것이
    // 잠긴 재고를 못 보는 것보다 낫다.
    expect(isStale(null, NOW)).toBe(true)
  })

  it('is content while the sweep is keeping up', () => {
    expect(isStale(ago(SWEEP_INTERVAL_MS), NOW)).toBe(false)
  })

  it('tolerates exactly the threshold, and nothing past it', () => {
    // 경계다. 임계치를 「이상」으로 잡으면 정확히 그 순간에 도는 정상 주기가
    // 알람이 된다.
    expect(isStale(ago(SWEEP_STALE_AFTER_MS), NOW)).toBe(false)
    expect(isStale(ago(SWEEP_STALE_AFTER_MS + 1), NOW)).toBe(true)
  })

  it('takes a threshold of its own, so a spec need not wait five minutes', () => {
    expect(isStale(ago(2_000), NOW, 1_000)).toBe(true)
    expect(isStale(ago(2_000), NOW, 3_000)).toBe(false)
  })

  it('forgives a clock that jumped backwards', () => {
    // 마지막 실행이 미래로 적혀 있다 — 시계가 뒤로 갔거나 누가 행을 고쳤다.
    // 그것은 「오래 안 돌았다」가 아니고, 알람으로 만들 이유가 없다.
    expect(isStale(new Date(NOW.getTime() + 60_000), NOW)).toBe(false)
  })
})

describe('락 열쇠', () => {
  it('gives different names different keys', () => {
    // 두 기능이 우연히 같은 수를 고르면 둘 중 하나가 영문 모른 채 건너뛴다.
    expect(lockKeyOf('reservation.sweep')).not.toBe(lockKeyOf('demo.cleanup'))
  })

  it('is stable, so two instances agree', () => {
    expect(lockKeyOf('reservation.sweep')).toBe(lockKeyOf('reservation.sweep'))
  })

  it('never goes negative', () => {
    // 로그에 찍힌 음수 열쇠는 읽는 사람에게 아무 뜻이 없다.
    for (const name of ['a', 'zz', 'reservation.sweep', '만료 청소']) {
      expect(lockKeyOf(name)).toBeGreaterThanOrEqual(0)
    }
  })

  it('is empty-safe', () => {
    expect(lockKeyOf('')).toBeGreaterThanOrEqual(0)
  })
})
