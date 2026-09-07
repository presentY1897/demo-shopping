import { Inject, Injectable } from '@nestjs/common'
import type {
  DashboardDay,
  DashboardMetrics,
  DashboardMetricsResponse,
  DashboardPendingResponse,
  DashboardProduct,
  DashboardQueryParams,
  DashboardSeller,
  DashboardSystemResponse,
  SchedulerHealth,
} from '@shopping/shared'
import { DASHBOARD_MAX_DAYS, DASHBOARD_TOP_LIMIT, grantedScopes } from '@shopping/shared'

import { accessDenied } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { adminOverdueScanBefore } from '../claims/admin-claim-rules.js'
import { claimStatusesInStage } from '../claims/claim-console.js'
import { claimDueAtOf, isClaimOverdue } from '../claims/claim-deadline.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { DayRange } from '../common/kst-days.js'
import { fillDays, previousRange, rangeOf } from '../common/kst-days.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SearchOutboxService } from '../search/search-outbox.service.js'
import { SCHEDULERS, statusOf } from './scheduler-registry.js'

/** 기본 조회 기간 — 최근 30일. */
const DEFAULT_DAYS = 30

/**
 * 매출로 세는 주문 상태.
 *
 * **`seller-revenue.service.ts` 와 같은 목록이어야 한다.** 다르면 판매자가 자기
 * 화면에서 본 매출의 합과 관리자가 본 거래액이 어긋나고, 둘 다 오류를 내지 않는다.
 * `dashboard-parity.spec.ts` 가 두 목록을 견준다.
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
  readonly activeSellers: number
}

const NO_TOTALS: TotalsRow = { salesAmount: 0, orderCount: 0, activeSellers: 0 }

/**
 * 관리자 대시보드 (TASK-0092).
 *
 * ## 판매자 화면과 같은 규칙으로 센다
 *
 * 날짜 자르기(`kst-days.ts`)도 매출로 세는 상태 목록도 판매자 매출 화면과 같은
 * 것이다. 관리자의 거래액은 **모든 판매자의 매출을 합한 것**이어야 하고, 규칙이
 * 갈라지면 그 합이 안 맞는다 — 그리고 그 어긋남은 두 화면을 나란히 놓고 더해 보기
 * 전까지 아무도 모른다.
 *
 * ## 「처리 대기」는 기간을 받지 않는다
 *
 * 3주 전에 들어온 신청도 아직 안 봤으면 **오늘의 할 일**이다. 기간을 받으면 그 기간
 * 밖의 밀린 일이 화면에서 사라지고, 대시보드가 존재하는 이유가 사라진다.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SearchOutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * **퍼미션 이름만으로는 부족하다** (F6).
   *
   * 구매자도 `order.read` 를 갖고 있다 — 다만 `own` 으로 좁혀져 있을 뿐이다. 라우트의
   * `@RequirePermission` 은 이름만 보므로 그것만으로는 구매자가 이 문을 지난다. 여기서
   * 재는 것은 **스코프**이고, 그것이 `any` 여야 「플랫폼 전체를 읽는다」가 된다.
   *
   * `admin-claim.service.ts` 의 `assertPlatformRead` 가 같은 사정을 같은 방식으로
   * 다룬다 — 관리자 전용 읽기는 전부 이 모양이다.
   */
  private assertPlatformRead(principal: RequestPrincipal): void {
    if (!grantedScopes(principal, 'order.read').includes('any')) {
      throw accessDenied('order.read', 'out_of_scope')
    }
  }

  async metrics(
    principal: RequestPrincipal,
    params: DashboardQueryParams,
  ): Promise<DashboardMetricsResponse> {
    this.assertPlatformRead(principal)

    const range = rangeOf(params, this.clock.now(), {
      defaultDays: DEFAULT_DAYS,
      maxDays: DASHBOARD_MAX_DAYS,
    })
    const before = previousRange(range)

    const [current, previous, days, topProducts, topSellers] = await Promise.all([
      this.metricsOf(range),
      this.metricsOf(before),
      this.daysOf(range),
      this.topProductsOf(range),
      this.topSellersOf(range),
    ])

    return {
      from: range.from,
      to: range.to,
      current,
      previous,
      days: fillDays(days, range.from, range.dayCount, (date) => emptyDay(date)),
      topProducts,
      topSellers,
    }
  }

  /**
   * 지금 사람이 해야 할 일 (F2).
   *
   * 클레임만 두 걸음이다. 기한은 **영업일**로 세는데 SQL 은 주말도 시간대도 모르므로,
   * 넘치게 읽고 순수 함수가 정확히 거른다 — 그 판정을 질의로 내리면 정의가 두 벌이
   * 되고, 지연 뱃지와 지연 목록이 서로 다른 건을 가리킨다
   * (`admin-claim-rules.ts` 의 `adminOverdueScanBefore`).
   */
  async pending(principal: RequestPrincipal): Promise<DashboardPendingResponse> {
    this.assertPlatformRead(principal)

    const now = this.clock.now()
    const pace = this.config.fulfillmentPace

    const [sellerApplications, reports, settlements, candidates] = await Promise.all([
      this.prisma.seller.count({ where: { status: 'PENDING' } }),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
      this.prisma.settlement.count({ where: { status: 'PENDING' } }),
      // 아직 판매자의 답을 기다리는 것만. 결론이 난 클레임은 늦었어도 할 일이
      // 아니다 — 어느 상태가 「기다리는 중」인지는 `claim-console.ts` 가 정한다.
      this.prisma.claimRequest.findMany({
        where: {
          status: { in: [...claimStatusesInStage('WAITING')] },
          createdAt: { lt: adminOverdueScanBefore(now, pace) },
        },
        select: { createdAt: true },
      }),
    ])

    return {
      sellerApplications,
      reports,
      settlements,
      claims: candidates.filter((row) =>
        isClaimOverdue(claimDueAtOf(row.createdAt, this.config), now),
      ).length,
    }
  }

  async system(principal: RequestPrincipal): Promise<DashboardSystemResponse> {
    this.assertPlatformRead(principal)

    const now = this.clock.now()
    const rows = await this.prisma.appMeta.findMany({
      where: { key: { in: SCHEDULERS.map((entry) => entry.key) } },
      select: { key: true, value: true },
    })
    const byKey = new Map(rows.map((row) => [row.key, row.value]))

    const [indexBacklog, activeAccounts, expiringWithinHour] = await Promise.all([
      // 색인 큐는 배치가 아니라 **줄 서 있는 일**이라 따로 답한다 (2장 「인덱싱 큐」).
      this.outbox.backlog(),
      this.prisma.user.count({ where: { isDemo: true, deletedAt: null } }),
      this.prisma.user.count({
        where: {
          isDemo: true,
          deletedAt: null,
          demoExpiresAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) },
        },
      }),
    ])

    return {
      schedulers: SCHEDULERS.map((entry): SchedulerHealth => {
        const lastRunAt = parseInstant(byKey.get(entry.key))

        return {
          key: entry.key,
          status: statusOf(lastRunAt, now, entry.staleAfterMs),
          lastRunAt: lastRunAt?.toISOString() ?? null,
        }
      }),
      searchIndex: {
        pending: indexBacklog.pending,
        oldestAt: indexBacklog.oldestAt?.toISOString() ?? null,
      },
      demo: { activeAccounts, expiringWithinHour },
    }
  }

  /**
   * 「활성 판매자」는 **판 스토어**다.
   *
   * 등록된 스토어 수가 아니다 — 그 수는 한 번 오르면 안 내려가므로 어느 날 전부
   * 장사를 접어도 그대로다. 기간 안에 한 건이라도 팔았는가가 이 화면이 답하려는
   * 질문이고, 그래서 기간이 바뀌면 이 수도 바뀐다.
   */
  private async metricsOf(range: DayRange): Promise<DashboardMetrics> {
    const [totals, newUsers] = await Promise.all([
      this.totalsOf(range),
      // 데모 계정은 **가입이 아니다.** 버튼 한 번에 발급되는 것이라 함께 세면
      // 「신규 가입」이 데모를 눌러 본 횟수가 되고, 진짜 가입은 그 안에 묻힌다.
      this.prisma.user.count({
        where: { isDemo: false, createdAt: { gte: startOf(range.from), lt: endOf(range.to) } },
      }),
    ])

    return { ...totals, newUsers }
  }

  private async totalsOf(range: DayRange): Promise<TotalsRow> {
    const [row] = await this.prisma.$queryRaw<TotalsRow[]>`
      SELECT COALESCE(SUM(so."productAmount"), 0)::int  AS "salesAmount",
             COUNT(*)::int                              AS "orderCount",
             COUNT(DISTINCT so."sellerId")::int         AS "activeSellers"
        FROM "SellerOrder" so
       WHERE so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${range.from}::date AND ${range.to}::date`

    return row ?? NO_TOTALS
  }

  private daysOf(range: DayRange): Promise<readonly DayRow[]> {
    return this.prisma.$queryRaw<DayRow[]>`
      SELECT to_char(
               (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
               'YYYY-MM-DD')              AS "date",
             SUM(so."productAmount")::int AS "salesAmount",
             COUNT(*)::int                AS "orderCount"
        FROM "SellerOrder" so
       WHERE so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${range.from}::date AND ${range.to}::date
       GROUP BY 1
       ORDER BY 1`
  }

  /**
   * 상품 **이름은 스냅샷에서, id 는 컬럼에서** 읽는다.
   *
   * 팔릴 때의 이름이라야 「이 이름으로 팔린 것이 몇 개」가 맞고, 지워진 상품도 목록에
   * 남는다 — 판매자 매출 화면이 같은 판단을 먼저 했다.
   */
  private topProductsOf(range: DayRange): Promise<DashboardProduct[]> {
    return this.prisma.$queryRaw<DashboardProduct[]>`
      SELECT oi."productId"::text                        AS "productId",
             MIN(oi."productSnapshot" ->> 'productName') AS "name",
             MIN(so."brandName")                         AS "brandName",
             SUM(oi."productAmount")::int                AS "salesAmount",
             COUNT(DISTINCT so."id")::int                AS "orderCount"
        FROM "OrderItem" oi
        JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
       WHERE so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${range.from}::date AND ${range.to}::date
       GROUP BY 1
       ORDER BY "salesAmount" DESC, "productId"
       LIMIT ${DASHBOARD_TOP_LIMIT}`
  }

  /** 스토어 이름도 주문에 박힌 것을 쓴다 — 이름을 바꾼 스토어의 과거 매출이 흔들리지 않는다. */
  private topSellersOf(range: DayRange): Promise<DashboardSeller[]> {
    return this.prisma.$queryRaw<DashboardSeller[]>`
      SELECT so."sellerId"::text            AS "sellerId",
             MIN(so."brandName")            AS "brandName",
             SUM(so."productAmount")::int   AS "salesAmount",
             COUNT(*)::int                  AS "orderCount"
        FROM "SellerOrder" so
       WHERE so."status"::text = ANY(${SOLD_STATUSES})
         AND (so."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
             BETWEEN ${range.from}::date AND ${range.to}::date
       GROUP BY 1
       ORDER BY "salesAmount" DESC, "sellerId"
       LIMIT ${DASHBOARD_TOP_LIMIT}`
  }
}

function emptyDay(date: string): DashboardDay {
  return { date, salesAmount: 0, orderCount: 0 }
}

/** KST 하루의 시작·끝을 UTC 순간으로. 가입 시각은 날짜로 잘려 있지 않다. */
function startOf(date: string): Date {
  return new Date(`${date}T00:00:00.000+09:00`)
}

function endOf(date: string): Date {
  return new Date(new Date(`${date}T00:00:00.000+09:00`).getTime() + 24 * 60 * 60_000)
}

/** `AppMeta.value` 는 문자열이다. 읽을 수 없는 값은 「없다」로 본다. */
function parseInstant(value: string | undefined): Date | null {
  if (value === undefined) return null

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}
