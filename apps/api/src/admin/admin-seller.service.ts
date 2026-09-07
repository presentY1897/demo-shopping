import { Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminSellerListQueryParams,
  AdminSellerListResponse,
  AdminSellerRow,
  SellerStatusHistoryResponse,
} from '@shopping/shared'
import { ADMIN_LIST_DEFAULT_LIMIT, grantedScopes } from '@shopping/shared'
import { Prisma } from '@prisma/client'

import { accessDenied } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { PrismaService } from '../prisma/prisma.service.js'

/** 매출로 세는 상태 — 대시보드와 판매자 화면이 쓰는 것과 같다 (`dashboard-parity.spec.ts`). */
const SOLD_STATUSES = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'RETURNED']

interface SellerRow {
  readonly sellerId: string
  readonly brandName: string
  readonly status: AdminSellerRow['status']
  readonly isDemo: boolean
  readonly followerCount: number
  readonly createdAt: Date
  readonly salesAmount: number
  readonly orderCount: number
  readonly claimCount: number
  readonly productCount: number
  readonly ratingAvg: number
  readonly ratingCount: number
}

/**
 * 관리자 판매자 관리 (TASK-0094).
 *
 * ## 승인·정지·수수료율은 여기 없다
 *
 * 이미 있다 — 승인과 정지는 M04 의 `AdminSellerController`, 개별 수수료율은 M12 의
 * `CommissionController` 다. 이 서비스가 더하는 것은 **지표와 이력**뿐이고, 그 둘이
 * 없어서 관리자가 「어느 스토어를 봐야 하는가」에 답할 수 없었다.
 *
 * ## 지표를 한 질의로 센다
 *
 * 스토어마다 매출·클레임·상품 수를 따로 물으면 스토어가 스무 곳일 때 조회가 예순
 * 번이다 — 그리고 그 회귀는 기능 검사를 하나도 빨갛게 만들지 않는다 (A5).
 */
@Injectable()
export class AdminSellerService {
  constructor(private readonly prisma: PrismaService) {}

  private assertPlatformRead(principal: RequestPrincipal): void {
    if (!grantedScopes(principal, 'seller.read').includes('any')) {
      throw accessDenied('seller.read', 'out_of_scope')
    }
  }

