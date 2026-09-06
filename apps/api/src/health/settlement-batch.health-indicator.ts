import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  isSettlementStale,
  SETTLEMENT_LAST_RUN_KEY,
  SETTLEMENT_LAST_SETTLED_KEY,
} from '../settlement/settlement-batch.js'
import type { HealthIndicator } from './health-indicator.js'

/** `/health` 의 `settlementBatch` 에서 상태를 뺀 나머지 (TASK-0080). */
export interface SettlementBatchDetails {
  readonly lastRunAt: string | null
  /** **마지막 한 번**이 적은 정산 줄의 수. 누계가 아니다. */
  readonly settledCount: number
}

/** 지표가 목록에 없을 때의 답. */
const UNKNOWN: SettlementBatchDetails = { lastRunAt: null, settledCount: 0 }

interface BatchState {
  readonly lastRunAt: Date | null
  readonly settledCount: number
}

const NOT_RECORDED: BatchState = { lastRunAt: null, settledCount: 0 }

/** 손으로 고친 행이 헬스체크를 데리고 넘어지면 안 된다. */
function toDate(value: string | undefined): Date | null {
  if (value === undefined) return null

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** 같은 이유로, 셀 수 없는 값은 0 이다. */
function toCount(value: string | undefined): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * 정산 배치가 아직 돌고 있는가 (TASK-0080 6장).
 *
 * **이 잡이 멈추면 판매자가 돈을 못 받는다.** 그리고 아무것도 실패하지 않는다 —
 * 주문도 배송도 구매확정도 멀쩡히 돌아가고, 판매자 화면에는 「정산 예정」이 정직하게
 * 떠 있을 뿐이다. 판매자가 「이번 주 정산이 왜 없죠」라고 물어보기 전까지 아무도
 * 모르고, 그때는 이미 한 주가 지나 있다. 그 침묵을 밖으로 꺼낼 자리가 헬스체크다.
 *
 * 구조는 `order-confirm.health-indicator.ts` 와 같고 그 파일이 원본이다 — **행을
 * 읽지, 서비스를 읽지 않는다.**
 *
 * | 값 | 뜻 |
 * | --- | --- |
 * | `ok` | 마지막 실행이 `SETTLEMENT_STALE_AFTER_MS` 안이다 |
 * | `degraded` | 그보다 오래 안 돌았거나, 한 번도 안 돌았거나, 행을 못 읽었다 |
 */
@Injectable()
export class SettlementBatchHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'settlementBatch'

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(): Promise<HealthStatus> {
    const { lastRunAt } = await this.read()

    return isSettlementStale(lastRunAt, this.clock.now()) ? 'degraded' : 'ok'
  }

  async details(): Promise<SettlementBatchDetails> {
    const { lastRunAt, settledCount } = await this.read()

    return { lastRunAt: lastRunAt?.toISOString() ?? null, settledCount }
  }

  /** 두 행을 한 번에. **던지지 않는다** (`order-confirm.health-indicator.ts`). */
  private async read(): Promise<BatchState> {
    try {
      const rows = await this.prisma.appMeta.findMany({
        where: { key: { in: [SETTLEMENT_LAST_RUN_KEY, SETTLEMENT_LAST_SETTLED_KEY] } },
        select: { key: true, value: true },
      })
      const byKey = new Map(rows.map((row) => [row.key, row.value]))

      return {
        lastRunAt: toDate(byKey.get(SETTLEMENT_LAST_RUN_KEY)),
        settledCount: toCount(byKey.get(SETTLEMENT_LAST_SETTLED_KEY)),
      }
    } catch {
      return NOT_RECORDED
    }
  }
}

/** 등록된 지표 중에서 이 지표를 찾아 시각과 건수를 받아 온다. */
export function settlementBatchDetails(
  indicators: readonly HealthIndicator[],
): Promise<SettlementBatchDetails> {
  const indicator = indicators.find(
    (candidate): candidate is SettlementBatchHealthIndicator =>
      candidate instanceof SettlementBatchHealthIndicator,
  )

  return indicator?.details() ?? Promise.resolve(UNKNOWN)
}
