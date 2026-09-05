import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ReservationDiscrepancy } from './reservation.service.js'
import { ReservationService } from './reservation.service.js'
import {
  SWEEP_BATCH_LIMIT,
  SWEEP_LAST_RELEASED_KEY,
  SWEEP_LAST_RUN_KEY,
  SWEEP_INTERVAL_MS,
  SWEEP_LOCK_KEY,
} from './reservation-sweeper.js'

type Tx = Prisma.TransactionClient

/** 한 번 돈 결과. */
export interface SweepResult {
  /** 푼 예약 수. */
  readonly released: number
  /** `PAYMENT_FAILED` 로 옮긴 판매자 몫의 수. */
  readonly failedOrders: number
  /** 다른 인스턴스가 돌고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/** 풀린 예약 하나가 무엇을 가리켰나. */
interface ExpiredHold {
  readonly id: string
  readonly variantId: string
  readonly quantity: number
  readonly checkoutId: string
}

/**
 * 만료된 예약을 놓아 준다 (TASK-0051).
 *
 * **이 잡이 멈추면 재고가 잠긴다.** 잡아 둔 재고가 영영 풀리지 않고, 아무도 그것을
 * 살 수 없으며, **아무것도 실패하지 않는다** — 그래서 헬스체크가 이것을 본다(F5·F6).
 *
 * 한 번에 {@link SWEEP_BATCH_LIMIT} 건만 처리한다. 만료가 천 건 쌓인 날 한 트랜잭션
 * 으로 전부 풀면 그동안 그 variant 들의 행이 잠겨 담기와 주문이 함께 멈춘다 — 청소가
 * 장애를 만드는 모양이다. 남은 것은 다음 주기가 가져가고, 주기가 1분이라 천 건은
 * 다섯 주기 안에 사라진다.
 *
 * **어드바이저리 락으로 인스턴스 하나만 돈다.** 두 인스턴스가 같은 예약을 동시에
 * 풀면 `reserved` 가 두 번 줄어 **음수 쪽으로 어긋난다** — 그리고 그것은
 * `ProductVariant_reserved_check` 가 거절하므로 한쪽이 실패로 끝난다. 락이 없으면
 * 「가끔 청소가 실패한다」가 되고, 그 로그를 보고 원인을 찾기는 어렵다.
 */
@Injectable()
export class ReservationSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReservationSweeperService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reservations: ReservationService,
  ) {}

  onModuleInit(): void {
    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI
    // (`pnpm db:seed`)가 끝나지 못하게 되면 안 된다.
    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 없다.
   *
   * 실패가 조용한 것이 이 잡의 위험이므로, 대신 헬스체크가 「마지막으로 돈 시각」을
   * 본다. 계속 던지기만 하면 로그에는 남고 상태에는 안 남는다.
   */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.sweep()
    } catch (error) {
      this.log.error('예약 만료 정리에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다.
   *
   * 락을 **세션 단위가 아니라 트랜잭션 단위**로 잡는다(`pg_try_advisory_xact_lock`).
   * 세션 락은 풀어 주는 것을 잊으면 영원히 남고, 잊는 경우는 예외가 아니라 프로세스가
   * 죽는 경우다 — 트랜잭션 락은 그때 데이터베이스가 알아서 놓는다.
   */
  async sweep(): Promise<SweepResult> {
    const now = this.clock.now()
    const result = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      const expired = await this.expiredHolds(tx, now)

      for (const hold of expired) await this.release(tx, hold, now)

      return { released: expired.length, failedOrders: await this.failOrders(tx, expired, now) }
    })

    if (result === null) return { released: 0, failedOrders: 0, skipped: true }

    // 기록은 락 **밖에서** 한다. 다음 주기가 이 행을 기다릴 이유가 없고, 기록이
    // 실패해도 이미 푼 것이 되돌아가면 안 된다.
    await this.record(now, result.released)

    if (result.released > 0) {
      this.log.log(
        `만료 예약 ${String(result.released)}건을 풀었습니다 (주문 ${String(result.failedOrders)}건 실패 처리).`,
      )
    }

    return { ...result, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 읽는다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: SWEEP_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 푼 건수. */
  async lastReleased(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: SWEEP_LAST_RELEASED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  /**
   * `reserved` 캐시가 예약 표와 어긋난 variant 전부 (F7 · R2).
   *
   * **자동 보정하지 않는다.** 원인을 모르는 채 값을 고치면 문제가 숨는다 — 검출과
   * 기록까지가 이 잡의 일이고, 고치는 것은 사람의 판단이다.
   */
  async reconcile(): Promise<readonly ReservationDiscrepancy[]> {
    const faults = await this.reservations.reconcile()

    if (faults.length > 0) {
      this.log.warn(
        `예약 캐시가 어긋난 조합이 ${String(faults.length)}개 있습니다: ${faults
          .map(
            (fault) =>
              `${fault.variantId}(${String(fault.reserved)}≠${String(fault.heldQuantity)})`,
          )
          .join(', ')}`,
      )
    }

    return faults
  }

  // ---------------------------------------------------------------- internals

  /**
   * 풀 것들. **`CONFIRMED` 는 조건에 없다** (F2) — 확정된 예약의 몫은 이미
   * `reserved` 에서 빠졌고 실제로 팔렸다.
   */
  private expiredHolds(tx: Tx, now: Date): Promise<readonly ExpiredHold[]> {
    return tx.stockReservation.findMany({
      where: { status: 'HELD', expiresAt: { lt: now } },
      // 오래된 것부터. 가장 오래 잠겨 있던 재고가 먼저 풀린다.
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH_LIMIT,
      select: { id: true, variantId: true, quantity: true, checkoutId: true },
    })
  }

  /** 한 건을 푼다 — `reserved` 를 되돌리고 상태를 `RELEASED` 로. */
  private async release(tx: Tx, hold: ExpiredHold, now: Date): Promise<void> {
    await tx.$executeRaw`
      UPDATE "ProductVariant"
         SET "reserved" = "reserved" - ${hold.quantity}, "updatedAt" = ${now}
       WHERE "id" = ${hold.variantId}::uuid
    `
    await tx.stockReservation.update({
      where: { id: hold.id },
      data: { status: 'RELEASED', settledAt: now, updatedAt: now },
    })
  }

  /**
   * 예약이 풀린 주문서를 결제 실패로 옮긴다 (F3).
   *
   * 옮기는 대상은 **아직 `PAYMENT_PENDING` 인 것**뿐이다. 이미 결제된 주문은 그
   * 예약이 확정으로 끝났을 것이고, 여기 걸리지도 않는다.
   *
   * 이력을 함께 남긴다. `actorId` 는 `null` 이다 — 옮긴 것이 사람이 아니라
   * 스케줄러이고, 없는 사람을 지어내는 것보다 비어 있는 편이 사실이다.
   */
  private async failOrders(tx: Tx, expired: readonly ExpiredHold[], now: Date): Promise<number> {
    const checkoutIds = [...new Set(expired.map((hold) => hold.checkoutId))]

    if (checkoutIds.length === 0) return 0

    const stranded = await tx.sellerOrder.findMany({
      where: { status: 'PAYMENT_PENDING', order: { checkoutId: { in: checkoutIds } } },
      select: { id: true },
    })

    if (stranded.length === 0) return 0

    const ids = stranded.map((row) => row.id)

    await tx.sellerOrder.updateMany({
      where: { id: { in: ids } },
      data: { status: 'PAYMENT_FAILED', updatedAt: now },
    })
    await tx.orderStatusHistory.createMany({
      data: ids.map((sellerOrderId) => ({
        sellerOrderId,
        fromStatus: 'PAYMENT_PENDING' as const,
        toStatus: 'PAYMENT_FAILED' as const,
        reason: '결제 대기 시간이 지나 예약이 해제되었습니다.',
        actorId: null,
        createdAt: now,
      })),
    })

    return ids.length
  }

  /** 돈 사실을 남긴다. 헬스체크가 이 두 행을 읽는다. */
  private async record(now: Date, released: number): Promise<void> {
    for (const [key, value] of [
      [SWEEP_LAST_RUN_KEY, now.toISOString()],
      [SWEEP_LAST_RELEASED_KEY, String(released)],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
