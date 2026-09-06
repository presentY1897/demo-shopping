import { describe, expect, it } from 'vitest'

import { lockKeyOf } from '../reservation/reservation-sweeper.js'
import {
  COUPON_EXPIRY_BATCH_LIMIT,
  COUPON_EXPIRY_INTERVAL_MS,
  COUPON_EXPIRY_LAST_EXPIRED_KEY,
  COUPON_EXPIRY_LAST_RUN_KEY,
  COUPON_EXPIRY_LOCK_KEY,
  COUPON_EXPIRY_ROW_BUDGET_MS,
  COUPON_EXPIRY_STALE_AFTER_MS,
  isCouponExpiryStale,
  worstCaseExpiryCycleMs,
  worthLoggingExpiry,
} from './coupon-expiry.js'

/**
 * 만료 배치의 상수와 판단 (TASK-0072 6.2, Q5 강화).
 *
 * **여기서 재는 것의 절반은 분기가 아니라 부등식이다.** 상한을 올리는 사람이
 * 주기와 stale 을 함께 보게 하는 것이 그 단언들의 일이고, `payment-straggler.ts`
 * 가 같은 이유로 같은 모양을 갖는다.
 */

describe('상한 · 주기 · stale 의 부등식', () => {
  it('최악의 한 주기가 주기보다 짧다', () => {
    // 넘으면 한 주기가 다음 주기를 밀고, 그때 `running` 플래그가 주기를 건너뛰게
    // 만들어 실제 처리량이 상한보다 낮아진다 — 밀린 것이 줄지 않는 모양이다.
    expect(worstCaseExpiryCycleMs()).toBeLessThan(COUPON_EXPIRY_INTERVAL_MS)
  })

  it('최악의 한 주기가 stale 임계치보다 짧다', () => {
    // 넘으면 **일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽는다.**
    expect(worstCaseExpiryCycleMs()).toBeLessThan(COUPON_EXPIRY_STALE_AFTER_MS)
  })

  it('부등식을 실제로 잴 수 있다 — 상한을 키우면 깨진다', () => {
    // 통제군. `worstCaseExpiryCycleMs` 가 상수를 돌려주기만 한다면 위 두 단언은
    // 장식이다.
    expect(worstCaseExpiryCycleMs(COUPON_EXPIRY_INTERVAL_MS + 1, 1)).toBeGreaterThan(
      COUPON_EXPIRY_INTERVAL_MS,
    )
  })

  it('한 장의 예산이 실측이 아니라 넉넉한 상한이다', () => {
    // 실제 비용(인덱스로 고른 행의 `status` 한 칸)은 1ms 보다 훨씬 작다. 넉넉히
    // 잡아 두면 위 부등식이 참인 것이 더 강한 말이 된다.
    expect(COUPON_EXPIRY_ROW_BUDGET_MS).toBeGreaterThan(0)
    expect(worstCaseExpiryCycleMs()).toBe(COUPON_EXPIRY_BATCH_LIMIT * COUPON_EXPIRY_ROW_BUDGET_MS)
  })

  it('stale 은 주기의 다섯 배다', () => {
    // 한 번 걸러 뛰는 것은 재시작이나 배포로도 일어난다. 다섯 번 연속이면 우연이
    // 아니고, 그것이 스위퍼·대사와 같은 배수를 쓰는 이유다.
    expect(COUPON_EXPIRY_STALE_AFTER_MS).toBe(5 * COUPON_EXPIRY_INTERVAL_MS)
  })
})

describe('멈춤 판정', () => {
  const now = new Date('2026-09-20T12:00:00.000Z')

  it('한 번도 안 돌았으면 멈춘 것으로 본다', () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없고, 둘 중 안전한
    // 해석은 멈췄다는 쪽이다 (`reservation-sweeper.ts` 의 `isStale` 과 같은 해석).
    expect(isCouponExpiryStale(null, now)).toBe(true)
  })

  it('임계치 안이면 멈춘 것이 아니다', () => {
    const at = new Date(now.getTime() - COUPON_EXPIRY_STALE_AFTER_MS)

    expect(isCouponExpiryStale(at, now)).toBe(false)
  })

  it('임계치를 넘으면 멈춘 것이다', () => {
    const at = new Date(now.getTime() - COUPON_EXPIRY_STALE_AFTER_MS - 1)

    expect(isCouponExpiryStale(at, now)).toBe(true)
  })
})

describe('락 열쇠', () => {
  it('스위퍼의 발급기에서 나온다', () => {
    // 세 번째 잡이 자기 해시를 따로 만들면 「두 기능이 우연히 같은 수를 고르지
    // 않는다」는 보증이 바로 깨진다.
    expect(COUPON_EXPIRY_LOCK_KEY).toBe(lockKeyOf('coupon.expiry'))
  })

  it('다른 잡과 다른 수다', () => {
    expect(COUPON_EXPIRY_LOCK_KEY).not.toBe(lockKeyOf('reservation.sweep'))
    expect(COUPON_EXPIRY_LOCK_KEY).not.toBe(lockKeyOf('payment.reconcile'))
  })
})

describe('로그 판단', () => {
  it('0장인 주기는 남기지 않는다', () => {
    // 만료는 캠페인이 끝나는 날에만 몰린다. 1분마다 「0장」을 쌓으면 정작 읽어야
    // 할 한 줄이 그 사이에 묻힌다.
    expect(worthLoggingExpiry(0)).toBe(false)
  })

  it('한 장이라도 옮겼으면 남긴다', () => {
    expect(worthLoggingExpiry(1)).toBe(true)
  })
})

describe('AppMeta 열쇠', () => {
  it('두 열쇠가 다르다', () => {
    // 같으면 마지막 실행 시각과 건수가 서로를 덮어쓰고, 헬스체크가 읽는 것은
    // 둘 중 나중에 쓴 값이 된다.
    expect(COUPON_EXPIRY_LAST_RUN_KEY).not.toBe(COUPON_EXPIRY_LAST_EXPIRED_KEY)
  })
})
