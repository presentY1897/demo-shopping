import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminDemoAccount,
  DemoAccountListResponse,
  DemoPolicy,
  DemoPolicyResponse,
  DemoStatsResponse,
} from '@shopping/shared'
import { ADMIN_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { fillDays, kstDate, rangeOf } from '../common/kst-days.js'
import { DemoCleanupService } from '../demo/demo-cleanup.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_DAYS = 14
const MAX_DAYS = 90

interface AccountRow {
  readonly userId: string
  readonly roles: string[] | null
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly cleanupError: string | null
  readonly cleanupFailedAt: Date | null
}

/**
 * 데모 계정 관리 (TASK-0096).
 *
 * ## 정리를 여기서 다시 만들지 않는다
 *
 * 강제 만료도 재시도도 **청소기의 문을 지난다** (`DemoCleanupService`). 지우는 순서는
 * 표 하나에 데이터로 적혀 있고(`demo-cleanup-plan.ts`), 그 순서를 여기서 다시 쓰면
 * 두 경로가 서로 다른 순서로 지우다가 외래키에 걸린다 — 그리고 그때 절반만 지워진
 * 계정이 남는다.
 *
 * ## 재시도가 따로 없는 이유
 *
 * 실패한 계정은 **만료된 채로 남아 있으므로** 다음 주기가 자동으로 다시 집는다
 * (`demo-cleanup.service.ts` 의 「nothing has to remember it」). F5 의 「재시도
 * 실행」은 그 주기를 기다리지 않고 지금 한 번 돌리는 것이고, 그래서 이 서비스가
 * 하는 일은 **청소기를 한 번 부르는 것**뿐이다.
 */
@Injectable()
export class AdminDemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cleanup: DemoCleanupService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async policy(): Promise<DemoPolicyResponse> {
    return { policy: await this.currentPolicy() }
  }

  /**
   * 정책을 바꾼다 (F6).
   *
   * **이후 발급분에만 적용된다.** 이미 발급된 계정의 만료 시각을 소급해 옮기지
   * 않는다 — 쓰고 있던 사람의 데모가 눈앞에서 사라지는 일이 되고, 그것은 정책 변경이
   * 아니라 사고다.
   */
  async updatePolicy(next: DemoPolicy): Promise<DemoPolicyResponse> {
    const now = this.clock.now()

    await this.prisma.demoPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, ...next, updatedAt: now },
      update: { ...next, updatedAt: now },
    })

    return { policy: await this.currentPolicy() }
  }

  /** 지금 살아 있는 데모 계정들. 만료가 임박한 순이다 — 곧 사라질 것이 먼저 궁금하다. */
  async accounts(params: {
    readonly failedOnly?: boolean
    readonly cursor?: string
    readonly limit?: number
  }): Promise<DemoAccountListResponse> {
    const limit = params.limit ?? ADMIN_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.$queryRaw<AccountRow[]>`
      SELECT u."id"::text            AS "userId",
             array_agg(r."role"::text) FILTER (WHERE r."role" IS NOT NULL) AS "roles",
             u."createdAt"           AS "createdAt",
             u."demoExpiresAt"       AS "expiresAt",
             u."demoCleanupError"    AS "cleanupError",
             u."demoCleanupFailedAt" AS "cleanupFailedAt"
        FROM "User" u
        LEFT JOIN "UserRole" r ON r."userId" = u."id"
       WHERE u."isDemo" = true
         AND u."deletedAt" IS NULL
         AND (${params.failedOnly ?? false}::boolean = false
              OR u."demoCleanupFailedAt" IS NOT NULL)
         AND (${params.cursor ?? null}::text IS NULL OR u."id"::text > ${params.cursor ?? null})
       GROUP BY u."id"
       ORDER BY u."id"
       LIMIT ${limit + 1}`

    const page = rows.slice(0, limit)

    return {
      accounts: page.map((row): AdminDemoAccount => ({
        userId: row.userId,
        roles: row.roles ?? [],
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
        cleanupError: row.cleanupError,
        cleanupFailedAt: row.cleanupFailedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.userId ?? null) : null,
    }
  }

  /**
   * 강제 만료 (F2).
   *
   * 지우지 않고 **만료 시각을 지금으로 당긴다.** 그러면 다음 정리가 평소의 경로로
   * 집어 가고, 지우는 순서가 한 곳에만 있게 된다 — 여기서 직접 지우면 그 순서가
   * 두 벌이 된다.
   */
  async expire(userId: string): Promise<void> {
    if (!(await this.cleanup.expireNow(userId))) {
      throw new NotFoundException('데모 계정을 찾을 수 없습니다.')
    }
  }

  /** 지금 한 번 정리한다 (F5). 실패한 계정은 이미 만료돼 있으므로 함께 집힌다. */
  async sweep(): Promise<{ readonly swept: number; readonly failed: number }> {
    const report = await this.cleanup.sweep()

    return { swept: report.swept, failed: report.failed }
  }

  /** 발급 통계 (F7). 두 축을 함께 답한다 — 따로 물으면 합이 안 맞는다. */
  async stats(params: {
    readonly from?: string
    readonly to?: string
  }): Promise<DemoStatsResponse> {
    const range = rangeOf(params, this.clock.now(), {
      defaultDays: DEFAULT_DAYS,
      maxDays: MAX_DAYS,
    })

    const [days, byRole, activeAccounts, failedCleanups] = await Promise.all([
      this.prisma.$queryRaw<{ date: string; issued: number }[]>`
        SELECT to_char((u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
                       'YYYY-MM-DD') AS "date",
               COUNT(*)::int         AS "issued"
          FROM "User" u
         WHERE u."isDemo" = true
           AND (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
               BETWEEN ${range.from}::date AND ${range.to}::date
         GROUP BY 1
         ORDER BY 1`,
      this.prisma.$queryRaw<{ role: string; issued: number }[]>`
        SELECT r."role"::text AS "role", COUNT(DISTINCT u."id")::int AS "issued"
          FROM "User" u
          JOIN "UserRole" r ON r."userId" = u."id"
         WHERE u."isDemo" = true
           AND (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
               BETWEEN ${range.from}::date AND ${range.to}::date
         GROUP BY 1`,
      this.prisma.user.count({ where: { isDemo: true, deletedAt: null } }),
      this.prisma.user.count({
        where: { isDemo: true, deletedAt: null, demoCleanupFailedAt: { not: null } },
      }),
    ])

    return {
      days: fillDays(days, range.from, range.dayCount, (date) => ({ date, issued: 0 })),
      byRole: Object.fromEntries(byRole.map((row) => [row.role, row.issued])),
      activeAccounts,
      failedCleanups,
    }
  }

  /**
   * 정책 행은 마이그레이션이 심는다. 그래도 없을 때를 대비하는 이유는, 없을 때의
   * 증상이 「데모가 안 된다」로만 보이기 때문이다 — 기본값으로 답하고 계속 간다.
   */
  private async currentPolicy(): Promise<DemoPolicy> {
    const row = await this.prisma.demoPolicy.findUnique({
      where: { id: 1 },
      select: { ttlHours: true, seedOrders: true, virtualCardLimit: true },
    })

    return row ?? { ttlHours: 24, seedOrders: 3, virtualCardLimit: 5_000_000 }
  }
}

/** 오늘의 KST 날짜 — 통계의 기본 끝점이다. */
export const todayInKst = kstDate
