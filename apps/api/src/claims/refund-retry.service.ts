import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { RefundTally } from './refund-retry.js'
import {
  CLAIM_REFUND_INTERVAL_MS,
  CLAIM_REFUND_LAST_FIXED_KEY,
  CLAIM_REFUND_LAST_RUN_KEY,
  CLAIM_REFUND_LIMIT,
  CLAIM_REFUND_LOCK_KEY,
  counted,
  fixedCount,
  NOTHING_REFUNDED,
  refundableStatuses,
  stuckBefore,
  worthLogging,
} from './refund-retry.js'
import { ClaimRefundService } from './refund.service.js'

/** 한 번 돈 결과. */
export interface RefundRetryResult extends RefundTally {
  /** 다른 인스턴스가 고르고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/**
 * 나가지 못한 환불을 다시 내보낸다 (TASK-0068 F8 · R3).
 *
 * **찾는 것은 하나다** — 승인·검수를 지났는데 `REFUNDED` 로 못 간 클레임. 정상
 * 흐름에서 환불은 그 자리에서 곧바로 나가므로(`ClaimService.publishCancel` ·
 * `ReturnService.publishCompleted`), 여기 남는 것은 **그 한 번이 실패한 건**뿐이다.
 *
 * 실패의 종류는 셋이고 셋 다 다음 주기에 사라질 수 있다: 결제사가 잠깐 죽었거나,
 * 우리 프로세스가 커밋과 호출 사이에서 죽었거나, 잠금을 기다리다 마감을 넘겼다.
 * 사라지지 않는 종류 — 이미 다 환불된 결제, 없는 결제 — 는 `ClaimRefund.attempts`
 * 와 `lastError` 로 쌓여 사람이 볼 수 있는 자리에 남는다.
 *
 * **이 잡이 멈추면 아무것도 실패하지 않는다.** 그것이 이 파일이 있는 이유다 —
 * 구매자에게는 「돈이 안 들어온다」로만 보이고, 어느 요청도 에러를 내지 않는다.
 *
 * 구조는 `payment-reconcile.service.ts` · `payment-straggler.service.ts` 와 같다 —
 * 고르는 동안만 락을 쥐는 것, 한 건이 던져도 나머지가 도는 것, 건너뛴 실행을 적지
 * 않는 것까지 그대로다. **다른 것은 무엇을 찾고 무엇을 하느냐뿐이다.**
 */
@Injectable()
export class ClaimRefundRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ClaimRefundRetryService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly refunds: ClaimRefundService,
  ) {}

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * 옆의 세 잡이 같은 이유로 같은 일을 한다. 이 잡이 배경에서 돌면 두 가지가
   * 재현되지 않는 방식으로 깨진다: `AppMeta` 에 실행 시각을 적으므로 「건너뛴 실행은
   * 적지 않는다」를 재는 단언이 배경 실행 하나에 뒤집히고, **결제사 대역이 받은
   * 호출을 세는 단언**도 마찬가지다. 잃는 것은 없다 — {@link tick} 은 {@link sweep}
   * 을 감싼 `try`/`catch` 이고, 스펙은 {@link sweep} 을 직접 부른다.
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI 가
    // 끝나지 못하게 되면 안 된다 (옆의 세 잡과 같다).
    this.timer = setInterval(() => void this.tick(), CLAIM_REFUND_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 있지만 그 사람은 이 호출의
   * 응답을 보고 있지 않다.
   *
   * 한 건이 던지는 것은 {@link ClaimRefundService.settle} 이 이미 먹었으므로 여기까지
   * 오는 것은 고르기나 기록이 실패한 경우다.
   */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.sweep()
    } catch (error) {
      this.log.error('환불 재시도에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다.
   *
   * 고르고 → 하나씩 다시 내보내고 → 돈 사실을 적는다. 가운데가 트랜잭션 밖인 이유는
   * {@link claim} 에 적었다.
   */
  async sweep(): Promise<RefundRetryResult> {
    const now = this.clock.now()
    const claimed = await this.claim(now)

    if (claimed === null) return { ...NOTHING_REFUNDED, skipped: true }

    let tally = NOTHING_REFUNDED

    for (const claimId of claimed) tally = counted(tally, await this.refunds.settle(claimId))

    // 기록은 일이 끝난 뒤다. 시각은 **주기가 시작한 때**이므로 결제사가 느린 날에도
    // 「언제부터의 상태를 확인한 것인가」가 흔들리지 않는다.
    await this.record(now, tally)

    if (worthLogging(tally)) {
      this.log.log(
        `밀린 환불 ${String(fixedCount(tally))}건을 내보냈습니다 ` +
          `(이미 끝나 있던 것 ${String(tally.settled)} · 손댈 것 없음 ${String(tally.ignored)} · ` +
          `실패 ${String(tally.failed)}).`,
      )
    }

    return { ...tally, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 붙을 자리가 읽는다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: CLAIM_REFUND_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 지표를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 내보낸 건수. */
  async lastFixed(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: CLAIM_REFUND_LAST_FIXED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이번 주기가 다시 시도할 클레임들. 락을 못 잡으면 `null`.
   *
   * **락은 고르는 동안만 쥔다.** 한 건을 내보내는 일은 결제사와의 왕복이라, 그것을
   * 이 트랜잭션 안에 넣으면 연결 하나가 최악에 몇 분 동안 열린 채 남는다 —
   * `payment-reconcile.service.ts` 가 그 이유를 자세히 적어 두었다.
   *
   * 그래서 이 락이 막는 것은 **겹친 두 인스턴스가 같은 클레임에 환불을 두 번 보내는
   * 것**이다. 장부가 어긋나는 것은 락이 아니라 `ClaimRefundService.settle` 이 막는다 —
   * 클레임 행을 잠그고 상태를 다시 보므로 늦게 온 쪽은 아무것도 바꾸지 않는다. 락을
   * 짧게 쥐어도 안전한 것이지 락이 없어도 되는 것은 아니다.
   *
   * 트랜잭션 단위 락인 이유도 옆의 세 잡과 같다: 세션 락은 놓는 것을 잊으면 영원히
   * 남고, 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
   */
  private claim(now: Date): Promise<readonly string[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${CLAIM_REFUND_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      const rows = await tx.claimRequest.findMany({
        where: {
          status: { in: [...refundableStatuses] },
          // 유예를 지난 것만. 정상 흐름도 이 창을 반드시 지나므로, 없으면 배치가
          // 방금 승인된 취소의 환불과 겹친다 (`refund-retry.ts`).
          updatedAt: { lt: stuckBefore(now) },
        },
        // 오래된 것부터. 가장 오래 기다린 사람의 돈이 먼저 움직인다.
        orderBy: { updatedAt: 'asc' },
        take: CLAIM_REFUND_LIMIT,
        select: { id: true },
      })

      return rows.map((row) => row.id)
    })
  }

  /**
   * 돈 사실을 남긴다.
   *
   * **건너뛴 주기는 여기까지 오지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면,
   * 실제로는 한 인스턴스도 일하지 못하는 상태에서 지표가 계속 초록을 답한다 — 옆의
   * 세 잡이 같은 이유로 같게 한다.
   */
  private async record(now: Date, tally: RefundTally): Promise<void> {
    for (const [key, value] of [
      [CLAIM_REFUND_LAST_RUN_KEY, now.toISOString()],
      [CLAIM_REFUND_LAST_FIXED_KEY, String(fixedCount(tally))],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
