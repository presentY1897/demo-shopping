/**
 * 만료 배치의 셈과 판단 (TASK-0076 F8).
 *
 * **세는 자리**가 어긋나면 `AppMeta` 에 적히는 금액이 틀리고, 그 숫자는 「배치가
 * 실제로 일하고 있는가」를 밖에서 볼 수 있는 유일한 값이다 — 배치가 조용히 멈추는
 * 것이 이 잡의 유일한 실패 방식이므로, 그 숫자가 곧 경보다
 * (`payment-straggler.spec.ts` 가 같은 이유로 같은 것을 잰다).
 */

import { describe, expect, it } from 'vitest'

import {
  counted,
  failed,
  isExpiryStale,
  NOTHING_EXPIRED,
  POINT_EXPIRY_LOCK_KEY,
  POINT_EXPIRY_STALE_AFTER_MS,
  worthLogging,
} from './point-expiry.js'
import { CONFIRM_LOCK_KEY } from '../orders/order-confirm.js'
import { SWEEP_LOCK_KEY } from '../reservation/reservation-sweeper.js'

describe('한 주기의 셈', () => {
  it('닫은 통의 수와 없앤 금액을 함께 센다', () => {
    const tally = counted(NOTHING_EXPIRED, [{ amount: 300 }, { amount: 700 }])

    expect(tally).toEqual({ lots: 2, amount: 1_000, failed: 0 })
  })

  it('아무것도 못 닫은 계정은 아무것도 더하지 않는다', () => {
    expect(counted(NOTHING_EXPIRED, [])).toEqual(NOTHING_EXPIRED)
  })

  it('실패한 계정은 따로 센다 — 만료된 금액에 섞이지 않는다', () => {
    expect(failed(counted(NOTHING_EXPIRED, [{ amount: 100 }]))).toEqual({
      lots: 1,
      amount: 100,
      failed: 1,
    })
  })
})

describe('로그로 남길 주기', () => {
  it('아무 일도 없던 주기는 남기지 않는다', () => {
    // 대부분의 주기가 그렇고, 1분마다 「0건」을 쌓으면 정작 읽어야 할 줄이 묻힌다.
    expect(worthLogging(NOTHING_EXPIRED)).toBe(false)
  })

  it('만료했거나 실패한 주기는 남긴다', () => {
    expect(worthLogging({ lots: 1, amount: 100, failed: 0 })).toBe(true)
    expect(worthLogging({ lots: 0, amount: 0, failed: 1 })).toBe(true)
  })
})

describe('멈췄는가', () => {
  const now = new Date('2026-09-06T00:00:00.000Z')

  it('한 번도 안 돌았으면 멈춘 것으로 읽는다', () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없고, 둘 중 안전한
    // 해석은 멈췄다는 쪽이다.
    expect(isExpiryStale(null, now)).toBe(true)
  })

  it('임계치를 넘으면 멈춘 것이다', () => {
    const justInside = new Date(now.getTime() - POINT_EXPIRY_STALE_AFTER_MS)
    const justOutside = new Date(now.getTime() - POINT_EXPIRY_STALE_AFTER_MS - 1)

    expect(isExpiryStale(justInside, now)).toBe(false)
    expect(isExpiryStale(justOutside, now)).toBe(true)
  })
})

describe('락 열쇠', () => {
  it('다른 잡과 겹치지 않는다', () => {
    // 겹치면 하나가 영문 모른 채 건너뛰고, 증상은 「가끔 안 돈다」다 — 그래서
    // 열쇠를 문자열에서 만든다.
    expect(POINT_EXPIRY_LOCK_KEY).not.toBe(SWEEP_LOCK_KEY)
    expect(POINT_EXPIRY_LOCK_KEY).not.toBe(CONFIRM_LOCK_KEY)
  })
})
