import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import {
  isStragglerStale,
  STRAGGLER_LAST_FIXED_KEY,
  STRAGGLER_LAST_RUN_KEY,
} from '../payment/payment-straggler.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { HealthIndicator } from './health-indicator.js'

/** `/health` 의 `paymentStraggler` 에서 상태를 뺀 나머지 — 시각과 건수 (TASK-0057). */
export interface PaymentStragglerDetails {
  readonly lastRunAt: string | null
  /** **마지막 한 번**이 끝낸 결제의 수. 누계가 아니다. */
  readonly fixedCount: number
}

/** 지표가 목록에 없을 때의 답. 시각은 「모른다」, 건수는 「셀 수 없다」의 0 이다. */
const UNKNOWN: PaymentStragglerDetails = { lastRunAt: null, fixedCount: 0 }

/** `AppMeta` 두 행을 읽어 낸 그대로. 문자열이 아니라 뜻으로. */
interface StragglerState {
  readonly lastRunAt: Date | null
  readonly fixedCount: number
}

const NOT_RECORDED: StragglerState = { lastRunAt: null, fixedCount: 0 }

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
 * 낙오된 결제 배치가 아직 돌고 있는가 (TASK-0057 F2 · F6 · D-221).
 *
 * **이 잡이 멈추면 두 종류의 사람이 조용히 갇힌다.**
 *
 * | 방향 | 멈추면 | 그래도 |
 * | --- | --- | --- |
 * | **앞으로** | 돈을 낸 사람의 주문이 영원히 「결제 대기」다 | 아무 요청도 실패하지 않는다 |
 * | **뒤로** | 승인만 남은 결제가 그 사람의 카드 한도를 영영 물고 있다 | 〃 |
 *
 * 앞쪽이 더 나쁘다 — 돈은 이미 우리 쪽으로 왔는데 물건이 안 움직인다. 그런데
 * 주문도 결제도 200 을 답하고, 화면은 「결제 대기」라고 정직하게 말하며, 아무도
 * 그 대기가 끝나지 않는다는 것을 모른다. 그 침묵을 밖으로 꺼낼 자리가 여기다.
 *
 * `reservation-expiry.health-indicator.ts` · `payment-reconcile.health-indicator.ts`
 * 와 **같은 모양이고 같은 이유**다. 행을 읽지 서비스를 읽지 않는 것 — 답이
 * 재시작을 넘겨 살아남고 어느 인스턴스에 물어도 같으며 `HealthModule` 이
 * `PaymentModule` 을 들여오지 않아도 된다 — 도, `degraded` 를 전체 판정까지
 * 올리는 것도 그 파일들에 적힌 그대로다.
 *
 * | 값 | 뜻 |
 * | --- | --- |
 * | `ok` | 마지막 실행이 `STRAGGLER_STALE_AFTER_MS` 안이다 |
 * | `degraded` | 그보다 오래 안 돌았거나, 한 번도 안 돌았거나, 행을 못 읽었다 |
 *
 * `down` 은 내지 않는다. 이 배치는 API 가 말을 거는 외부 시스템이 아니라 API
 * 자신의 일이고, 그것이 밀린 것과 데이터베이스가 죽은 것은 보는 사람이 갈 곳이
 * 다르다.
 */
@Injectable()
export class PaymentStragglerHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'paymentStraggler'

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 멈췄으면 `degraded`.
   *
   * 임계치와 「한 번도 안 돌았으면 stale」이라는 해석은 배치 쪽 순수 모듈이
   * 쥐고 있다({@link isStragglerStale}). 「지금」을 {@link Clock} 에서 받는 이유는
   * 임계치와 정확히 같은 간격을 재는 스펙이 시스템 시계로는 몇 밀리초 차이로
   * 뒤집히기 때문이다.
   */
  async check(): Promise<HealthStatus> {
    const { lastRunAt } = await this.read()

    return isStragglerStale(lastRunAt, this.clock.now()) ? 'degraded' : 'ok'
  }

  /** 상태 옆에 실릴 두 값. 상태는 지표 목록을 거쳐 오므로 여기서 내지 않는다. */
  async details(): Promise<PaymentStragglerDetails> {
    const { lastRunAt, fixedCount } = await this.read()

    return { lastRunAt: lastRunAt?.toISOString() ?? null, fixedCount }
  }

  /**
   * 두 행을 한 번에. **던지지 않는다.**
   *
   * 곁다리 필드를 못 읽었다고 `/health` 가 500 을 내면 그것은 「프로세스가 없다」로
   * 읽히고, 그렇게 믿은 로드밸런서는 마지막 살아 있는 인스턴스로 가는 트래픽을
   * 끊는다 (`demo-cleanup.reporter.ts` 가 남긴 교훈이다).
   */
  private async read(): Promise<StragglerState> {
    try {
      const rows = await this.prisma.appMeta.findMany({
        where: { key: { in: [STRAGGLER_LAST_RUN_KEY, STRAGGLER_LAST_FIXED_KEY] } },
        select: { key: true, value: true },
      })

      const byKey = new Map(rows.map((row) => [row.key, row.value]))

      return {
        lastRunAt: toDate(byKey.get(STRAGGLER_LAST_RUN_KEY)),
        fixedCount: toCount(byKey.get(STRAGGLER_LAST_FIXED_KEY)),
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
export function paymentStragglerDetails(
  indicators: readonly HealthIndicator[],
): Promise<PaymentStragglerDetails> {
  const indicator = indicators.find(
    (candidate): candidate is PaymentStragglerHealthIndicator =>
      candidate instanceof PaymentStragglerHealthIndicator,
  )

  return indicator?.details() ?? Promise.resolve(UNKNOWN)
}
