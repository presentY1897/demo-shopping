import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import {
  CONFIRM_LAST_CONFIRMED_KEY,
  CONFIRM_LAST_RUN_KEY,
  isConfirmStale,
} from '../orders/order-confirm.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { HealthIndicator } from './health-indicator.js'

/** `/health` 의 `orderConfirm` 에서 상태를 뺀 나머지 — 시각과 건수 (TASK-0064). */
export interface OrderConfirmDetails {
  readonly lastRunAt: string | null
  /** **마지막 한 번**이 자동 확정한 몫의 수. 누계가 아니다. */
  readonly confirmedCount: number
}

/** 지표가 목록에 없을 때의 답. 시각은 「모른다」, 건수는 「셀 수 없다」의 0 이다. */
const UNKNOWN: OrderConfirmDetails = { lastRunAt: null, confirmedCount: 0 }

/** `AppMeta` 두 행을 읽어 낸 그대로. 문자열이 아니라 뜻으로. */
interface ConfirmState {
  readonly lastRunAt: Date | null
  readonly confirmedCount: number
}

const NOT_RECORDED: ConfirmState = { lastRunAt: null, confirmedCount: 0 }

/** 손으로 고친 행이 헬스체크를 데리고 넘어지면 안 된다 (`reservation-expiry` 와 같다). */
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
 * 자동 구매확정 스케줄러가 아직 돌고 있는가 (TASK-0064 F2 · 6장).
 *
 * **이 잡이 멈추면 배송이 끝난 주문이 확정되지 않는다.** 구매확정은 정산(M12)과
 * 적립금(M11)의 방아쇠이므로, 멈춘 동안 판매자는 이미 배송을 마친 물건의 돈을 받지
 * 못하고 구매자의 적립금도 들어오지 않는다. 그런데 **아무 요청도 실패하지 않는다** —
 * 주문 화면에는 「배송완료」가 정직하게 떠 있고, 구매자가 직접 확정 버튼을 누르면 그
 * 길은 멀쩡히 동작한다. 즉 아무도 신고하지 않는 고장이고, 그 침묵을 밖으로 꺼낼
 * 자리가 헬스체크다.
 *
 * 구조는 `reservation-expiry.health-indicator.ts` 와 같고 그 파일이 원본이다 —
 * **행을 읽지, 서비스를 읽지 않는다.** 스케줄러가 자기 실행을 `AppMeta` 에 적으므로
 * 그 답은 재시작을 넘겨 살아남고 어느 인스턴스에 물어도 같으며, `HealthModule` 이
 * `SellerOrderModule` 을 import 하지 않아도 된다.
 *
 * | 값 | 뜻 |
 * | --- | --- |
 * | `ok` | 마지막 실행이 `CONFIRM_STALE_AFTER_MS` 안이다 |
 * | `degraded` | 그보다 오래 안 돌았거나, 한 번도 안 돌았거나, 행을 못 읽었다 |
 *
 * `down` 은 내지 않는다. 이 잡은 API 가 말을 거는 외부 시스템이 아니라 API 자신의
 * 일이고, 그것이 밀린 것과 데이터베이스가 죽은 것은 보는 사람이 갈 곳이 다르다.
 */
@Injectable()
export class OrderConfirmHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'orderConfirm'

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 멈췄으면 `degraded`.
   *
   * 판단은 {@link isConfirmStale} 이 한다 — 임계치와 「한 번도 안 돌았으면 stale」
   * 이라는 해석은 `orders/order-confirm.ts` 가 쥐고 있고, 여기서 한 번 더 정하면 두
   * 곳이 조용히 어긋난다. 「지금」은 {@link Clock} 에서 받는다: 임계치와 정확히 같은
   * 간격을 재는 스펙은 시스템 시계로는 몇 밀리초 차이로 뒤집힌다.
   */
  async check(): Promise<HealthStatus> {
    const { lastRunAt } = await this.read()

    return isConfirmStale(lastRunAt, this.clock.now()) ? 'degraded' : 'ok'
  }

  /** 상태 옆에 실릴 두 값. 상태는 지표 목록을 거쳐 오므로 여기서 내지 않는다. */
  async details(): Promise<OrderConfirmDetails> {
    const { lastRunAt, confirmedCount } = await this.read()

    return { lastRunAt: lastRunAt?.toISOString() ?? null, confirmedCount }
  }

  /**
   * 두 행을 한 번에. **던지지 않는다.**
   *
   * 곁다리 필드를 못 읽었다고 `/health` 가 500 을 내면 그것은 「프로세스가 없다」로
   * 읽히고, 그렇게 믿은 로드밸런서는 마지막 살아 있는 인스턴스로 가는 트래픽을
   * 끊는다 (`demo-cleanup.reporter.ts` 가 남긴 교훈).
   */
  private async read(): Promise<ConfirmState> {
    try {
      const rows = await this.prisma.appMeta.findMany({
        where: { key: { in: [CONFIRM_LAST_RUN_KEY, CONFIRM_LAST_CONFIRMED_KEY] } },
        select: { key: true, value: true },
      })

      const byKey = new Map(rows.map((row) => [row.key, row.value]))

      return {
        lastRunAt: toDate(byKey.get(CONFIRM_LAST_RUN_KEY)),
        confirmedCount: toCount(byKey.get(CONFIRM_LAST_CONFIRMED_KEY)),
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
 * 것은 **배선이 한 곳에만 있게 하기 위해서다** — `health.module.ts` 의 배열에서
 * 이것이 빠지면 상태가 `down` 으로 눈에 띄게 드러난다. 자세한 이유는
 * `reservation-expiry.health-indicator.ts` 의 같은 함수에 적혀 있다.
 */
export function orderConfirmDetails(
  indicators: readonly HealthIndicator[],
): Promise<OrderConfirmDetails> {
  const indicator = indicators.find(
    (candidate): candidate is OrderConfirmHealthIndicator =>
      candidate instanceof OrderConfirmHealthIndicator,
  )

  return indicator?.details() ?? Promise.resolve(UNKNOWN)
}
