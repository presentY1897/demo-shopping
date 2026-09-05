/**
 * 멈춘 시뮬레이터가 `/health` 에서 보이는가 (TASK-0062 F6).
 *
 * 이 지표가 틀리는 방식은 하나뿐이고 그것이 최악이다 — **`ok` 라고 말하는 것.**
 * 시뮬레이터가 멈춰도 주문 조회도 배송 조회도 에러를 내지 않으므로, 이 지표가
 * 조용하면 「발송된 주문이 영영 배송 중」인 상태를 알아챌 자리가 저장소 어디에도
 * 남지 않는다. 그래서 아래 케이스는 대부분 「이럴 때 `ok` 가 아니어야 한다」를 재는
 * 것이고, 구조는 `reservation-expiry.health-indicator.spec.ts` 와 같다.
 */

import { describe, expect, it } from 'vitest'

import type { Clock } from '../common/clock.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import {
  DELIVERY_INTERVAL_MS,
  DELIVERY_LAST_ADVANCED_KEY,
  DELIVERY_LAST_RUN_KEY,
  DELIVERY_STALE_AFTER_MS,
} from '../shipping/delivery-simulator.js'
import {
  DeliverySimulatorHealthIndicator,
  deliverySimulatorDetails,
} from './delivery-simulator.health-indicator.js'
import type { HealthIndicator } from './health-indicator.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

/**
 * 고정된 「지금」.
 *
 * 경계 케이스는 임계치와 **정확히** 같은 간격을 재므로, 시스템 시계로는 행을
 * 만드는 순간과 판정하는 순간 사이에 흐른 몇 밀리초가 그대로 결과를 뒤집는다.
 */
const CLOCK: Clock = { now: () => NOW }

interface MetaRow {
  readonly key: string
  readonly value: string
}

/** `NOW` 에서 `ms` 만큼 이전의 ISO 문자열 — 배치가 행에 적는 모양 그대로. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

/** `AppMeta` 를 흉내 낸 지표. 실제 표처럼 키가 아예 없을 수도 있다. */
function indicatorWith(rows: readonly MetaRow[]): DeliverySimulatorHealthIndicator {
  return new DeliverySimulatorHealthIndicator(
    { appMeta: { findMany: () => Promise.resolve([...rows]) } } as unknown as PrismaService,
    CLOCK,
  )
}

/** 마지막 실행만 적힌 표. 건수를 신경 쓰지 않는 케이스가 쓴다. */
function ranAt(value: string): DeliverySimulatorHealthIndicator {
  return indicatorWith([{ key: DELIVERY_LAST_RUN_KEY, value }])
}

/** 데이터베이스가 닿지 않는 지표. */
function unreachable(): DeliverySimulatorHealthIndicator {
  return new DeliverySimulatorHealthIndicator(
    {
      appMeta: { findMany: () => Promise.reject(new Error('connection refused')) },
    } as unknown as PrismaService,
    CLOCK,
  )
}

describe('멈췄는가', () => {
  it('reports degraded before the simulator has ever run', async () => {
    // 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서 구분할 방법이 없고, 발송된 주문이
    // 멈춰 있을지 모르는 상태에서 안전한 해석은 멈췄다는 쪽이다.
    expect(await indicatorWith([]).check()).toBe('degraded')
  })

  it('reports ok while it is keeping up', async () => {
    expect(await ranAt(ago(DELIVERY_INTERVAL_MS)).check()).toBe('ok')
  })

  it('tolerates exactly the threshold, and nothing past it', async () => {
    // 경계다. 「이상」으로 잡으면 정확히 그 순간에 도는 정상 주기가 알람이 된다.
    expect(await ranAt(ago(DELIVERY_STALE_AFTER_MS)).check()).toBe('ok')
    expect(await ranAt(ago(DELIVERY_STALE_AFTER_MS + 1)).check()).toBe('degraded')
  })

  it('answers degraded, never down, when the row cannot be read', async () => {
    // 시뮬레이터가 밀린 것과 데이터베이스가 죽은 것은 보는 사람이 갈 곳이 다르다.
    // 후자는 `database` 지표가 말한다.
    expect(await unreachable().check()).toBe('degraded')
  })
})

