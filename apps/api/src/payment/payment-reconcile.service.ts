import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ReconcileOutcome, ReconcileTally } from './payment-reconcile.js'
import {
  askableBefore,
  counted,
  NOTHING_RECONCILED,
  RECONCILE_BATCH_LIMIT,
  RECONCILE_INTERVAL_MS,
  RECONCILE_LAST_RESOLVED_KEY,
  RECONCILE_LAST_RUN_KEY,
  RECONCILE_LOCK_KEY,
  resolvedCount,
  worthLogging,
} from './payment-reconcile.js'
import { PaymentService } from './payment.service.js'

/** 한 번 돈 결과. */
export interface ReconcileResult extends ReconcileTally {
  /** 다른 인스턴스가 고르고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/**
 * 결과를 모르는 결제를 결제사에 다시 물어본다 (TASK-0056 F6 · F9 · D-220).
 *
 * **웹훅이 유실돼도 결제는 끝나야 한다.** 웹훅은 놓칠 수 있는 신호이고, 돈이 걸린
 * 영역에서 「못 받았으면 그만」은 허용되지 않는다. 그래서 이 잡이 있고, 웹훅과
 * 이 잡은 **같은 문**(`PaymentService.resolveUnresolved`)을 쓴다 — 신호를 믿는
 * 대신 저쪽에 다시 묻기 때문에 중복·순서 역전·유실이 전부 같은 답으로 접힌다.
 *
 * **이 잡이 멈추면 사람이 갇힌다.** `UNRESOLVED` 에서 나가는 길은 대사만 열고
 * (D-220), 그동안 그 주문에는 새 결제를 시작할 수 없다. 그런데 그 사실은 아무
 * 요청도 실패시키지 않는다 — 그래서 마지막 실행 시각이 `/health` 에 실린다
 * (`health/payment-reconcile.health-indicator.ts`).
 *
 * 구조는 `reservation/reservation-sweeper.service.ts` 와 같다. **다른 곳은 한
 * 군데뿐이고, 그것이 이 파일에서 가장 중요한 판단이다** — 락을 쥔 채로 결제사를
 * 부르지 않는다. 아래 {@link claim} 에 적었다.
 */
@Injectable()
export class PaymentReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaymentReconcileService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentService,
  ) {}

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * `search-indexer.service.ts` 가 같은 이유로 같은 일을 한다. 이 잡이 배경에서
   * 돌면 두 가지가 재현되지 않는 방식으로 깨진다: `AppMeta` 에 실행 시각을 적으므로
   * 「건너뛴 실행은 적지 않는다」를 재는 단언이 배경 실행 하나에 뒤집히고, 결제사
   * 대역이 받은 호출을 세는 단언 — 「유예 안의 건은 묻지도 않는다」 — 도 마찬가지다.
   * 잃는 것은 없다: {@link tick} 은 {@link reconcile} 을 감싼 `try`/`catch` 이고,
   * 스펙은 {@link reconcile} 을 직접 부른다.
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI
    // 가 끝나지 못하게 되면 안 된다 (스위퍼와 같다).
    this.timer = setInterval(() => void this.tick(), RECONCILE_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 없다.
   *
   * 한 건이 던지는 것은 {@link resolveOne} 이 이미 먹었으므로 여기까지 오는 것은
   * 고르기나 기록이 실패한 경우다. 그때도 조용한 것이 위험이라, 대신 헬스체크가
   * 「마지막으로 돈 시각」을 본다.
   */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.reconcile()
    } catch (error) {
      this.log.error('결제 대사에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다.
   *
   * 고르고 → 하나씩 물어보고 → 돈 사실을 적는다. 셋이 나뉜 이유는 가운데가
   * **트랜잭션 밖**이어야 하기 때문이고, 그것이 이 잡과 스위퍼의 유일한 구조
   * 차이다.
   */
  async reconcile(): Promise<ReconcileResult> {
    const now = this.clock.now()
    const claimed = await this.claim(now)

    if (claimed === null) return { ...NOTHING_RECONCILED, skipped: true }

    let tally = NOTHING_RECONCILED

    for (const paymentId of claimed) tally = counted(tally, await this.resolveOne(paymentId))

    // 기록은 물어보기가 끝난 뒤다. 시각은 **주기가 시작한 때**이므로 저쪽이 느린
    // 날에도 「언제부터의 상태를 확인한 것인가」가 흔들리지 않는다.
    await this.record(now, tally)

    if (worthLogging(tally)) {
      this.log.log(
        `대사가 결제 ${String(resolvedCount(tally))}건을 풀었습니다 ` +
          `(승인 ${String(tally.settled)} · 실패 ${String(tally.failed)}, ` +
          `아직 모름 ${String(tally.pending)} · 이미 처리됨 ${String(tally.noop)} · ` +
          `못 물어봄 ${String(tally.unreachable)}).`,
      )
    }

    return { ...tally, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 읽는다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: RECONCILE_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 푼 건수. */
  async lastResolved(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: RECONCILE_LAST_RESOLVED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이번 주기가 물어볼 결제들. 락을 못 잡으면 `null`.
   *
   * **락은 고르는 동안만 쥔다.** 스위퍼는 푸는 일까지 락 안에서 끝내지만, 여기서
   * 한 건을 푸는 일은 **결제사와의 왕복**이다. 그것을 트랜잭션 안에 넣으면 연결
   * 하나가 최악에 몇 분 동안 열린 채 남고, 그 몇 분이 Prisma 의 트랜잭션 마감을
   * 넘기면 **이미 끝난 매입까지 예외로 끝난다.** 「프로바이더 호출은 트랜잭션
   * 밖」은 `payment.service.ts` 의 승인 경로가 이미 세운 규칙이고, 배치라고 해서
   * 달라질 이유가 없다.
   *
   * 그래서 이 락이 막는 것은 **겹친 두 인스턴스가 같은 목록을 집어 결제사에 같은
   * 질문을 두 번 보내는 것**이다(R2). 장부가 어긋나는 것은 락이 아니라
   * `resolveUnresolved` 가 막는다 — 결제 행을 잠그고 상태를 다시 보므로 늦게 온
   * 쪽은 아무것도 바꾸지 않고 `noop` 으로 끝난다. 그 덕분에 락을 짧게 쥐어도
   * 안전한 것이지, 락이 없어도 되는 것은 아니다.
   *
   * 트랜잭션 단위 락인 이유는 스위퍼와 같다: 세션 락은 놓는 것을 잊으면 영원히
   * 남고, 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
   */
  private claim(now: Date): Promise<readonly string[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${RECONCILE_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      const rows = await tx.payment.findMany({
        // 유예를 지난 것만. 막 끊긴 건에 물어봐야 돌아오는 답은 `pending` 뿐이다.
        where: { status: 'UNRESOLVED', updatedAt: { lt: askableBefore(now) } },
        // 오래된 것부터. 가장 오래 갇혀 있던 사람이 먼저 풀린다.
        orderBy: { updatedAt: 'asc' },
        take: RECONCILE_BATCH_LIMIT,
        select: { id: true },
      })

      return rows.map((row) => row.id)
    })
  }

  /**
   * 한 건을 푼다. **던지지 않는다.**
   *
   * 하나의 실패가 배치를 멈추면, 물어볼 수 없는 결제 하나가 나머지 전부를
   * **영원히** 막는다 — 목록이 오래된 것부터라서 그 한 건은 다음 주기에도 맨
   * 앞에 있고, 그때도 같은 자리에서 던진다. 그래서 여기서 먹고 세기만 한다.
   *
   * 예외가 조용히 사라지지는 않는다. 결제 id 와 함께 `error` 로 남고, 헬스체크가
   * 보는 「푼 건수」에는 들어가지 않으므로 계속 던지는 한 건은 「밀린 것이 안
   * 줄어든다」로 드러난다.
   */
  private async resolveOne(paymentId: string): Promise<ReconcileOutcome> {
    try {
      return await this.payments.resolveUnresolved(paymentId)
    } catch (error) {
      this.log.error(`결제 ${paymentId} 의 결과를 확인하지 못했습니다.`, error)

      return 'unreachable'
    }
  }

  /**
   * 돈 사실을 남긴다. 헬스체크가 이 두 행을 읽는다.
   *
   * **건너뛴 주기는 여기까지 오지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면,
   * 실제로는 한 인스턴스도 물어보지 못하는 상태에서 헬스체크가 계속 초록을
   * 답한다 — 스위퍼가 같은 이유로 같게 한다.
   */
  private async record(now: Date, tally: ReconcileTally): Promise<void> {
    for (const [key, value] of [
      [RECONCILE_LAST_RUN_KEY, now.toISOString()],
      [RECONCILE_LAST_RESOLVED_KEY, String(resolvedCount(tally))],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
