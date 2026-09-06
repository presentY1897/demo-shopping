import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ExpiryTally } from './point-expiry.js'
import {
  counted,
  failed,
  NOTHING_EXPIRED,
  POINT_EXPIRY_BATCH_LIMIT,
  POINT_EXPIRY_INTERVAL_MS,
  POINT_EXPIRY_LAST_EXPIRED_KEY,
  POINT_EXPIRY_LAST_RUN_KEY,
  POINT_EXPIRY_LOCK_KEY,
  worthLogging,
} from './point-expiry.js'
import { PointsService } from './points.service.js'

/** 한 번 돈 결과. */
export interface ExpiryResult extends ExpiryTally {
  /** 다른 인스턴스가 고르고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/**
 * 기한이 지난 적립금을 닫는다 (TASK-0076 F8).
 *
 * 구조는 `payment/payment-reconcile.service.ts` 와 같다 — 고르고(락 안), 하나씩
 * 처리하고(락 밖), 돈 사실을 적는다. **가운데가 락 밖인 이유는 저쪽과 다르다**:
 * 저쪽은 결제사와의 왕복이 길어서였고, 여기서는 한 계정의 만료가 그 계정의 행
 * 잠금을 잡기 때문이다. 고르는 락을 쥔 채로 계정 잠금을 하나씩 잡으면, 다른 배치나
 * 사용자가 쥔 계정 잠금을 기다리는 동안 **다음 주기 전체가 막힌다.**
 *
 * 만료가 겹쳐 돌아도 안전하다. 첫째 방어는 통이 비면 후보 질의에서 빠지는 것이고,
 * 둘째는 `PointTransaction_ref_key` — 만료 행이 자기가 닫은 통을 가리키므로 같은
 * 통에 두 번째 만료가 생길 수 없다.
 */
@Injectable()
export class PointExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PointExpiryService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly points: PointsService,
  ) {}

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * 이 잡이 배경에서 돌면 두 가지가 재현되지 않는 방식으로 깨진다: `AppMeta` 에
   * 실행 시각을 적으므로 「건너뛴 주기는 적지 않는다」를 재는 단언이 배경 실행
   * 하나에 뒤집히고, 잔액을 세는 단언도 만료가 끼어들면 흔들린다. 잃는 것은 없다 —
   * {@link tick} 은 {@link expire} 를 감싼 `try`/`catch` 이고 스펙은 {@link expire}
   * 를 직접 부른다 (`payment-reconcile.service.ts` 와 같다).
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    this.timer = setInterval(() => void this.tick(), POINT_EXPIRY_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 없다. */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.expire()
    } catch (error) {
      this.log.error('적립금 만료에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /** 한 번 돈다. */
  async expire(): Promise<ExpiryResult> {
    const now = this.clock.now()
    const claimed = await this.claim(now)

    if (claimed === null) return { ...NOTHING_EXPIRED, skipped: true }

    let tally = NOTHING_EXPIRED

    for (const userId of claimed) tally = await this.expireOne(tally, userId)

    // 기록은 처리가 끝난 뒤이고, 시각은 **주기가 시작한 때**다. 늦게 끝난 주기가
    // 자기 시작 시각보다 나중을 적으면 「언제부터의 상태인가」가 흔들린다.
    await this.record(now, tally)

    if (worthLogging(tally)) {
      this.log.log(
        `적립금 ${String(tally.lots)}건 ${String(tally.amount)}원이 만료됐습니다 ` +
          `(실패 ${String(tally.failed)}).`,
      )
    }

    return { ...tally, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 읽을 값이다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: POINT_EXPIRY_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 없앤 금액. */
  async lastExpired(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: POINT_EXPIRY_LAST_EXPIRED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  // ---------------------------------------------------------------- 내부

  /**
   * 이번 주기가 볼 계정들. 락을 못 잡으면 `null`.
   *
   * **계정 단위로 고른다.** 통 단위로 고르면 한 계정의 통 여럿이 서로 다른
   * 트랜잭션에서 닫히고, 그 사이에 사용이 끼어들어 이미 비운 통에 만료가 도착한다.
   * 한 계정을 한 트랜잭션에서 끝내면 그 경합 자체가 없다.
   *
   * 트랜잭션 단위 락인 이유는 스위퍼와 같다: 세션 락은 놓는 것을 잊으면 영원히 남고,
   * 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
   */
  private claim(now: Date): Promise<readonly string[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${POINT_EXPIRY_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      const rows = await tx.$queryRaw<readonly { readonly userId: string }[]>`
        SELECT DISTINCT a."userId"
          FROM "PointTransaction" t
          JOIN "PointAccount" a ON a."id" = t."accountId"
         WHERE t."remainingAmount" > 0
           AND t."expiresAt" <= ${now}
         LIMIT ${POINT_EXPIRY_BATCH_LIMIT}
      `

      return rows.map((row) => row.userId)
    })
  }

  /**
   * 한 계정을 처리한다. **던지지 않는다.**
   *
   * 하나의 실패가 배치를 멈추면 처리할 수 없는 계정 하나가 나머지 전부를 영원히
   * 막는다 — 다음 주기에도 그 계정이 목록에 있고 그때도 같은 자리에서 던진다.
   * 예외가 조용히 사라지지는 않는다: 계정 id 와 함께 `error` 로 남고, 「밀린 것이 안
   * 줄어든다」로 밖에서도 보인다.
   */
  private async expireOne(tally: ExpiryTally, userId: string): Promise<ExpiryTally> {
    try {
      return counted(tally, await this.points.expireDueFor(userId))
    } catch (error) {
      this.log.error(`적립금 만료에 실패했습니다: ${userId}`, error)

      return failed(tally)
    }
  }

  /**
   * 돈 사실을 남긴다.
   *
   * **건너뛴 주기는 여기까지 오지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면,
   * 실제로는 한 인스턴스도 일하지 못하는 상태에서 헬스체크가 계속 초록을 답한다.
   */
  private async record(now: Date, tally: ExpiryTally): Promise<void> {
    for (const [key, value] of [
      [POINT_EXPIRY_LAST_RUN_KEY, now.toISOString()],
      [POINT_EXPIRY_LAST_EXPIRED_KEY, String(tally.amount)],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
