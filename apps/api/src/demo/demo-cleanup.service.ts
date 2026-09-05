import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SearchOutboxService } from '../search/search-outbox.service.js'
import type { DemoCleanupReport } from './demo-cleanup.js'
import {
  DEMO_CLEANUP_BATCH,
  DEMO_CLEANUP_INTERVAL_MS,
  DEMO_CLEANUP_LAST_RUN_KEY,
  DEMO_CLEANUP_REASON,
} from './demo-cleanup.js'

type Tx = Prisma.TransactionClient

/**
 * Collects expired demo accounts (TASK-0025).
 *
 * **One account is one transaction, and a failure is one account's.** F6 asks
 * that a failed sweep be retried on the next tick with no partial deletion, and
 * both halves fall out of that shape: the transaction gives atomicity, and the
 * account staying expired is what makes the retry automatic — nothing has to
 * remember it.
 *
 * **The plan lives in `demo-cleanup-plan.ts` as data.** This file is the part
 * that touches the database, and the order it touches it in is read from there
 * rather than written here, so the test that checks the order is checking the
 * thing that runs.
 *
 * **Nothing here is hard-deleted that another row points at.** Products, their
 * axes and their combinations are soft-deleted because the stock ledger holds
 * them with `RESTRICT` and is itself append-only; the account row is
 * soft-deleted because the ledger's `actorId` holds it the same way. The task's
 * 4장 records why, and `demo-cleanup.integration.spec.ts` proves the hard delete
 * really would fail.
 */
