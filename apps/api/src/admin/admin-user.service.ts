import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdjustPointsRequest,
  AdjustPointsResponse,
  AdminUserDetailResponse,
  AdminUserListQueryParams,
  AdminUserListResponse,
  AdminUserStats,
  AdminUserSummary,
  Role,
  SuspendUserRequest,
} from '@shopping/shared'
import { ADMIN_USER_LIST_DEFAULT_LIMIT, grantedScopes } from '@shopping/shared'

import { accessDenied } from '../auth/access-denied.js'
import { domainFailure } from '../common/domain-failure.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PointsService } from '../points/points.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { maskEmail, maskName } from './personal-data.js'

interface UserRow {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly isDemo: boolean
  readonly suspendedAt: Date | null
  readonly suspendedReason: string | null
  readonly createdAt: Date
  readonly lastLoginAt: Date | null
  readonly roles: readonly { readonly role: Role }[]
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  isDemo: true,
  suspendedAt: true,
  suspendedReason: true,
  createdAt: true,
  lastLoginAt: true,
  roles: { select: { role: true } },
} as const

/**
 * 관리자 회원 관리 (TASK-0093).
 *
 * ## 가리는 것과 남기는 것
 *
 * 목록은 가려서 나가고(F6), 가리지 않은 값은 **사유를 받은 뒤에만** 나간다(F7).
 * 막는 것이 아니라 **가르는 것**이 요점이다 — 운영에는 개인정보를 봐야 하는 일이
 * 실제로 있고, 막을 수 없는 접근을 막는 척하면 사람들이 우회로를 찾는다.
 *
 * ## 데모 관리자는 여기서 쓰지 못한다
 *
 * `user.write` 를 아예 갖고 있지 않다(`permission-matrix.md`). 그래서 정지도 역할
 * 부여도 라우트에서 막히고, 이 서비스는 그 위에 **읽기의 스코프**만 한 번 더 본다.
 */
