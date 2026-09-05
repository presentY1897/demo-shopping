import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  isStale,
  SWEEP_LAST_RELEASED_KEY,
  SWEEP_LAST_RUN_KEY,
} from '../reservation/reservation-sweeper.js'
import type { HealthIndicator } from './health-indicator.js'

/** `/health` 의 `reservationExpiry` 에서 상태를 뺀 나머지 — 시각과 건수 (F5). */
export interface ReservationExpiryDetails {
  readonly lastRunAt: string | null
  /** **마지막 한 번**이 푼 예약 수. 누계가 아니다. */
  readonly releasedCount: number
}

/** 지표가 목록에 없을 때의 답. 시각은 「모른다」, 건수는 「셀 수 없다」의 0 이다. */
const UNKNOWN: ReservationExpiryDetails = { lastRunAt: null, releasedCount: 0 }

/** `AppMeta` 두 행을 읽어 낸 그대로. 문자열이 아니라 뜻으로. */
interface SweepState {
  readonly lastRunAt: Date | null
  readonly releasedCount: number
}

const NOT_RECORDED: SweepState = { lastRunAt: null, releasedCount: 0 }

/**
 * 손으로 고친 행이 헬스체크를 데리고 넘어지면 안 된다.
 *
 * `AppMeta` 는 `key`/`value` 문자열 표라서 무엇이든 들어갈 수 있다. 날짜가 아닌
 * 값은 「기록이 없다」와 같게 다룬다 — 어느 쪽이든 이 숫자를 믿으면 안 된다는
 * 뜻이고, 읽는 쪽이 둘로 할 수 있는 일이 다르지 않다.
 */
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
 * 예약 만료 청소기가 아직 돌고 있는가 (TASK-0051 F5 · F6).
 *
 * **행을 읽지, 서비스를 읽지 않는다.** 청소기는 자기 실행을 `AppMeta` 에 적으므로
 * 그 답은 재시작을 넘겨 살아남고 어느 인스턴스에 물어도 같으며, `HealthModule` 이
 * `ReservationModule` 을 import 하지 않아도 된다 — API 가 살아 있는지 말하는
 * 엔드포인트를 재고를 쥐는 모듈에 묶지 않는 것이 요점이다. 여기까지는
 * `DemoCleanupReporter` 와 똑같고, 그 파일이 이 파일의 원본이다.
 *
 * **다른 점은 하나고, 그것이 이 파일이 따로 있는 이유다.** `DemoCleanupReporter`
 * 는 일부러 `HealthIndicator` 가 아니다 — 데모 청소가 안 돌아도 요청 하나 막히지
 * 않으니, 시각만 싣고 판단은 읽는 쪽에 맡긴다. 여기서는 반대다. 청소기가 멈추면
 * 잡아 둔 재고가 영영 풀리지 않고, 아무도 그것을 살 수 없으며, **아무것도 실패하지
 * 않는다.** 주문도 결제도 에러를 내지 않으니 이 침묵을 밖으로 꺼낼 자리가
 * 헬스체크밖에 없다. 그래서 이것은 지표이고, `degraded` 를 전체 판정까지 올린다.
 *
 * | 값 | 뜻 |
 * | --- | --- |
 * | `ok` | 마지막 실행이 `SWEEP_STALE_AFTER_MS` 안이다 |
 * | `degraded` | 그보다 오래 안 돌았거나, 한 번도 안 돌았거나, 행을 못 읽었다 |
 *
 * `down` 은 내지 않는다. 청소기는 API 가 말을 거는 외부 시스템이 아니라 API 자신의
 * 일이고, 그것이 밀린 것과 데이터베이스가 죽은 것은 보는 사람이 갈 곳이 다르다 —
 * 후자는 `database` 지표가 말한다.
 */
