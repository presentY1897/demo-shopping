import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  RevenueDay,
  RevenueProduct,
  RevenueTotals,
  SellerRevenueQueryParams,
  SellerRevenueResponse,
  SettlementOutlookResponse,
  SettlementOutlookStage,
} from '@shopping/shared'
import { platformOwnership, REVENUE_MAX_DAYS, REVENUE_TOP_PRODUCTS } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { amountsOf } from './settlement-calc.js'
import { loadSettlementSources } from './settlement-sources.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

/** 기본 조회 기간 — 최근 30일. */
const DEFAULT_DAYS = 30

/**
 * 매출로 세는 주문 상태.
 *
 * 결제를 기다리는 것과 실패한 것과 취소된 것은 판매가 아니다. 반품(`RETURNED`)은
 * **센다** — 팔린 적이 있는 것이고, 그 되돌림은 정산의 차감으로 따로 나타난다.
 * 매출 그래프에서까지 지우면 「지난달에 얼마 팔았나」의 답이 반품이 들어올 때마다
 * 과거로 거슬러 바뀐다.
 */
const SOLD_STATUSES = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURNED']

interface DayRow {
  readonly date: string
  readonly salesAmount: number
  readonly orderCount: number
}

interface TotalsRow {
  readonly salesAmount: number
  readonly orderCount: number
}

/**
 * 판매자의 매출과 정산 예정 (TASK-0082).
 *
 * ## 두 개의 시계
 *
 * 매출은 **주문이 일어난 날**로 세고, 정산은 **구매확정된 날**로 센다. 합치면 둘 다
 * 틀린다 — 주문 기준으로 정산하면 아직 확정되지 않은 돈을 받을 것처럼 말하게 되고,
 * 확정 기준으로 매출을 그리면 오늘 판 것이 일주일 뒤 그래프에 나타난다.
 *
 * ## 예정 금액은 정산서와 같은 계산을 쓴다
 *
 * 「지금 정산된다면 얼마」를 여기서 따로 계산하면 예정 금액과 실제 정산액이 조용히
 * 갈라지고, 판매자는 화면에서 본 숫자와 다른 돈을 받는다 — 그것은 문의가 아니라
 * 신뢰의 문제다. 그래서 입력도(`settlement-sources.ts`) 계산도(`amountsOf`) 배치와
 * 같은 것을 쓴다.
 */