@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 이름만으로는 부족하다 — 구매자도 `user.read` 를 갖고 있고 `own` 으로 좁혀져
   * 있을 뿐이다 (`dashboard.service.ts` 가 같은 사정을 먼저 만났다).
   */
  private assertPlatformRead(principal: RequestPrincipal): void {
    if (!grantedScopes(principal, 'user.read').includes('any')) {
      throw accessDenied('user.read', 'out_of_scope')
    }
  }

  async list(
    principal: RequestPrincipal,
    params: AdminUserListQueryParams,
  ): Promise<AdminUserListResponse> {
    this.assertPlatformRead(principal)

    const limit = params.limit ?? ADMIN_USER_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(params.isDemo === undefined ? {} : { isDemo: params.isDemo }),
        ...(params.suspended === undefined
          ? {}
          : { suspendedAt: params.suspended ? { not: null } : null }),
        ...(params.role === undefined ? {} : { roles: { some: { role: params.role } } }),
        // **원본을 찾는다.** 가려진 값으로 찾게 하면 검색이 아예 안 된다 — 사람은
        // 자기가 아는 이메일을 치지, 별이 박힌 문자열을 치지 않는다.
        ...(params.q === undefined
          ? {}
          : {
              OR: [
                { email: { contains: params.q, mode: 'insensitive' as const } },
                { name: { contains: params.q, mode: 'insensitive' as const } },
              ],
            }),
        ...(params.cursor === undefined ? {} : { id: { lt: params.cursor } }),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: USER_SELECT,
    })

    const page = rows.slice(0, limit)

    return {
      users: page.map((row) => this.toSummary(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 가리지 않은 값 — 그리고 **그것을 열었다는 기록** (F2 · F7).
   *
   * 기록이 응답과 같은 트랜잭션에 있다. 밖에 두면 「기록은 실패했는데 값은 나갔다」가
   * 가능해지고, 그 조합이 정확히 감사 기록이 막으려던 것이다. 알림과 반대 판단인
   * 이유가 그것이다 — 알림은 못 받아도 원래 일이 되는 편이 낫지만, 열람 기록은
   * 남지 않을 바에야 값이 안 나가는 편이 낫다.
   */
  async detail(
    principal: RequestPrincipal,
    userId: string,
    reason: string,
  ): Promise<AdminUserDetailResponse> {
    this.assertPlatformRead(principal)

    const row = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: USER_SELECT,
    })

    if (row === null) throw new NotFoundException('회원을 찾을 수 없습니다.')

    const stats = await this.statsOf(userId)

    // 자기 자신을 여는 것은 감사 대상이 아니다 (`PersonalDataAccess_not_self_check`).
    if (principal.userId !== userId) {
      await this.prisma.personalDataAccess.create({
        data: {
          actorId: principal.userId,
          subjectId: userId,
          reason,
          createdAt: this.clock.now(),
        },
      })
    }

    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        roles: row.roles.map((entry) => entry.role),
        isDemo: row.isDemo,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
        suspendedReason: row.suspendedReason,
        createdAt: row.createdAt.toISOString(),
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        stats,
      },
    }
  }

  /**
   * 정지 (F4).
   *
   * **세션도 함께 끊는다.** 칸만 세우면 이미 로그인해 있는 사람은 토큰이 살아 있는
   * 동안 그대로 쓴다 — 정지가 「다음 로그인부터」가 되는 것은 정지가 아니다.
   */
  async suspend(userId: string, request: SuspendUserRequest): Promise<void> {
    const now = this.clock.now()
    const changed = await this.prisma.user.updateMany({
      where: { id: userId, deletedAt: null, suspendedAt: null },
      data: { suspendedAt: now, suspendedReason: request.reason, updatedAt: now },
    })

    // **0줄을 한 가지로 답하지 않는다.** 「그런 회원이 없다」와 「다른 관리자가 방금
    // 정지시켰다」는 다른 사실이고, 사람이 할 일도 다르다 — 앞은 잘못 찾은 것이고
    // 뒤는 목록을 다시 읽으면 되는 것이다. 조건을 못 맞춘 이유를 한 번 더 물어
    // 가른다 (D-260 의 「사람이 눌러서 하는 일은 답한다」).
    if (changed.count === 0) await this.refuseSuspension(userId, 'suspend')

    await this.prisma.refreshToken.deleteMany({ where: { userId } })
  }

  private async refuseSuspension(userId: string, action: 'suspend' | 'reinstate'): Promise<never> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { suspendedAt: true },
    })

    if (row === null) throw new NotFoundException('회원을 찾을 수 없습니다.')

    throw new ConflictException(
      domainFailure(
        'USER_SUSPENSION_UNCHANGED',
        action === 'suspend'
          ? '이미 정지된 회원이에요. 목록을 다시 읽어 주세요.'
          : '정지 상태가 아니에요. 목록을 다시 읽어 주세요.',
      ),
    )
  }

  async reinstate(userId: string): Promise<void> {
    const now = this.clock.now()
    const changed = await this.prisma.user.updateMany({
      where: { id: userId, deletedAt: null, suspendedAt: { not: null } },
      data: { suspendedAt: null, suspendedReason: null, updatedAt: now },
    })

    if (changed.count === 0) await this.refuseSuspension(userId, 'reinstate')
  }

  /**
   * 적립금 수동 조정 (F5).
   *
   * 원장을 직접 쓰지 않고 적립금 서비스의 문을 지난다 — 잔액과 통(lot)의 관계를
   * 여기서 다시 구현하면 그 둘이 어긋나고, 그 어긋남은 다음 사용에서 「쓸 수 있다는데
   * 잔액이 모자란다」로 나타난다.
   */
  async adjustPoints(
    principal: RequestPrincipal,
    userId: string,
    request: AdjustPointsRequest,
  ): Promise<AdjustPointsResponse> {
    const exists = await this.prisma.user.count({ where: { id: userId, deletedAt: null } })

    if (exists === 0) throw new NotFoundException('회원을 찾을 수 없습니다.')

    const applied = await this.points.adjustByAdmin({
      userId,
      amount: request.amount,
      reason: `${request.reason} (관리자 ${principal.userId})`,
    })

    return { balance: (await this.points.balanceOf(userId)).balance, applied }
  }

  private toSummary(row: UserRow): AdminUserSummary {
    return {
      id: row.id,
      maskedEmail: maskEmail(row.email),
      maskedName: maskName(row.name),
      roles: row.roles.map((entry) => entry.role),
      isDemo: row.isDemo,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    }
  }

  /** 숫자만 센다 — 목록도 본문도 여기서 내려보내지 않는 이유는 계약에 적었다. */
  private async statsOf(userId: string): Promise<AdminUserStats> {
    const [orders, reviewCount, questionCount, balance, couponCount] = await Promise.all([
      this.prisma.order.aggregate({
        where: { userId },
        _count: { _all: true },
        _sum: { paidAmount: true },
      }),
      this.prisma.review.count({ where: { userId } }),
      this.prisma.productQuestion.count({ where: { userId } }),
      this.points.balanceOf(userId),
      this.prisma.userCoupon.count({ where: { userId, status: 'ISSUED' } }),
    ])

    return {
      orderCount: orders._count._all,
      paidAmount: orders._sum.paidAmount ?? 0,
      reviewCount,
      questionCount,
      pointBalance: balance.balance,
      couponCount,
    }
  }
}
