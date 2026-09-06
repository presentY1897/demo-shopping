import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type {
  SettlementAmounts,
  SettlementItemSource,
  SettlementPeriod,
} from './settlement-calc.js'
import { amountsOf, differenceOf, sumOf, weekBefore } from './settlement-calc.js'
import { loadSettlementSources } from './settlement-sources.js'
import type { SettlementTally } from './settlement-batch.js'
import {
  NOTHING_SETTLED,
  SETTLEMENT_BATCH_LIMIT,
  SETTLEMENT_INTERVAL_MS,
  SETTLEMENT_LAST_RUN_KEY,
  SETTLEMENT_LAST_SETTLED_KEY,
  SETTLEMENT_LOCK_KEY,
} from './settlement-batch.js'

type Tx = Prisma.TransactionClient

/** 정산해야 하는 판매자 몫 하나. */
interface Candidate {
  readonly sellerOrderId: string
  readonly sellerId: string
  /** 이미 판매 줄이 있으면 그 줄과 그것이 속한 정산서. 새 몫이면 `null`. */
  readonly settled: {
    readonly itemId: string
    readonly settlementId: string
    /** 그 정산서가 아직 손댈 수 있는가 — `PENDING` 이면 고쳐 쓰고, 아니면 차감한다. */
    readonly amendable: boolean
  } | null
}

/**
 * 주간 정산서 배치 (TASK-0080).
 *
 * ## 이 배치가 답하는 질문은 하나다
 *
 * **「이 판매자 몫에 대해 지금까지 정산된 금액과, 지금 정산돼야 하는 금액이
 * 같은가.」** 새 몫이면 앞엣것이 0이고, 반품이 있었으면 뒤엣것이 줄어 있다. 셋으로
 * 갈리는 것은 그 차이를 **어디에 적느냐**뿐이다:
 *
 * | 상황 | 하는 일 |
 * | --- | --- |
 * | 정산된 적 없다 | 판매 줄을 만든다 |
 * | 승인 전 정산서에 있다 | 그 줄을 **고쳐 쓴다** (재생성) |
 * | 승인·지급된 정산서에 있다 | 이번 회차에 **차감 줄**을 적는다 (F7) |
 *
 * 「어느 반품 때문인가」를 세지 않는 이유가 여기 있다. 한 몫이 나눠서 여러 번
 * 반품되면 그 물음은 정의되지 않고, **차이**만이 언제나 옳다 — 나눠 반품한 사람의
 * 합이 한 번에 반품한 사람과 어긋나지 않는 것도 그래서다 (`settlement-calc.ts` 의
 * 누계 장치).
 *
 * ## 구매확정은 **이력**으로 판정한다
 *
 * `SellerOrder.status` 를 보지 않는다. 전량 반품된 몫은 확정 뒤에 `RETURNED` 로
 * 옮겨 가는데, 지금 상태로 거르면 **확정된 적이 있다는 사실**이 사라진다 — 그 몫은
 * 이미 정산됐을 수 있고, 그러면 차감 줄을 적을 대상 자체를 못 찾는다.
 *
 * ## 기간의 시작으로 거르지 않는다
 *
 * 「지난주에 확정된 것」이 아니라 「**지난주까지** 확정됐고 아직 정산되지 않은 것」을
 * 집는다. 배치가 한 주 멈춰 있었다면 그 주의 확정분은 어느 회차에도 속하지 않게
 * 되는데, 시작으로 거르면 그 돈이 **영영 지급되지 않는다.** 늦게 집힌 몫이 이번
 * 회차에 들어가는 것은 지연이지만, 안 집히는 것은 손실이다.
 */