@Injectable()
export class SellerRevenueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 기간별 매출과 **바로 앞 같은 길이 기간**의 합 (F5 · F6). */
  async revenue(
    principal: RequestPrincipal,
    params: SellerRevenueQueryParams,
  ): Promise<SellerRevenueResponse> {
    const sellerId = await this.resolveSeller(principal, params.sellerId)
    const range = this.rangeOf(params)
    const span = range.dayCount
    const previous = {
      from: shiftDate(range.from, -span),
      to: shiftDate(range.from, -1),
    }

    const [days, totals, before, topProducts] = await Promise.all([
      this.daysOf(sellerId, range.from, range.to),
      this.totalsOf(sellerId, range.from, range.to),
      this.totalsOf(sellerId, previous.from, previous.to),
      this.topProductsOf(sellerId, range.from, range.to),
    ])

    return {
      from: range.from,
      to: range.to,
      days: [...fillGaps(days, range.from, span)],
      totals: withAverage(totals),
      previous: withAverage(before),
      topProducts: [...topProducts],
    }
  }

  /**
   * 아직 정산서에 실리지 않은 돈 (F4).
   *
   * **두 단계로 나눈다.** 하나로 합치면 「받기로 확정된 돈」과 「아직 취소될 수 있는
   * 돈」이 같은 숫자에 섞이고, 판매자는 그 합을 확정된 금액으로 읽는다.
   */
  async outlook(
    principal: RequestPrincipal,
    sellerId: string | undefined,
  ): Promise<SettlementOutlookResponse> {
    const resolved = await this.resolveSeller(principal, sellerId)
    const [awaitingConfirmation, awaitingSettlement] = await Promise.all([
      this.stageOf(await this.deliveredIds(resolved)),
      this.stageOf(await this.unsettledIds(resolved)),
    ])

    return { awaitingConfirmation, awaitingSettlement }
  }

  /** 배송완료됐으나 아직 확정 전인 몫. 아직 반품될 수 있는 돈이다. */
  private async deliveredIds(sellerId: string): Promise<readonly string[]> {
    const rows = await this.prisma.sellerOrder.findMany({
      where: { sellerId, status: 'DELIVERED' },
      select: { id: true },
    })

    return rows.map((row) => row.id)
  }

  /**
   * 구매확정됐으나 아직 정산서에 없는 몫.
   *
   * 배치가 고르는 것과 **같은 조건**이다 (`settlement-batch.service.ts`) — 확정을
   * 상태가 아니라 이력으로 판정하고, 이미 정산된 것을 뺀다. 다르면 화면이 「다음
   * 회차에 들어온다」고 말한 몫이 실제로는 안 들어오거나 그 반대가 된다.
   */
  private async unsettledIds(sellerId: string): Promise<readonly string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT so."id"::text AS "id"
        FROM "SellerOrder" so
       WHERE so."sellerId" = ${sellerId}::uuid
         AND EXISTS (
               SELECT 1 FROM "OrderStatusHistory" h
                WHERE h."sellerOrderId" = so."id" AND h."toStatus" = 'CONFIRMED')
         AND NOT EXISTS (
               SELECT 1 FROM "SettlementItem" si
                WHERE si."sellerOrderId" = so."id" AND si."type" = 'SALE')`

    return rows.map((row) => row.id)
  }

  /** 이 몫들을 지금 정산하면 얼마인가. 정산서가 쓰는 것과 같은 계산이다. */
  private async stageOf(sellerOrderIds: readonly string[]): Promise<SettlementOutlookStage> {
    const sources = await loadSettlementSources(this.prisma, sellerOrderIds)
    let payoutAmount = 0

    for (const items of sources.values()) payoutAmount += amountsOf(items).payoutAmount

    return { sellerOrderCount: sellerOrderIds.length, payoutAmount }
  }

  /** 하루씩 나눈 매출. 판매가 없던 날은 여기 없고, 부르는 쪽이 채운다. */
  private async daysOf(sellerId: string, from: string, to: string): Promise<readonly DayRow[]> {
    return this.prisma.$queryRaw<DayRow[]>`
      SELECT to_char(
               (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
               'YYYY-MM-DD')            AS "date",
             SUM(so."productAmount")::int AS "salesAmount",
             COUNT(*)::int                AS "orderCount"
        FROM "SellerOrder" so
       WHERE so."sellerId" = ${sellerId}::uuid
         AND so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1
       ORDER BY 1`
  }

  private async totalsOf(sellerId: string, from: string, to: string): Promise<TotalsRow> {
    const [row] = await this.prisma.$queryRaw<TotalsRow[]>`
      SELECT COALESCE(SUM(so."productAmount"), 0)::int AS "salesAmount",
             COUNT(*)::int                             AS "orderCount"
        FROM "SellerOrder" so
       WHERE so."sellerId" = ${sellerId}::uuid
         AND so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${from}::date AND ${to}::date`

    return row ?? { salesAmount: 0, orderCount: 0 }
  }

  /**
   * 많이 팔린 상품.
   *
   * 상품 **이름**은 스냅샷에서 읽는다. 지금의 상품명이 아니라 팔릴 때의 이름이라야
   * 「이 이름으로 팔린 것이 몇 개」가 맞고, 지워진 상품도 목록에 남는다.
   *
   * 반면 **id 는 컬럼에서** 읽는다 (TASK-0083 이 `OrderItem.productId` 를 만들었다).
   * JSON 에서 꺼내던 시절에는 그 값이 스냅샷을 만든 코드에 달려 있었고, 복합
   * 외래키가 그것을 조합의 상품으로 못 박은 지금은 그럴 이유가 없다.
   */
  private async topProductsOf(
    sellerId: string,
    from: string,
    to: string,
  ): Promise<readonly RevenueProduct[]> {
    return this.prisma.$queryRaw<RevenueProduct[]>`
      SELECT oi."productId"::text                     AS "productId",
             MIN(oi."productSnapshot" ->> 'productName') AS "productName",
             SUM(oi."quantity")::int                  AS "quantity",
             SUM(oi."productAmount")::int             AS "salesAmount"
        FROM "OrderItem" oi
        JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
       WHERE so."sellerId" = ${sellerId}::uuid
         AND so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1
       ORDER BY "salesAmount" DESC, "productId"
       LIMIT ${REVENUE_TOP_PRODUCTS}`
  }

  /**
   * 어느 스토어의 숫자인가.
   *
   * 스토어를 지정하지 않으면 **자기 것**이다. 그것이 판매자 콘솔의 정상 경로이고,
   * 그렇게 두면 화면이 자기 스토어 id 를 요청에 실어 보낼 이유가 없어진다 — 실어
   * 보내지 않는 값은 조작할 수도 없다.
   */
  private async resolveSeller(
    principal: RequestPrincipal,
    sellerId: string | undefined,
  ): Promise<string> {
    const target = sellerId ?? principal.sellerId

    if (target === null || target === undefined) {
      // 스토어가 없는 계정이 스토어를 지정하지 않았다 — 관리자가 어느 스토어를 볼지
      // 말하지 않은 경우다. 플랫폼 전체의 매출은 이 라우트가 답하는 것이 아니다.
      assertResourceAccess(principal, 'settlement.read', platformOwnership)

      throw new NotFoundException('판매자를 지정해 주세요.')
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: target },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    assertResourceAccess(principal, 'settlement.read', sellerOwnership(seller))

    return target
  }

  /** 조회 기간. 주지 않으면 오늘까지의 최근 30일이다. */
  private rangeOf(params: SellerRevenueQueryParams): {
    from: string
    to: string
    dayCount: number
  } {
    const to = params.to ?? kstDate(this.clock.now())
    const from = params.from ?? shiftDate(to, -(DEFAULT_DAYS - 1))
    const span = dayIndexOf(to) - dayIndexOf(from) + 1

    // 뒤집힌 기간은 하루짜리로 접는다. 던지지 않는 이유는 이것이 **읽기**이기
    // 때문이다 — 날짜 두 칸을 잘못 고른 사람에게 화면이 빈 답을 주면 그만이고,
    // 500 을 내면 그 사람은 자기가 무엇을 잘못했는지 알 수 없다.
    if (span < 1) return { from: to, to, dayCount: 1 }

    // 너무 긴 기간은 잘라 낸다. 상한이 없으면 한 요청이 몇 년치를 하루씩 그린다.
    if (span > REVENUE_MAX_DAYS) {
      return { from: shiftDate(to, -(REVENUE_MAX_DAYS - 1)), to, dayCount: REVENUE_MAX_DAYS }
    }

    return { from, to, dayCount: span }
  }
}

/** 이 순간의 KST 달력 날짜, `YYYY-MM-DD`. */
function kstDate(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 1970-01-01 부터 센 일수. 문자열 날짜의 산술은 전부 여기를 지난다. */
function dayIndexOf(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS)
}

function shiftDate(date: string, days: number): string {
  return new Date((dayIndexOf(date) + days) * DAY_MS).toISOString().slice(0, 10)
}

/**
 * 판매가 없던 날을 0으로 채운다.
 *
 * 빈 날을 빼면 그래프가 그 구간을 건너뛰어 그리고, 「이 주에 3일 쉬었다」가 「매출이
 * 완만했다」로 보인다. 화면마다 다시 채우게 두지 않는 이유는 그 채우기가 조용히
 * 서로 다르게 되기 때문이다.
 */
function fillGaps(rows: readonly DayRow[], from: string, dayCount: number): readonly RevenueDay[] {
  const byDate = new Map(rows.map((row) => [row.date, row]))

  return Array.from({ length: dayCount }, (_unused, offset) => {
    const date = shiftDate(from, offset)
    const row = byDate.get(date)

    return {
      date,
      salesAmount: row?.salesAmount ?? 0,
      orderCount: row?.orderCount ?? 0,
    }
  })
}

/** 평균 주문금액을 붙인다. **주문이 없으면 0이다** — 0으로 나누지 않는다. */
function withAverage(totals: TotalsRow): RevenueTotals {
  return {
    ...totals,
    averageOrderAmount:
      totals.orderCount === 0 ? 0 : Math.floor(totals.salesAmount / totals.orderCount),
  }
}