describe('행을 그대로 믿지 않는다', () => {
  it('does not throw when the stored instant is not a date', async () => {
    // `AppMeta` 는 문자열 표라서 무엇이든 들어갈 수 있다. 손으로 고친 행이
    // `/health` 를 500 으로 만들면 그것은 「프로세스가 없다」로 읽힌다.
    const indicator = ranAt('어제쯤')

    expect(await indicator.check()).toBe('degraded')
    expect(await indicator.details()).toEqual({ lastRunAt: null, advancedCount: 0 })
  })

  it('does not throw when the stored count is not a number', async () => {
    const indicator = indicatorWith([
      { key: DELIVERY_LAST_RUN_KEY, value: ago(DELIVERY_INTERVAL_MS) },
      { key: DELIVERY_LAST_ADVANCED_KEY, value: '몇 건쯤' },
    ])

    // 셀 수 없는 건수가 읽을 수 있는 시각까지 못 쓰게 만들지는 않는다.
    expect(await indicator.check()).toBe('ok')
    expect((await indicator.details()).advancedCount).toBe(0)
  })

  it('does not take a negative or fractional count at face value', async () => {
    for (const value of ['-3', '1.5']) {
      const details = await indicatorWith([{ key: DELIVERY_LAST_ADVANCED_KEY, value }]).details()

      expect(details.advancedCount).toBe(0)
    }
  })

  it('says it knows nothing rather than throwing when the database is unreachable', async () => {
    await expect(unreachable().details()).resolves.toEqual({ lastRunAt: null, advancedCount: 0 })
  })
})

describe('무엇을 싣는가', () => {
  it('carries the last run and how many it moved', async () => {
    const at = ago(DELIVERY_INTERVAL_MS)
    const indicator = indicatorWith([
      { key: DELIVERY_LAST_RUN_KEY, value: at },
      { key: DELIVERY_LAST_ADVANCED_KEY, value: '4' },
    ])

    expect(await indicator.details()).toEqual({ lastRunAt: at, advancedCount: 4 })
  })

  it('reads the two keys the simulator writes', async () => {
    // 두 모듈에 나뉜 상수가 어긋나면 이 지표는 영원히 degraded 를 말하고, 아무도
    // 그것을 배선 실수라고 읽지 않는다 — 「시뮬레이터가 멈췄나 보다」로 읽는다.
    let asked: readonly string[] = []
    const indicator = new DeliverySimulatorHealthIndicator(
      {
        appMeta: {
          findMany: (query: { where: { key: { in: string[] } } }) => {
            asked = query.where.key.in

            return Promise.resolve([])
          },
        },
      } as unknown as PrismaService,
      CLOCK,
    )

    await indicator.details()

    expect([...asked].sort()).toEqual([DELIVERY_LAST_ADVANCED_KEY, DELIVERY_LAST_RUN_KEY].sort())
  })

  it('answers under the key the response field is named after', () => {
    expect(indicatorWith([]).key).toBe('deliverySimulator')
  })
})

describe('지표 목록에서 찾아 오기', () => {
  it('takes the details from the registered indicator', async () => {
    const indicator = indicatorWith([
      { key: DELIVERY_LAST_RUN_KEY, value: ago(0) },
      { key: DELIVERY_LAST_ADVANCED_KEY, value: '2' },
    ])

    await expect(deliverySimulatorDetails([indicator])).resolves.toEqual({
      lastRunAt: NOW.toISOString(),
      advancedCount: 2,
    })
  })

  it('ignores the other indicators rather than mistaking one for it', async () => {
    const other: HealthIndicator = { key: 'database', check: () => Promise.resolve('ok') }

    await expect(deliverySimulatorDetails([other])).resolves.toEqual({
      lastRunAt: null,
      advancedCount: 0,
    })
  })

  it('says it knows nothing when the indicator was never registered', async () => {
    // 배선이 빠진 것은 조용히 지나가지 않는다: 여기서 시각이 비고, 상태는
    // `HealthService` 가 미등록 의존성에 주는 `down` 이 된다.
    await expect(deliverySimulatorDetails([])).resolves.toEqual({
      lastRunAt: null,
      advancedCount: 0,
    })
  })
})
