import type { SellerOrderHistoryEntry } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { AppConfig, FulfillmentPace } from '../config/app-config.js'
import { STRAGGLER_LOCK_KEY } from '../payment/payment-straggler.js'
import { RECONCILE_LOCK_KEY } from '../payment/payment-reconcile.js'
import { SWEEP_LOCK_KEY } from '../reservation/reservation-sweeper.js'
import {
  AUTO_CONFIRM_AFTER_MS,
  AUTO_CONFIRM_DEMO_AFTER_MS,
  autoConfirmAtOf,
  autoConfirmWindowMs,
  autoConfirmWindowMsOf,
  CONFIRM_BATCH_LIMIT,
  CONFIRM_INTERVAL_MS,
  CONFIRM_LOCK_KEY,
  CONFIRM_STALE_AFTER_MS,
  confirmableBefore,
  counted,
  isConfirmStale,
  NOTHING_CONFIRMED,
  worthLogging,
} from './order-confirm.js'

/**
 * 자동 구매확정의 순수 판단 (TASK-0064, Q5 강화).
 *
 * **여기가 틀리는 방식이 전부 조용하다.** 기간이 길면 배송이 끝난 주문이 확정되지
 * 않고 정산도 적립금도 시작되지 않는데 아무 요청도 실패하지 않는다. 기간이 짧으면
 * 반품을 생각하던 사람의 주문이 **되돌릴 수 없게** 확정된다. 압축 판단이 배송
 * 시뮬레이터와 갈리면 데모에서 배송은 6분인데 확정은 7일이 되어 흐름이 끊긴다.
 * 셋 다 빨간 검사가 아니라 나중에 주문 하나로 나타난다.
 */

const DAY_MS = 24 * 60 * 60 * 1_000
const NOW = new Date('2026-09-06T00:00:00.000Z')

/** 축이 되는 필드 하나만 든 설정. 나머지는 이 판단에 들어오지 않는다. */
function configWith(fulfillmentPace: FulfillmentPace): Pick<AppConfig, 'fulfillmentPace'> {
  return { fulfillmentPace }
}

describe('자동 확정 기간', () => {
  it('실제 서비스는 배송완료 7일이다', () => {
    expect(AUTO_CONFIRM_AFTER_MS).toBe(7 * DAY_MS)
  })

  it('데모는 5분으로 압축한다', () => {
    expect(AUTO_CONFIRM_DEMO_AFTER_MS).toBe(5 * 60_000)
  })

  it('압축된 기간이 주기보다 길다', () => {
    // 주기보다 짧으면 「5분 뒤 확정」이 실제로는 주기의 반올림이 되고, 데모를 보는
    // 사람은 압축이 동작하는지 알 수 없다.
    expect(AUTO_CONFIRM_DEMO_AFTER_MS).toBeGreaterThan(CONFIRM_INTERVAL_MS)
    expect(AUTO_CONFIRM_DEMO_AFTER_MS).toBeLessThan(AUTO_CONFIRM_AFTER_MS)
  })

  it('속도마다 다른 기간을 준다', () => {
    expect(autoConfirmWindowMs('realistic')).toBe(AUTO_CONFIRM_AFTER_MS)
    expect(autoConfirmWindowMs('demo')).toBe(AUTO_CONFIRM_DEMO_AFTER_MS)
  })
})

describe('압축 여부를 정하는 자리', () => {
  /**
   * **배송 시뮬레이터와 같은 축이다** (TASK-0062 · `FULFILLMENT_PACE`).
   *
   * 이 단언이 지키는 것은 값이 아니라 **축이 하나라는 사실**이다. 여기가 다른
   * 필드를 읽기 시작하면 「데모 모드」가 두 벌이 되고, 둘 중 하나만 켠 배포에서
   * 배송은 6분인데 확정은 7일이 된다 — 그리고 아무것도 실패하지 않는다.
   */
  it('배송 속도가 demo 면 확정도 압축된다', () => {
    expect(autoConfirmWindowMsOf(configWith('demo'))).toBe(AUTO_CONFIRM_DEMO_AFTER_MS)
  })

  it('배송 속도가 realistic 이면 확정도 실제 기간이다', () => {
    expect(autoConfirmWindowMsOf(configWith('realistic'))).toBe(AUTO_CONFIRM_AFTER_MS)
  })
})

describe('고를 몫의 경계', () => {
  it('지금에서 기간을 뺀 시각보다 앞선 것만 고른다', () => {
    expect(confirmableBefore(NOW, AUTO_CONFIRM_AFTER_MS)).toEqual(
      new Date('2026-08-30T00:00:00.000Z'),
    )
  })

  it('압축된 기간에서는 5분 전이 경계다', () => {
    expect(confirmableBefore(NOW, AUTO_CONFIRM_DEMO_AFTER_MS)).toEqual(
      new Date('2026-09-05T23:55:00.000Z'),
    )
  })

  it('한 주기가 가져가는 수에 상한이 있다', () => {
    // 상한이 없으면 밀린 날 한 주기가 몇 분을 쓰고, 헬스체크는 그것을 「멈췄다」로
    // 읽는다. 상한 × 한 건의 비용이 stale 임계치 안이어야 한다.
    expect(CONFIRM_BATCH_LIMIT).toBeGreaterThan(0)
    expect(CONFIRM_STALE_AFTER_MS).toBe(5 * CONFIRM_INTERVAL_MS)
  })
})

