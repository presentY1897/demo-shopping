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
  DEMO_CLEANUP_LAST_REPORT_KEY,
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
          await this.recordFailure(account.id, error, now)
        }
      }

      await this.recordRun(now)
      await this.recordReport({ swept, failed })

      return { swept, failed, at: now }
    } finally {
      this.running = false
    }
  }

  /**
   * 마지막 스윕이 집은 것과 실패한 것 (F3).
   *
   * 읽을 수 없는 값은 「없다」로 본다. `AppMeta.value` 는 문자열이라 모양을 DB 가
   * 지켜 주지 않고, 여기서 던지면 **화면 전체가 한 칸 때문에 빈다.**
   */
  async lastReport(): Promise<{ readonly swept: number; readonly failed: number } | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: DEMO_CLEANUP_LAST_REPORT_KEY },
      select: { value: true },
    })

    if (row === null) return null

    try {
      const parsed: unknown = JSON.parse(row.value)

      if (typeof parsed !== 'object' || parsed === null) return null

      const { swept, failed } = parsed as { swept?: unknown; failed?: unknown }

      if (typeof swept !== 'number' || typeof failed !== 'number') return null

      return { swept, failed }
    } catch {
      return null
    }
  }

  private async recordReport(report: { swept: number; failed: number }): Promise<void> {
    const value = JSON.stringify(report)

    await this.prisma.appMeta.upsert({
      where: { key: DEMO_CLEANUP_LAST_REPORT_KEY },
      create: { key: DEMO_CLEANUP_LAST_REPORT_KEY, value },
      update: { value },
    })
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
  /**
   * 정리가 왜 실패했는지를 **그 계정에** 적는다 (TASK-0096 F4).
   *
   * ## 표가 아니라 칸인 이유
   *
   * 실패는 이 계정의 **지금 상태**이지 쌓아 둘 사건이 아니다. 표로 만들면 이미 정리된
   * 계정의 옛 실패가 영영 남아 목록을 채운다 — 다음 주기가 성공하면 계정 행 자체가
   * 사라지므로 칸도 함께 간다.
   *
   * ## 이 쓰기가 실패해도 삼킨다
   *
   * 여기까지 온 것은 이미 한 번 실패한 뒤다. 기록하려다 또 터져서 **스윕 전체가
   * 멈추면** 남은 계정들이 이번 주기에 아예 안 집힌다 — 한 계정의 실패는 한 계정의
   * 것이라는 이 함수 위의 규칙이 여기에도 적용된다.
   */
  private async recordFailure(userId: string, error: unknown, now: Date): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { id: userId },
        data: {
          demoCleanupFailedAt: now,
          // 사유는 짝이 없으면 안 된다 (`User_demo_cleanup_failure_check`). 메시지가
          // 없는 오류도 있으므로 마지막 대비책까지 둔다 — 빈 문자열이면 제약이 아니라
          // **화면이** 말할 것을 잃는다.
          demoCleanupError:
            (error instanceof Error ? error.message : String(error)).slice(0, 500) ||
            '알 수 없는 오류',
          updatedAt: now,
        },
      })
    } catch (writeError) {
      this.logger.error(`데모 정리 실패를 적지 못했습니다 — ${userId}`, writeError)
    }
  }

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
    // 가상 카드와 그 원장 (TASK-0053). 실제 결제망에 닿지 않는 가짜이고, 원장은
    // 그 카드의 잔액을 설명하는 기록이라 카드가 사라지면 설명할 대상이 없다 —
    // 결제 이력 자체는 `Payment` 가 따로 들고 있고 그쪽은 남는다.
    await tx.virtualCard.deleteMany({ where: { userId } })
    await tx.refreshToken.deleteMany({ where: { userId } })
    await tx.userPreference.deleteMany({ where: { userId } })
    await tx.address.deleteMany({ where: { userId } })
    // 신고 (TASK-0091). **신고는 낸 사람의 것이다** — 데모 방문자가 낸 신고가
    // 남으면 사라진 사람이 실계정의 글을 가리고 있는 상태가 되고, 그 신고를 취소할
    // 사람이 없다.
    await tx.report.deleteMany({ where: { reporterId: userId } })
    // 알림 (TASK-0090). 「배송이 시작됐어요」는 남길 이력이 아니라 그때 읽으라고
    // 만든 것이고, 읽을 사람이 사라지면 남길 이유가 없다.
    await tx.notification.deleteMany({ where: { userId } })
    // 상품 문의 (TASK-0088). **남의 상품에 남긴 물음이지만 그 사람의 것이다** —
    // 데모 방문자의 문의가 실계정 상품에 영원히 남으면 답할 사람도 지울 방법이 없다.
    // 답변은 `ProductAnswer` 가 Cascade 로 함께 간다.
    await tx.productQuestion.deleteMany({ where: { userId } })
    // 찜과 최근 본 상품 (TASK-0086 · 0087). 온전히 그 사람의 것이고 아무것도
    // 참조하지 않는다 — 남길 이력이 없다.
    await tx.wishlist.deleteMany({ where: { userId } })
    await tx.recentlyViewed.deleteMany({ where: { userId } })
    // 팔로우 (TASK-0089). **팔로워 수가 그 사람을 세고 있어서** 남으면 사라진
    // 계정이 브랜드의 팔로워 수에 영원히 포함된다. 지운 뒤 다시 센다.
    const followed = await tx.sellerFollow.findMany({
      where: { userId },
      select: { sellerId: true },
    })

    await tx.sellerFollow.deleteMany({ where: { userId } })
    await tx.$executeRaw`
      UPDATE "Seller" s
         SET "followerCount" = (
               SELECT COUNT(*)::int FROM "SellerFollow" f WHERE f."sellerId" = s."id")
       WHERE s."id" = ANY(${followed.map((row) => row.sellerId)}::uuid[])`
    // 「도움돼요」 (TASK-0084). **남의 리뷰에 누른 것도 그 사람의 것이다** — 남으면
    // 실계정 리뷰의 순서가 사라진 사람의 손에 남는다. 지운 뒤 그 리뷰들의 세는
    // 값을 **다시 센다**: 누적하면 어긋난 값을 되돌릴 방법이 없다.
    const voted = await tx.reviewHelpful.findMany({ where: { userId }, select: { reviewId: true } })

    await tx.reviewHelpful.deleteMany({ where: { userId } })
    await tx.$executeRaw`
      UPDATE "Review" r
         SET "helpfulCount" = (
               SELECT COUNT(*)::int FROM "ReviewHelpful" rh WHERE rh."reviewId" = r."id")
       WHERE r."id" = ANY(${voted.map((row) => row.reviewId)}::uuid[])`
    // 리뷰 (TASK-0083 R1). **남의 상품에 남긴 말이지만 그 사람의 것이다** — 데모
    // 방문자가 남긴 별점이 실계정 상품의 평균에 영원히 섞이면 그 상품의 평점은
    // 아무도 검증할 수 없는 값이 된다. 사진은 `ReviewImage` 가 Cascade 로 함께
    // 가고, 버킷의 객체는 상품 이미지와 같은 장치가 뒤에 치운다 (TASK-0033 F6).
    await tx.review.deleteMany({ where: { userId } })

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