  async list(
    principal: RequestPrincipal,
    params: AdminSellerListQueryParams,
  ): Promise<AdminSellerListResponse> {
    this.assertPlatformRead(principal)

    const limit = params.limit ?? ADMIN_LIST_DEFAULT_LIMIT
    const sort = params.sort ?? 'recent'

    const rows = await this.prisma.$queryRaw<SellerRow[]>`
      SELECT s."id"::text        AS "sellerId",
             s."brandName"       AS "brandName",
             s."status"::text    AS "status",
             u."isDemo"          AS "isDemo",
             s."followerCount"   AS "followerCount",
             s."createdAt"       AS "createdAt",
             COALESCE(o."salesAmount", 0)::int AS "salesAmount",
             COALESCE(o."orderCount", 0)::int  AS "orderCount",
             COALESCE(c."claimCount", 0)::int  AS "claimCount",
             COALESCE(p."productCount", 0)::int AS "productCount",
             COALESCE(p."ratingAvg", 0)::int   AS "ratingAvg",
             COALESCE(p."ratingCount", 0)::int AS "ratingCount"
        FROM "Seller" s
        JOIN "User" u ON u."id" = s."userId"
        -- 스토어마다 한 번씩 묻지 않는다. 셋 다 미리 묶어 두고 이어 붙인다 (A5).
        LEFT JOIN (
          SELECT so."sellerId",
                 SUM(so."productAmount")::int AS "salesAmount",
                 COUNT(*)::int                AS "orderCount"
            FROM "SellerOrder" so
           WHERE so."status"::text = ANY(${SOLD_STATUSES})
           GROUP BY 1
        ) o ON o."sellerId" = s."id"
        LEFT JOIN (
          SELECT so."sellerId", COUNT(DISTINCT cr."id")::int AS "claimCount"
            FROM "ClaimRequest" cr
            JOIN "SellerOrder" so ON so."id" = cr."sellerOrderId"
           GROUP BY 1
        ) c ON c."sellerId" = s."id"
        LEFT JOIN (
          SELECT pr."sellerId",
                 COUNT(*)::int AS "productCount",
                 -- 리뷰 수로 가중한 평균. 상품별 평균의 평균은 리뷰 한 건짜리 상품을
                 -- 리뷰 백 건짜리와 같은 무게로 세어 스토어의 평점을 흔든다.
                 (CASE WHEN SUM(pr."ratingCount") = 0 THEN 0
                       ELSE SUM(pr."ratingAvg" * pr."ratingCount") / SUM(pr."ratingCount")
                  END)::int    AS "ratingAvg",
                 SUM(pr."ratingCount")::int AS "ratingCount"
            FROM "Product" pr
           WHERE pr."deletedAt" IS NULL
           GROUP BY 1
        ) p ON p."sellerId" = s."id"
       WHERE (${params.status ?? null}::text IS NULL OR s."status"::text = ${params.status ?? null})
         AND (${params.isDemo ?? null}::boolean IS NULL OR u."isDemo" = ${params.isDemo ?? null})
         AND (${params.cursor ?? null}::text IS NULL OR s."id"::text < ${params.cursor ?? null})
       ORDER BY
         CASE WHEN ${sort} = 'sales' THEN COALESCE(o."salesAmount", 0) END DESC NULLS LAST,
         -- 클레임률은 **주문이 있는 스토어만** 줄을 선다. 0건짜리 신규 스토어를
         -- 0%로 두면 「문제 없는 스토어」로 맨 위에 올라온다.
         CASE WHEN ${sort} = 'claimRate' AND COALESCE(o."orderCount", 0) > 0
              THEN COALESCE(c."claimCount", 0)::numeric / o."orderCount" END DESC NULLS LAST,
         s."id" DESC
       LIMIT ${limit + 1}`

    const page = rows.slice(0, limit)

    return {
      sellers: page.map((row) => toRow(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.sellerId ?? null) : null,
    }
  }

  /** 제재 이력 (F6). 최근이 위다 — 지금 무슨 상태인지가 먼저 궁금하다. */
  async history(
    principal: RequestPrincipal,
    sellerId: string,
  ): Promise<SellerStatusHistoryResponse> {
    this.assertPlatformRead(principal)

    const exists = await this.prisma.seller.count({ where: { id: sellerId } })

    if (exists === 0) throw new NotFoundException('스토어를 찾을 수 없습니다.')

    const events = await this.prisma.sellerStatusHistory.findMany({
      where: { sellerId },
      // **id 를 함께 본다.** 한 트랜잭션 안에서 두 번 옮기면 `createdAt` 이 같고,
      // 그때 시각만으로 정렬하면 순서가 실행마다 뒤집힌다 — 이력은 순서가 곧 뜻이다.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        actorId: true,
        createdAt: true,
      },
    })

    return {
      events: events.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        actorId: event.actorId,
        createdAt: event.createdAt.toISOString(),
      })),
    }
  }

  /**
   * 상태가 움직였다는 사실을 남긴다.
   *
   * 옮기는 트랜잭션 **안에서** 부른다 — 밖에 두면 「상태는 바뀌었는데 이력은 없다」가
   * 가능해지고, 그 조합이 정확히 이 표가 막으려던 것이다. 제자리 전이는 적지 않는다
   * (`SellerStatusHistory_moved_check` 가 마지막 방어선이다).
   */
  static async record(
    tx: Prisma.TransactionClient,
    input: {
      readonly sellerId: string
      readonly fromStatus: AdminSellerRow['status'] | null
      readonly toStatus: AdminSellerRow['status']
      readonly actorId: string | null
      readonly reason: string | null
      readonly now: Date
    },
  ): Promise<void> {
    if (input.fromStatus === input.toStatus) return

    await tx.sellerStatusHistory.create({
      data: {
        sellerId: input.sellerId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorId: input.actorId,
        reason: input.reason,
        createdAt: input.now,
      },
    })
  }
}

function toRow(row: SellerRow): AdminSellerRow {
  return {
    sellerId: row.sellerId,
    brandName: row.brandName,
    status: row.status,
    isDemo: row.isDemo,
    followerCount: row.followerCount,
    createdAt: row.createdAt.toISOString(),
    metrics: {
      salesAmount: row.salesAmount,
      orderCount: row.orderCount,
      claimCount: row.claimCount,
      // **주문이 없으면 `null` 이다.** 0이 아니다 — 「클레임이 한 건도 없는 좋은
      // 스토어」와 「아직 아무것도 안 판 스토어」는 다른 사실이다.
      claimRateBp:
        row.orderCount === 0 ? null : Math.round((row.claimCount / row.orderCount) * 10_000),
      ratingAvg: row.ratingAvg,
      ratingCount: row.ratingCount,
      productCount: row.productCount,
    },
  }
}
