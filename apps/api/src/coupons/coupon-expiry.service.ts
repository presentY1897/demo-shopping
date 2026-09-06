import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  COUPON_EXPIRY_BATCH_LIMIT,
  COUPON_EXPIRY_INTERVAL_MS,
  COUPON_EXPIRY_LAST_EXPIRED_KEY,
  COUPON_EXPIRY_LAST_RUN_KEY,
  COUPON_EXPIRY_LOCK_KEY,
  worthLoggingExpiry,
} from './coupon-expiry.js'

/** 한 번 돈 결과. */
export interface CouponExpiryResult {
  /** `EXPIRED` 로 옮긴 장수. */
  readonly expired: number
  /** 다른 인스턴스가 돌고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/**
 * 기간이 지난 쿠폰을 `EXPIRED` 로 옮긴다 (TASK-0072 F7).
 *
 * 본보기는 `payment/payment-reconcile.service.ts` 와
 * `reservation/reservation-sweeper.service.ts` 이고, 그 둘과 **같은 것이 셋**이다.
 *
 * - **어드바이저리 락으로 인스턴스 하나만 돈다.** 트랜잭션 단위 락
 *   (`pg_try_advisory_xact_lock`)인 이유도 같다 — 세션 락은 놓는 것을 잊으면
 *   영원히 남고, 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
 * - **`AppMeta` 에 돈 사실을 남긴다.** 이 잡의 실패는 아무 요청도 실패시키지
 *   않으므로, 밖에서 볼 수 있는 자리가 그 두 행뿐이다.
 * - **건너뛴 주기는 적지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면, 실제로는
 *   한 인스턴스도 옮기지 못하는 상태에서 마지막 실행 시각이 계속 새로워진다.
 *
 * **다른 것은 한 주기가 한 문장이라는 점이다.** 대사는 건마다 결제사와 왕복하고
 * 스위퍼는 건마다 다른 표를 잠그지만, 여기서 한 주기는 인덱스로 고른 행들의
 * 상태를 바꾸는 `UPDATE` 하나다. 그래서 락을 쥔 채로 전부 끝낼 수 있고, 락 밖에서
 * 해야 하는 일이 없다.
 *
 * **`USED` 는 건드리지 않는다.** 이미 쓴 쿠폰은 기간이 지나도 만료된 것이 아니라
 * 쓰인 것이다 — 그것을 `EXPIRED` 로 옮기면 「이 주문에 쓰인 쿠폰」이 만료된 쿠폰이
 * 되어 환불 복원(TASK-0078)이 되돌릴 대상을 잃는다.
 */
@Injectable()
export class CouponExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CouponExpiryService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * `payment-reconcile.service.ts` 가 같은 이유로 같게 한다: 이 잡이 배경에서 돌면
   * 「건너뛴 실행은 적지 않는다」를 재는 단언이 배경 실행 하나에 뒤집히고, 「아직
   * 유효한 것은 안 건드린다」도 시계를 옮긴 순간 배경 주기가 먼저 옮겨 버릴 수
   * 있다. 잃는 것은 없다 — {@link tick} 은 {@link sweep} 을 감싼 `try`/`catch` 이고
   * 스펙은 {@link sweep} 을 직접 부른다.
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI 가
    // 끝나지 못하게 되면 안 된다 (스위퍼·대사와 같다).
    this.timer = setInterval(() => void this.tick(), COUPON_EXPIRY_INTERVAL_MS)
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
      await this.sweep()
    } catch (error) {
      this.log.error('쿠폰 만료 처리에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다.
   *
   * 고르는 것과 옮기는 것이 **한 문장**이다. 두 문장으로 나누면 그 사이에 누군가
   * 그 쿠폰을 써서 `USED` 가 될 수 있고, 그러면 **쓴 쿠폰을 만료로 덮는다.**
   * 하위 질의가 `ORDER BY … LIMIT` 를 들고 있어도 갱신 자신이 `status = 'ISSUED'`
   * 를 다시 확인하므로 그 경합에서 지는 쪽은 아무 행도 고치지 않는다.
   */
  async sweep(): Promise<CouponExpiryResult> {
    const now = this.clock.now()
    const expired = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${COUPON_EXPIRY_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      return tx.$executeRaw`
        UPDATE "UserCoupon"
           SET "status" = 'EXPIRED', "updatedAt" = ${now}
         WHERE "status" = 'ISSUED'
           AND "id" IN (
             SELECT "id" FROM "UserCoupon"
              WHERE "status" = 'ISSUED' AND "expiresAt" <= ${now}
              ORDER BY "expiresAt" ASC
              LIMIT ${COUPON_EXPIRY_BATCH_LIMIT}
           )
      `
    })

    if (expired === null) return { expired: 0, skipped: true }

    // 기록은 락 **밖에서** 한다. 다음 주기가 이 행을 기다릴 이유가 없고, 기록이
    // 실패해도 이미 옮긴 것이 되돌아가면 안 된다 (스위퍼와 같은 판단).
    await this.record(now, expired)

    if (worthLoggingExpiry(expired)) {
      this.log.log(`기간이 지난 쿠폰 ${String(expired)}장을 만료 처리했습니다.`)
    }

    return { expired, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 붙는 자리다 (M11 후속). */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: COUPON_EXPIRY_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 옮긴 장수. */
  async lastExpired(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: COUPON_EXPIRY_LAST_EXPIRED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  /** 돈 사실을 남긴다. */
  private async record(now: Date, expired: number): Promise<void> {
    for (const [key, value] of [
      [COUPON_EXPIRY_LAST_RUN_KEY, now.toISOString()],
      [COUPON_EXPIRY_LAST_EXPIRED_KEY, String(expired)],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