@Injectable()
export class SettlementBatchService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SettlementBatchService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** 주기를 건다 — **검사에서는 걸지 않는다** (`order-confirm.service.ts` 와 같은 이유). */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    this.timer = setInterval(() => void this.tick(), SETTLEMENT_INTERVAL_MS)
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
      await this.run()
    } catch (error) {
      this.log.error('정산 배치에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 주기. 수동 실행 API 도 이것을 부른다.
   *
   * **잠금을 못 잡으면 아무 일도 하지 않는다.** 다른 인스턴스가 같은 회차를 만들고
   * 있다는 뜻이고, 기다렸다 또 만들 이유가 없다.
   */
  async run(): Promise<SettlementTally> {
    const now = this.clock.now()
    const period = weekBefore(now)
    const locked = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${SETTLEMENT_LOCK_KEY}) AS "locked"`

    if (locked[0]?.locked !== true) return NOTHING_SETTLED

    try {
      const tally = await this.settle(period, now)

      await this.record(now, tally)

      return tally
    } finally {
      await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${SETTLEMENT_LOCK_KEY})`
    }
  }

  /** 이번 주기가 손댈 몫들을 모아 판매자별로 처리한다. */
  private async settle(period: SettlementPeriod, now: Date): Promise<SettlementTally> {
    const candidates = [...(await this.unsettled(period)), ...(await this.moved())]

    if (candidates.length === 0) return NOTHING_SETTLED

    const sources = await loadSettlementSources(
      this.prisma,
      candidates.map((entry) => entry.sellerOrderId),
    )
    const bySeller = new Map<string, Candidate[]>()

    for (const candidate of candidates) {
      const held = bySeller.get(candidate.sellerId)

      if (held === undefined) bySeller.set(candidate.sellerId, [candidate])
      else held.push(candidate)
    }

    let tally = NOTHING_SETTLED

    for (const [sellerId, own] of bySeller) {
      // **한 판매자의 실패가 다른 판매자를 막지 않는다.** 승인된 회차에 더 적으려 한
      // 경우가 정상적인 실패이고(그 판매자는 이번 주기를 건너뛴다), 나머지는 다음
      // 주기가 다시 만난다 — 이 배치는 무엇을 했는지 기록으로만 남기고, 기다리는
      // 사람이 없다.
      try {
        tally = merged(tally, await this.settleSeller(sellerId, own, sources, period, now))
      } catch (error) {
        this.log.warn(`판매자 ${sellerId} 의 정산을 건너뜁니다.`, error)
      }
    }

    return tally
  }

  /**
   * 한 판매자의 이번 회차.
   *
   * 트랜잭션이 판매자마다인 이유는 **한 판매자의 실패가 다른 판매자를 막지 않게**
   * 하기 위해서다. PostgreSQL 에는 중첩 트랜잭션이 없어 한 문장이 던지면 트랜잭션
   * 전체가 못 쓰게 되므로, 전부를 한 트랜잭션에 넣으면 한 몫의 거절이 그 주 전체를
   * 되돌린다.
   */
  private async settleSeller(
    sellerId: string,
    candidates: readonly Candidate[],
    sources: ReadonlyMap<string, readonly SettlementItemSource[]>,
    period: SettlementPeriod,
    now: Date,
  ): Promise<SettlementTally> {
    return this.prisma.$transaction(async (tx) => {
      const settlement = await this.openSettlement(tx, sellerId, period, now)
      const touched = new Set<string>([settlement.id])
      let tally: SettlementTally = { ...NOTHING_SETTLED, settlements: 1 }

      for (const candidate of candidates) {
        const shouldBe = amountsOf(sources.get(candidate.sellerOrderId) ?? [])
        const outcome = await this.writeLine(tx, settlement.id, candidate, shouldBe, touched)

        tally = { ...tally, [outcome]: tally[outcome] + 1 }
      }

      for (const settlementId of touched) await this.retotal(tx, settlementId)

      return tally
    })
  }

  /**
   * 한 몫의 차이를 적는다. **어디에 적느냐가 세 갈래**다.
   *
   * 돌아오는 것은 무엇을 했는가이고, 그 이름이 집계의 칸 이름과 같아서 부르는 쪽에
   * 분기가 없다.
   */
  private async writeLine(
    tx: Tx,
    settlementId: string,
    candidate: Candidate,
    shouldBe: SettlementAmounts,
    touched: Set<string>,
  ): Promise<'settled' | 'amended' | 'adjusted'> {
    if (candidate.settled === null) {
      await this.insert(tx, settlementId, candidate.sellerOrderId, 'SALE', shouldBe)

      return 'settled'
    }

    // 승인 전이면 **그 줄을 다시 만든다.** 고쳐 쓰지 않고 지웠다 넣는 이유는
    // `createdAt` 이 「이 금액이 언제 계산됐나」를 뜻해야 하기 때문이다 — 그 시각이
    // 다음 주기의 「이 뒤에 온 반품」 판정에 쓰인다.
    if (candidate.settled.amendable) {
      await tx.settlementItem.delete({ where: { id: candidate.settled.itemId } })
      await this.insert(
        tx,
        candidate.settled.settlementId,
        candidate.sellerOrderId,
        'SALE',
        shouldBe,
      )
      touched.add(candidate.settled.settlementId)

      return 'amended'
    }

    // 되돌릴 수 없는 회차 뒤에 온 반품. 이번 회차에 차감으로 적는다 (F7).
    //
    // **이번 회차의 차감 줄은 빼고 센다.** 같은 회차에서 두 번째 반품이 오면 그
    // 줄을 다시 계산해야 하는데, 자기 자신을 포함해 세면 뺀 것을 또 뺀다.
    const settled = await this.settledSoFar(tx, candidate.sellerOrderId, settlementId)
    const difference = differenceOf(shouldBe, settled)

    await tx.settlementItem.deleteMany({
      where: { settlementId, sellerOrderId: candidate.sellerOrderId, type: 'RETURN_ADJUSTMENT' },
    })
    await this.insert(tx, settlementId, candidate.sellerOrderId, 'RETURN_ADJUSTMENT', difference)

    return 'adjusted'
  }

  private async insert(
    tx: Tx,
    settlementId: string,
    sellerOrderId: string,
    type: 'SALE' | 'RETURN_ADJUSTMENT',
    amounts: SettlementAmounts,
  ): Promise<void> {
    await tx.settlementItem.create({
      data: { settlementId, sellerOrderId, type, ...amounts },
    })
  }

  /** 이 몫에 대해 지금까지 적힌 금액의 합 — **이번 회차의 차감 줄은 뺀다.** */
  private async settledSoFar(
    tx: Tx,
    sellerOrderId: string,
    exceptSettlementId: string,
  ): Promise<SettlementAmounts> {
    const rows = await tx.settlementItem.findMany({
      where: {
        sellerOrderId,
        NOT: { settlementId: exceptSettlementId, type: 'RETURN_ADJUSTMENT' },
      },
      select: { salesAmount: true, commissionAmount: true, sellerCouponAmount: true },
    })

    return sumOf(rows.map((row) => ({ ...row, payoutAmount: 0 })))
  }

  /**
   * 이번 회차의 정산서를 연다. 있으면 그것을 쓴다.
   *
   * **이미 승인된 회차에는 아무것도 더하지 않는다.** 그래서 그런 정산서가 있으면
   * 새 정산서를 만들 수 없고, 이 판매자의 이번 회차는 통째로 건너뛴다 — 승인된
   * 금액이 뒤에서 바뀌면 승인이라는 행위에 뜻이 없어진다.
   */
  private async openSettlement(
    tx: Tx,
    sellerId: string,
    period: SettlementPeriod,
    now: Date,
  ): Promise<{ id: string }> {
    const held = await tx.settlement.findUnique({
      where: { sellerId_periodStart: { sellerId, periodStart: period.start } },
      select: { id: true, status: true },
    })

    if (held !== null) {
      if (held.status !== 'PENDING') {
        throw new SettlementClosedError(sellerId, period.start)
      }

      return { id: held.id }
    }

    return tx.settlement.create({
      data: {
        sellerId,
        periodStart: period.start,
        periodEnd: period.end,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    })
  }

  /** 정산서의 합계를 그 줄들에서 다시 센다 (F8). */
  private async retotal(tx: Tx, settlementId: string): Promise<void> {
    const rows = await tx.settlementItem.findMany({
      where: { settlementId },
      select: {
        type: true,
        salesAmount: true,
        commissionAmount: true,
        sellerCouponAmount: true,
        payoutAmount: true,
      },
    })
    const sales = rows.filter((row) => row.type === 'SALE')
    const sold = sumOf(sales.map((row) => ({ ...row, payoutAmount: 0 })))
    const returnAdjustmentAmount = rows
      .filter((row) => row.type === 'RETURN_ADJUSTMENT')
      .reduce((sum, row) => sum + row.payoutAmount, 0)

    await tx.settlement.update({
      where: { id: settlementId },
      data: {
        salesAmount: sold.salesAmount,
        commissionAmount: sold.commissionAmount,
        sellerCouponAmount: sold.sellerCouponAmount,
        returnAdjustmentAmount,
        payoutAmount: sold.payoutAmount + returnAdjustmentAmount,
      },
    })
  }

  /** 구매확정된 적이 있고 아직 판매 줄이 없는 몫. */
  private async unsettled(period: SettlementPeriod): Promise<readonly Candidate[]> {
    const rows = await this.prisma.$queryRaw<{ sellerOrderId: string; sellerId: string }[]>`
      SELECT so."id"::text AS "sellerOrderId", so."sellerId"::text AS "sellerId"
        FROM "SellerOrder" so
       WHERE EXISTS (
               SELECT 1 FROM "OrderStatusHistory" h
                WHERE h."sellerOrderId" = so."id"
                  AND h."toStatus" = 'CONFIRMED'
                  AND h."createdAt" < ${period.end})
         AND NOT EXISTS (
               SELECT 1 FROM "SettlementItem" si
                WHERE si."sellerOrderId" = so."id" AND si."type" = 'SALE')
       ORDER BY so."sellerId", so."id"
       LIMIT ${SETTLEMENT_BATCH_LIMIT}`

    return rows.map((row) => ({ ...row, settled: null }))
  }

  /**
   * 이미 정산된 몫 중 **그 뒤에 반품이 확정된** 것.
   *
   * 「판매 줄이 계산된 시각보다 나중에 환불된 클레임이 있는가」로 거른다. 그보다
   * 먼저 환불된 것은 그 줄에 이미 반영돼 있다 — 이 조건이 없으면 반품이 한 번이라도
   * 있었던 몫을 **매 주기 영원히** 다시 계산한다.
   */
  private async moved(): Promise<readonly Candidate[]> {
    const rows = await this.prisma.$queryRaw<
      {
        sellerOrderId: string
        sellerId: string
        itemId: string
        settlementId: string
        amendable: boolean
      }[]
    >`
      SELECT si."sellerOrderId"::text AS "sellerOrderId",
             so."sellerId"::text      AS "sellerId",
             si."id"::text            AS "itemId",
             si."settlementId"::text  AS "settlementId",
             (s."status" = 'PENDING')  AS "amendable"
        FROM "SettlementItem" si
        JOIN "SellerOrder" so ON so."id" = si."sellerOrderId"
        JOIN "Settlement" s   ON s."id" = si."settlementId"
       WHERE si."type" = 'SALE'
         AND EXISTS (
               SELECT 1
                 FROM "ClaimItem" ci
                 JOIN "ClaimRequest" c  ON c."id" = ci."claimId"
                 JOIN "ClaimRefund" cr  ON cr."claimId" = c."id"
                 JOIN "OrderItem" oi    ON oi."id" = ci."orderItemId"
                WHERE oi."sellerOrderId" = si."sellerOrderId"
                  AND c."status" = 'REFUNDED'
                  AND cr."refundedAt" > si."createdAt")
       ORDER BY so."sellerId", si."sellerOrderId"
       LIMIT ${SETTLEMENT_BATCH_LIMIT}`

    return rows.map((row) => ({
      sellerOrderId: row.sellerOrderId,
      sellerId: row.sellerId,
      settled: { itemId: row.itemId, settlementId: row.settlementId, amendable: row.amendable },
    }))
  }

  /** 이 주기가 돌았다는 사실. 헬스체크가 이 두 행을 읽는다. */
  private async record(now: Date, tally: SettlementTally): Promise<void> {
    const settled = String(tally.settled + tally.amended + tally.adjusted)

    for (const [key, value] of [
      [SETTLEMENT_LAST_RUN_KEY, now.toISOString()],
      [SETTLEMENT_LAST_SETTLED_KEY, settled],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}

/** 승인된 회차에 더 적으려 했다. 그 판매자의 이번 주기는 통째로 건너뛴다. */
class SettlementClosedError extends Error {
  constructor(sellerId: string, periodStart: Date) {
    super(`이미 승인된 정산서입니다: ${sellerId} / ${periodStart.toISOString()}`)
  }
}

/** 두 집계를 더한다. 칸 이름이 같아서 분기가 없다. */
function merged(left: SettlementTally, right: SettlementTally): SettlementTally {
  return {
    settled: left.settled + right.settled,
    amended: left.amended + right.amended,
    adjusted: left.adjusted + right.adjusted,
    settlements: left.settlements + right.settlements,
  }
}
