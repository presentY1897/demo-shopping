import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  DELIVERY_LAST_ADVANCED_KEY,
  DELIVERY_LAST_RUN_KEY,
  isDeliveryStale,
} from '../shipping/delivery-simulator.js'
import type { HealthIndicator } from './health-indicator.js'

/** `/health` 의 `deliverySimulator` 에서 상태를 뺀 나머지 — 시각과 건수 (TASK-0062). */
export interface DeliverySimulatorDetails {
  readonly lastRunAt: string | null
  /** **마지막 한 번**이 다음 단계로 옮긴 배송의 수. 누계가 아니다. */
  readonly advancedCount: number
}

/** 지표가 목록에 없을 때의 답. 시각은 「모른다」, 건수는 「셀 수 없다」의 0 이다. */
const UNKNOWN: DeliverySimulatorDetails = { lastRunAt: null, advancedCount: 0 }

/** `AppMeta` 두 행을 읽어 낸 그대로. 문자열이 아니라 뜻으로. */
interface SimulatorState {
  readonly lastRunAt: Date | null
  readonly advancedCount: number
}

const NOT_RECORDED: SimulatorState = { lastRunAt: null, advancedCount: 0 }

/** 날짜가 아닌 값은 「기록이 없다」와 같게 다룬다 — 어느 쪽이든 믿으면 안 된다. */
function toDate(value: string | undefined): Date | null {
  if (value === undefined) return null

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** 같은 이유로, 셀 수 없는 값은 0 이다. 음수와 소수도 「셀 수 없는 값」이다. */
function toCount(value: string | undefined): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * 배송 시뮬레이터가 아직 돌고 있는가 (TASK-0062 F6 · F7).
 *
 * **이 잡이 멈추면 데모가 배송 중에서 끝난다.** 발송된 주문이 영영 `SHIPPED` 에
 * 머물고, 그 뒤에 있는 구매확정 · 정산 · 반품은 **열리지 않는다** — 방문자는 이
 * 저장소의 절반을 보지 못한다. 그런데 그 상태는 **아무 요청도 실패시키지
 * 않는다.** 주문 조회도 배송 조회도 200 을 답하고, 화면은 「배송중」이라고
 * 정직하게 말하며, 아무도 그 배송이 더 이상 움직이지 않는다는 것을 모른다. 그
 * 침묵을 밖으로 꺼낼 자리가 여기다.
 *
 * 그래서 `reservation-expiry` · `paymentReconcile` · `paymentStraggler` 의 세 지표와
 * **같은 모양이고 같은 이유**다. 행을 읽지 서비스를 읽지 않는 것 — 답이 재시작을
 * 넘겨 살아남고 어느 인스턴스에 물어도 같으며 `HealthModule` 이 `ShipmentModule` 을
 * 들여오지 않아도 된다 — 도, `degraded` 를 전체 판정까지 올리는 것도 그 파일들에
 * 적힌 그대로다.
 *
 * | 값 | 뜻 |
 * | --- | --- |
 * | `ok` | 마지막 실행이 `DELIVERY_STALE_AFTER_MS` 안이다 |
 * | `degraded` | 그보다 오래 안 돌았거나, 한 번도 안 돌았거나, 행을 못 읽었다 |
 *
 * `down` 은 내지 않는다. 시뮬레이터는 API 가 말을 거는 외부 시스템이 아니라 API
 * 자신의 일이고, 그것이 밀린 것과 데이터베이스가 죽은 것은 보는 사람이 갈 곳이
 * 다르다.
 */
@Injectable()
export class DeliverySimulatorHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'deliverySimulator'

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 멈췄으면 `degraded`.
   *
   * 임계치와 「한 번도 안 돌았으면 stale」이라는 해석은 시뮬레이터 쪽 순수 모듈이
   * 쥐고 있다({@link isDeliveryStale}). 「지금」을 {@link Clock} 에서 받는 이유는
   * 임계치와 정확히 같은 간격을 재는 스펙이 시스템 시계로는 몇 밀리초 차이로
   * 뒤집히기 때문이다.
   */
  async check(): Promise<HealthStatus> {
    const { lastRunAt } = await this.read()

    return isDeliveryStale(lastRunAt, this.clock.now()) ? 'degraded' : 'ok'
  }

  /** 상태 옆에 실릴 두 값. 상태는 지표 목록을 거쳐 오므로 여기서 내지 않는다. */
  async details(): Promise<DeliverySimulatorDetails> {
    const { lastRunAt, advancedCount } = await this.read()

    return { lastRunAt: lastRunAt?.toISOString() ?? null, advancedCount }
  }

  /**
   * 두 행을 한 번에. **던지지 않는다.**
   *
   * 곁다리 필드를 못 읽었다고 `/health` 가 500 을 내면 그것은 「프로세스가 없다」로
   * 읽히고, 그렇게 믿은 로드밸런서는 마지막 살아 있는 인스턴스로 가는 트래픽을
   * 끊는다 (`demo-cleanup.reporter.ts` 가 남긴 교훈이다).
   */
  private async read(): Promise<SimulatorState> {
    try {
      const rows = await this.prisma.appMeta.findMany({
        where: { key: { in: [DELIVERY_LAST_RUN_KEY, DELIVERY_LAST_ADVANCED_KEY] } },
        select: { key: true, value: true },
      })

      const byKey = new Map(rows.map((row) => [row.key, row.value]))

      return {
        lastRunAt: toDate(byKey.get(DELIVERY_LAST_RUN_KEY)),
        advancedCount: toCount(byKey.get(DELIVERY_LAST_ADVANCED_KEY)),
      }
    } catch {
      return NOT_RECORDED
    }
  }
}

/**
 * 등록된 지표 중에서 이 지표를 찾아 시각과 건수를 받아 온다.
 *
 * `HealthService` 가 이 클래스를 따로 주입받지 않는 이유는
 * `reservation-expiry.health-indicator.ts` 에 적혀 있다 — 배선이 한 곳에만 있어야
 * `health.module.ts` 의 배열에서 빠졌을 때 상태가 `down` 으로 **드러난다.**
 */
export function deliverySimulatorDetails(
  indicators: readonly HealthIndicator[],
): Promise<DeliverySimulatorDetails> {
  const indicator = indicators.find(
    (candidate): candidate is DeliverySimulatorHealthIndicator =>
      candidate instanceof DeliverySimulatorHealthIndicator,
  )

  return indicator?.details() ?? Promise.resolve(UNKNOWN)
}
