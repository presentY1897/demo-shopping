import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import {
  CLAIM_REFUND_LAST_FIXED_KEY,
  CLAIM_REFUND_LAST_RUN_KEY,
  isClaimRefundStale,
} from '../claims/refund-retry.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { HealthIndicator } from './health-indicator.js'

/** `/health` 의 `claimRefund` 에서 상태를 뺀 나머지 — 시각과 건수 (TASK-0071). */
export interface ClaimRefundDetails {
  readonly lastRunAt: string | null
  /** **마지막 한 번**이 내보낸 환불의 수. 누계가 아니다. */
  readonly fixedCount: number
}

/** 지표가 목록에 없을 때의 답. 시각은 「모른다」, 건수는 「셀 수 없다」의 0 이다. */
const UNKNOWN: ClaimRefundDetails = { lastRunAt: null, fixedCount: 0 }

/** `AppMeta` 두 행을 읽어 낸 그대로. 문자열이 아니라 뜻으로. */
interface RefundRetryState {
  readonly lastRunAt: Date | null
  readonly fixedCount: number
}

const NOT_RECORDED: RefundRetryState = { lastRunAt: null, fixedCount: 0 }

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
 * 환불 재시도 배치가 아직 돌고 있는가 (TASK-0071 · 배치는 TASK-0068 F8 · R3).
 *
 * **이 잡이 멈추면 돈이 안 돌아간 채 아무것도 실패하지 않는다.** 승인된 취소가
 * `CANCEL_APPROVED` 로, 검수를 통과한 반품이 `RETURN_COMPLETED` 로 앉아 있을 뿐이고,
 * 그 두 상태는 정상 흐름에서도 잠깐 지나는 자리라 목록만 봐서는 구분되지 않는다.
 * 클레임 조회도 주문 조회도 200 을 답하고 화면은 「환불 처리 중」이라고 정직하게
 * 말하며, 구매자에게는 「돈이 안 들어온다」로만 보인다 — 그때 그 사람이 할 수 있는
 * 일은 문의뿐이다. 그 침묵을 밖으로 꺼낼 자리가 여기다.
 *
 * `payment-straggler.health-indicator.ts` · `payment-reconcile.health-indicator.ts`
 * 와 **같은 모양이고 같은 이유**다. 행을 읽지 서비스를 읽지 않는 것 — 답이 재시작을
 * 넘겨 살아남고 어느 인스턴스에 물어도 같으며 `HealthModule` 이 `ClaimModule` 을
 * 들여오지 않아도 된다 — 도, `degraded` 를 전체 판정까지 올리는 것도 그 파일들에
 * 적힌 그대로다.
 *
 * | 값 | 뜻 |
 * | --- | --- |
 * | `ok` | 마지막 실행이 `CLAIM_REFUND_STALE_AFTER_MS` 안이다 |
 * | `degraded` | 그보다 오래 안 돌았거나, 한 번도 안 돌았거나, 행을 못 읽었다 |
 *
 * `down` 은 내지 않는다. 이 배치는 API 가 말을 거는 외부 시스템이 아니라 API 자신의
 * 일이고, 그것이 밀린 것과 데이터베이스가 죽은 것은 보는 사람이 갈 곳이 다르다.
 * 결제사가 죽어서 환불이 안 나가는 것도 여기서 `down` 이 아니다 — 그때도 배치는
 * 제때 돌고 있고, 계속 실패하는 건은 `ClaimRefund.attempts` 와 `lastError` 에 쌓인다.
 */
@Injectable()
export class ClaimRefundHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'claimRefund'

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 멈췄으면 `degraded`.
   *
   * 임계치와 「한 번도 안 돌았으면 stale」이라는 해석은 배치 쪽 순수 모듈이 쥐고
   * 있다({@link isClaimRefundStale}). 「지금」을 {@link Clock} 에서 받는 이유는
   * 임계치와 정확히 같은 간격을 재는 스펙이 시스템 시계로는 몇 밀리초 차이로
   * 뒤집히기 때문이다.
   */
  async check(): Promise<HealthStatus> {
    const { lastRunAt } = await this.read()

    return isClaimRefundStale(lastRunAt, this.clock.now()) ? 'degraded' : 'ok'
  }

  /** 상태 옆에 실릴 두 값. 상태는 지표 목록을 거쳐 오므로 여기서 내지 않는다. */
  async details(): Promise<ClaimRefundDetails> {
    const { lastRunAt, fixedCount } = await this.read()

    return { lastRunAt: lastRunAt?.toISOString() ?? null, fixedCount }
  }

  /**
   * 두 행을 한 번에. **던지지 않는다.**
   *
   * 곁다리 필드를 못 읽었다고 `/health` 가 500 을 내면 그것은 「프로세스가 없다」로
   * 읽히고, 그렇게 믿은 로드밸런서는 마지막 살아 있는 인스턴스로 가는 트래픽을
   * 끊는다 (`demo-cleanup.reporter.ts` 가 남긴 교훈이다).
   *
   * `ClaimRefundRetryService` 에도 같은 두 값을 읽는 `lastRunAt()` · `lastFixed()`
   * 가 있지만 그쪽을 주입받지 않는다. 서비스를 들여오면 `HealthModule` 이
   * `ClaimModule` 을 끌고 오고, 그 서비스가 쥔 타이머까지 함께 온다 — 지표 하나가
   * 배치를 한 벌 더 띄우는 일이 된다.
   */
  private async read(): Promise<RefundRetryState> {
    try {
      const rows = await this.prisma.appMeta.findMany({
        where: { key: { in: [CLAIM_REFUND_LAST_RUN_KEY, CLAIM_REFUND_LAST_FIXED_KEY] } },
        select: { key: true, value: true },
      })

      const byKey = new Map(rows.map((row) => [row.key, row.value]))

      return {
        lastRunAt: toDate(byKey.get(CLAIM_REFUND_LAST_RUN_KEY)),
        fixedCount: toCount(byKey.get(CLAIM_REFUND_LAST_FIXED_KEY)),
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
export function claimRefundDetails(
  indicators: readonly HealthIndicator[],
): Promise<ClaimRefundDetails> {
  const indicator = indicators.find(
    (candidate): candidate is ClaimRefundHealthIndicator =>
      candidate instanceof ClaimRefundHealthIndicator,
  )

  return indicator?.details() ?? Promise.resolve(UNKNOWN)
}