@Injectable()
export class DemoCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoCleanupService.name)
  private timer: NodeJS.Timeout | null = null
  /** Set while a sweep is running, so a slow one cannot overlap the next tick. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: SearchOutboxService,
  ) {}

  onModuleInit(): void {
    // `unref` so the timer never holds the process open — a CLI that boots the
    // application context (`pnpm db:seed`) must still be able to exit.
    this.timer = setInterval(() => void this.tick(), DEMO_CLEANUP_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** The scheduled run. Logs rather than throws — nothing is waiting on it. */
  private async tick(): Promise<void> {
    if (this.running) return

    try {
      const report = await this.sweep()

      if (report.swept > 0 || report.failed > 0) {
        this.logger.log(
          `데모 정리 — ${String(report.swept)}건 정리 · ${String(report.failed)}건 실패`,
        )
      }
    } catch (error) {
      this.logger.error('데모 정리 주기 실행에 실패했습니다.', error)
    }
  }

  /**
   * Collects up to `limit` expired accounts.
   *
   * Public because the integration spec drives it directly: a test that waited
   * fifteen minutes for a timer would be a test nobody runs.
   */
  async sweep(limit: number = DEMO_CLEANUP_BATCH): Promise<DemoCleanupReport> {
    this.running = true

    try {
      const now = this.clock.now()
      const expired = await this.prisma.user.findMany({
        // Both conditions, always: `isDemo` is the guard that keeps a real
        // account out of this query even if its `demoExpiresAt` were somehow
        // set, and `deletedAt: null` is what stops an already-swept account
        // being swept again every fifteen minutes forever (R1).
        where: { isDemo: true, deletedAt: null, demoExpiresAt: { lte: now } },
        orderBy: { demoExpiresAt: 'asc' },
        select: { id: true },
        take: limit,
      })

      let swept = 0
      let failed = 0

      for (const account of expired) {
        try {
          await this.prisma.$transaction((tx) => this.collect(tx, account.id, now))
          swept += 1
        } catch (error) {
          // One account's failure is one account's. It stays expired, so the
          // next tick picks it up again (F6).
          failed += 1
          this.logger.error(`데모 계정 정리 실패 — ${account.id}`, error)
        }
      }

      await this.recordRun(now)

      return { swept, failed, at: now }
    } finally {
      this.running = false
    }
  }

  /** When the last sweep finished, or `null` before the first one. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: DEMO_CLEANUP_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /**
   * Brings an account's expiry forward to now (F7).
   *
   * It does not sweep — it makes the account *collectable*, and the next tick
   * does the rest. Deleting inline would mean the caller's request carries the
   * cost of a transaction it did not ask for, and would give two paths into the
   * same deletion for one of them to drift.
   */
  async expireNow(userId: string): Promise<boolean> {
    const now = this.clock.now()
    const changed = await this.prisma.user.updateMany({
      where: { id: userId, isDemo: true, deletedAt: null },
      data: { demoExpiresAt: now, updatedAt: now },
    })

    return changed.count > 0
  }

  // ------------------------------------------------------------ the sweep

  /** Everything one expired account leaves behind, in the plan's order. */
  private async collect(tx: Tx, userId: string, now: Date): Promise<void> {
    const seller = await tx.seller.findUnique({ where: { userId }, select: { id: true } })

    // 장바구니 먼저 — `CartItem` 이 Cascade 로 함께 간다 (TASK-0045). 남길 이력이
    // 없다: 주문은 별개의 표이고 자기 스냅샷을 갖는다.
    await tx.cart.deleteMany({ where: { userId } })
    await this.letHoldsGo(tx, userId, now)
    await tx.refreshToken.deleteMany({ where: { userId } })
    await tx.userPreference.deleteMany({ where: { userId } })
    await tx.address.deleteMany({ where: { userId } })

    if (seller !== null) {
      // The listings leave the search index. They are soft-deleted below rather
      // than removed, so nothing else would ever tell the indexer — and a
      // findable listing whose store is closed is worse than a missing one.
      const listings = await tx.product.findMany({
        where: { sellerId: seller.id, deletedAt: null },
        select: { id: true },
      })

      for (const listing of listings) {
        await this.outbox.publish(tx, listing.id, 'REMOVE')
      }

      await tx.productVariant.updateMany({
        where: { sellerId: seller.id, deletedAt: null },
        data: { deletedAt: now, isActive: false, updatedAt: now },
      })
      await tx.productOption.updateMany({
        where: { product: { sellerId: seller.id }, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
      })
      await tx.product.updateMany({
        where: { sellerId: seller.id, deletedAt: null },
        data: { deletedAt: now, status: 'INACTIVE', updatedAt: now },
      })
      await tx.seller.update({
        where: { id: seller.id },
        data: {
          status: 'SUSPENDED',
          statusReason: DEMO_CLEANUP_REASON,
          statusChangedAt: now,
          updatedAt: now,
        },
      })
    }

    await tx.userRole.deleteMany({ where: { userId } })
    await tx.user.update({ where: { id: userId }, data: { deletedAt: now, updatedAt: now } })
  }

  /**
   * 잡아 둔 재고를 놓아 준다 (TASK-0048).
   *
   * 계정이 사라지면 아무도 그 주문서를 끝내지 않는다. 예약 행만 지우면 `reserved`
   * 캐시에 그 몫이 남아 **아무도 살 수 없는 재고**가 된다 — 실패로 나타나지 않고,
   * 판매자는 팔리지 않는 이유를 영원히 알 수 없다.
   *
   * `HELD` 만 되돌린다. 확정된 예약의 몫은 이미 `reserved` 에서 빠졌고 실제로
   * 팔렸다. 원장은 그대로 남는다 — `StockLedger.refId` 는 사라진 예약을 가리키게
   * 되지만 그것이 옳다: 판매 이력은 산 사람이 탈퇴해도 남아야 하는 기록이다.
   *
   * variant 마다가 아니라 한 문장이다 (A5). 데모 계정 하나가 주문서 스무 개를 열어
   * 두었다면 스무 번의 왕복이 된다.
   */
  private async letHoldsGo(tx: Tx, userId: string, now: Date): Promise<void> {
    await tx.$executeRaw`
      UPDATE "ProductVariant" v
         SET "reserved" = v."reserved" - r."held", "updatedAt" = ${now}
        FROM (SELECT "variantId", sum("quantity")::int AS "held"
                FROM "StockReservation"
               WHERE "userId" = ${userId}::uuid AND "status" = 'HELD'
               GROUP BY "variantId") r
       WHERE v."id" = r."variantId"
    `
    await tx.stockReservation.deleteMany({ where: { userId } })
  }

  private async recordRun(now: Date): Promise<void> {
    const value = now.toISOString()

    await this.prisma.appMeta.upsert({
      where: { key: DEMO_CLEANUP_LAST_RUN_KEY },
      update: { value },
      create: { key: DEMO_CLEANUP_LAST_RUN_KEY, value },
    })
  }
}