describe('화면에 말할 예정 시각', () => {
  const DELIVERED_AT = '2026-09-06T02:30:00.000Z'

  function entry(toStatus: SellerOrderHistoryEntry['toStatus'], occurredAt: string) {
    return {
      id: '019596d0-1f1c-7c2e-9a0e-6f0000000001',
      fromStatus: null,
      toStatus,
      actor: 'SYSTEM' as const,
      reason: null,
      occurredAt,
    }
  }

  const history = [entry('SHIPPED', '2026-09-05T08:00:00.000Z'), entry('DELIVERED', DELIVERED_AT)]

  it('배송완료 시각에 기간을 더한다', () => {
    expect(autoConfirmAtOf('DELIVERED', history, AUTO_CONFIRM_AFTER_MS)).toBe(
      '2026-09-13T02:30:00.000Z',
    )
  })

  it('압축된 배포에서는 같은 이력이 5분 뒤를 가리킨다', () => {
    // **이 값이 화면에 그대로 나간다.** 화면이 직접 더하면 여기서 갈리고, 갈린
    // 화면은 「7일 뒤」라고 적어 놓고 5분 뒤에 확정한다.
    expect(autoConfirmAtOf('DELIVERED', history, AUTO_CONFIRM_DEMO_AFTER_MS)).toBe(
      '2026-09-06T02:35:00.000Z',
    )
  })

  it('배송완료가 아닌 몫에는 예정이 없다', () => {
    expect(autoConfirmAtOf('SHIPPED', history, AUTO_CONFIRM_AFTER_MS)).toBeNull()
    // 이미 확정된 몫도 마찬가지다. 지나간 예정을 말하면 화면이 스스로와 모순된다.
    expect(autoConfirmAtOf('CONFIRMED', history, AUTO_CONFIRM_AFTER_MS)).toBeNull()
  })

  it('배송완료 줄이 없으면 날짜를 지어내지 않는다', () => {
    expect(autoConfirmAtOf('DELIVERED', [], AUTO_CONFIRM_AFTER_MS)).toBeNull()
  })
})

describe('한 주기를 세는 법', () => {
  it('아무것도 만나지 않은 주기는 전부 0 이다', () => {
    expect(NOTHING_CONFIRMED).toEqual({ confirmed: 0, noop: 0, failed: 0 })
  })

  it('만난 것만 하나씩 는다', () => {
    const tally = counted(counted(counted(NOTHING_CONFIRMED, 'confirmed'), 'noop'), 'failed')

    expect(tally).toEqual({ confirmed: 1, noop: 1, failed: 1 })
  })

  it('확정이 있었으면 로그로 남긴다', () => {
    expect(worthLogging(counted(NOTHING_CONFIRMED, 'confirmed'))).toBe(true)
  })

  it('실패가 있었으면 로그로 남긴다', () => {
    expect(worthLogging(counted(NOTHING_CONFIRMED, 'failed'))).toBe(true)
  })

  it('이미 확정돼 있던 것만 만난 주기는 남기지 않는다', () => {
    // 멱등이 동작했다는 뜻이라 배치가 고칠 것이 없다. 1분마다 「0건」을 쌓으면
    // 정작 읽어야 할 줄이 그 사이에 묻힌다.
    expect(worthLogging(counted(NOTHING_CONFIRMED, 'noop'))).toBe(false)
    expect(worthLogging(NOTHING_CONFIRMED)).toBe(false)
  })
})

describe('멈췄는가', () => {
  it('한 번도 안 돌았으면 멈춘 것으로 친다', () => {
    expect(isConfirmStale(null, NOW)).toBe(true)
  })

  it('임계치 안이면 정상이다', () => {
    expect(isConfirmStale(new Date(NOW.getTime() - CONFIRM_STALE_AFTER_MS), NOW)).toBe(false)
  })

  it('임계치를 넘으면 degraded 다', () => {
    expect(isConfirmStale(new Date(NOW.getTime() - CONFIRM_STALE_AFTER_MS - 1), NOW)).toBe(true)
  })
})

describe('어드바이저리 락 열쇠', () => {
  /**
   * 두 잡이 같은 수를 고르면 하나가 **영문 모른 채 건너뛴다** — 증상은 「가끔 안
   * 돈다」이고, 그 로그를 보고 원인을 찾기는 어렵다. `lockKeyOf` 가 있는 이유가
   * 그것이므로, 실제로 갈리는지는 재 봐야 안다.
   */
  it('다른 주기 작업들과 겹치지 않는다', () => {
    const keys = [CONFIRM_LOCK_KEY, SWEEP_LOCK_KEY, RECONCILE_LOCK_KEY, STRAGGLER_LOCK_KEY]

    expect(new Set(keys).size).toBe(keys.length)
  })
})