@Injectable()
export class ReservationExpiryHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'reservationExpiry'

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 멈췄으면 `degraded`.
   *
   * 판단은 {@link isStale} 이 한다 — 임계치와 「한 번도 안 돌았으면 stale」이라는
   * 해석은 청소기 쪽 순수 모듈이 쥐고 있고, 여기서 한 번 더 정하면 두 곳이 조용히
   * 어긋난다. 「지금」은 {@link Clock} 에서 받는다: 임계치와 정확히 같은 간격을
   * 재는 스펙은 시스템 시계로는 몇 밀리초 차이로 뒤집힌다.
   */
  async check(): Promise<HealthStatus> {
    const { lastRunAt } = await this.read()

    return isStale(lastRunAt, this.clock.now()) ? 'degraded' : 'ok'
  }

  /**
   * 상태 옆에 실릴 두 값. 상태는 지표 목록을 거쳐 오므로 여기서 내지 않는다.
   *
   * 그래서 한 번의 `/health` 가 이 표를 두 번 읽는다 — {@link check} 가 한 번,
   * 여기서 한 번. 지표의 계약이 상태 하나뿐이라 피할 수 없고, 둘 다 기본키 두 개를
   * 집는 조회라서 그대로 둔다. 캐시를 끼우면 「멈췄다」를 늦게 말하게 되는데, 그것은
   * 이 지표가 있는 이유를 깎는 거래다.
   */
  async details(): Promise<ReservationExpiryDetails> {
    const { lastRunAt, releasedCount } = await this.read()

    return { lastRunAt: lastRunAt?.toISOString() ?? null, releasedCount }
  }

  /**
   * 두 행을 한 번에.
   *
   * **던지지 않는다.** `demo-cleanup.reporter.ts` 가 남긴 교훈이고 그 파일에 자세히
   * 적혀 있다 — 곁다리 필드를 못 읽었다고 `/health` 가 500 을 내면 그것은 「프로세스가
   * 없다」로 읽히고, 그렇게 믿은 로드밸런서는 마지막 살아 있는 인스턴스로 가는
   * 트래픽을 끊는다.
   *
   * 못 읽었을 때가 「한 번도 안 돌았다」와 같은 값인 것은 게으름이 아니다. 둘 다
   * 「마지막 실행을 확인할 수 없다」이고, 재고가 잠겨 있을지 모르는 상태에서 안전한
   * 해석은 멈췄다는 쪽이다 — {@link isStale} 이 `null` 을 stale 로 보는 것과 같은
   * 이유다.
   */
  private async read(): Promise<SweepState> {
    try {
      const rows = await this.prisma.appMeta.findMany({
        where: { key: { in: [SWEEP_LAST_RUN_KEY, SWEEP_LAST_RELEASED_KEY] } },
        select: { key: true, value: true },
      })

      const byKey = new Map(rows.map((row) => [row.key, row.value]))

      return {
        lastRunAt: toDate(byKey.get(SWEEP_LAST_RUN_KEY)),
        releasedCount: toCount(byKey.get(SWEEP_LAST_RELEASED_KEY)),
      }
    } catch {
      return NOT_RECORDED
    }
  }
}

/**
 * 등록된 지표 중에서 이 지표를 찾아 시각과 건수를 받아 온다.
 *
 * `HealthService` 가 이 클래스를 따로 주입받지 않고 이미 가진 지표 목록에서 찾는
 * 것은, **배선이 한 곳에만 있게 하기 위해서다.** 상태는 목록을 돌며 나오고 나머지
 * 두 값은 여기서 나오므로, `health.module.ts` 의 배열에서 이것이 빠지면 상태가
 * `down` 으로 눈에 띄게 드러난다 — 주입을 따로 받았다면 배열에서 빠져도 숫자만
 * 조용히 맞고 판정은 틀리는, 이 TASK 가 없애려는 바로 그 종류의 침묵이 된다.
 */
export function reservationExpiryDetails(
  indicators: readonly HealthIndicator[],
): Promise<ReservationExpiryDetails> {
  const indicator = indicators.find(
    (candidate): candidate is ReservationExpiryHealthIndicator =>
      candidate instanceof ReservationExpiryHealthIndicator,
  )

  return indicator?.details() ?? Promise.resolve(UNKNOWN)
}
