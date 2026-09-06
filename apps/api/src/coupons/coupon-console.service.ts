import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  BulkIssueTarget,
  Coupon,
  CouponLifecycle,
  CouponListQueryParams,
  CouponListResponse,
} from '@shopping/shared'
import {
  BULK_ISSUE_MAX_RECIPIENTS,
  COUPON_LIST_DEFAULT_LIMIT,
  platformOwnership,
} from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import {
  accountFilterFor,
  couponOwnership,
  couponOwnershipSelect,
  ownerGroup,
  sellerOwnership,
  sellerOwnershipSelect,
} from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { couponLifecycleOf } from './coupon-console.js'
import { toCoupon } from './coupon.service.js'

/**
 * 발행자 콘솔 (TASK-0073 · TASK-0074).
 *
 * 관리자와 판매자가 **같은 서비스**를 쓴다. 화면이 다른 것은 부담 주체를 어떻게
 * 말하느냐이고(플랫폼은 「플랫폼 부담」, 판매자는 「정산에서 차감됩니다」), 서버가
 * 답하는 것은 같다 — 두 벌로 만들면 「사용률」과 「부담 누계」의 정의가 두 곳에서
 * 갈리고, 갈린 뒤에는 어느 쪽이 맞는지 아무도 모른다.
 *
 * 갈리는 것은 **어느 목록을 볼 수 있는가**뿐이고, 그것은 퍼미션이 답한다 (D-224).
 */
@Injectable()
export class CouponConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 발행한 쿠폰 목록과 그 현황 (TASK-0073 F6 · TASK-0074 F5).
   *
   * **`sellerId` 가 어느 목록인지를 정한다.** 없으면 플랫폼 쿠폰이고, 그것을 읽는
   * 것은 `platformOwnership` 에 대한 `coupon.read` 라 `any` 를 가진 관리자만
   * 지나간다 — 데모 관리자도 지나간다: 읽기는 좁혀지지 않고(「시드·실계정 데이터는
   * 조회만」), 못 하는 것은 **고치는 일**이다.
   *
   * 현황은 페이지 전체에 대해 **한 질의**로 센다 (A5). 줄마다 세면 스무 줄짜리
   * 화면이 스물한 번 묻고, 그 수는 목록이 길어질수록 는다.
   */
  async list(
    principal: RequestPrincipal,
    query: CouponListQueryParams,
  ): Promise<CouponListResponse> {
    await this.assertMayList(principal, query.sellerId)

    const now = this.clock.now()
    const limit = query.limit ?? COUPON_LIST_DEFAULT_LIMIT
    const issuer = { sellerId: query.sellerId ?? null }
    const rows = await this.prisma.coupon.findMany({
      where: {
        ...issuer,
        ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
        ...(query.lifecycle === undefined
          ? {}
          : { OR: lifecycleFilters(query.lifecycle, now, this.spent()) }),
        ...periodFilter(query.from, query.to),
      },
      // id 가 UUIDv7 이라 시간순이다. `createdAt` 으로 정렬하면 같은 밀리초의 두
      // 쿠폰에서 커서가 한 건을 건너뛰거나 두 번 보여 준다 (`OrderService.list`).
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: CONSOLE_SELECT,
    })
    const page = rows.slice(0, limit)
    const [stats, totals] = await Promise.all([
      this.statsOf(page.map((row) => row.id)),
      this.totalsOf(issuer),
    ])

    return {
      coupons: page.map((row) => ({
        coupon: toCoupon(row),
        lifecycle: couponLifecycleOf(row, now),
        stats: stats.get(row.id) ?? { usedCount: 0, discountTotal: 0 },
      })),
      totals,
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 발행을 멈추거나 다시 연다 (TASK-0073 F5 · TASK-0074).
   *
   * **이미 발급된 장에는 아무 일도 일어나지 않는다.** 중단은 「더 나가지 않게」이지
   * 「나간 것을 무르게」가 아니다 — 그래서 이 메서드는 `UserCoupon` 을 건드리지 않고,
   * 중단된 쿠폰으로 만든 주문도 그대로 선다.
   *
   * 판정하는 자리는 발급의 조건부 갱신 한 문장이다(`CouponService.takeIssueSlot`).
   * 여기서 하는 일은 그 문장이 읽는 칸을 옮기는 것뿐이다.
   */
  async setSuspended(
    principal: RequestPrincipal,
    couponId: string,
    suspended: boolean,
  ): Promise<Coupon> {
    const coupon = await this.load(couponId)

    assertMayManage(principal, coupon)

    const now = this.clock.now()
    const row = await this.prisma.coupon.update({
      where: { id: couponId },
      data: { suspendedAt: suspended ? now : null, updatedAt: now },
      select: CONSOLE_SELECT,
    })

    return toCoupon(row)
  }

  /**
   * 조건에 맞는 회원에게 한꺼번에 지급한다 (TASK-0073 F4).
   *
   * **이미 가진 사람은 건너뛴다.** 그래서 두 번 눌러도 두 장이 되지 않고, 상한에
   * 걸려 멈춘 뒤 다시 누르면 이어서 나간다 — 멱등은 아니지만 **다시 눌러도 안전**하다.
   *
   * 수량 상한은 행 잠금으로 지킨다. 발급 하나하나는 조건부 갱신으로 충분하지만
   * (`takeIssueSlot`), 여기서는 **몇 장을 넣을지가 다른 표를 읽어야 정해지므로**
   * 판단이 그 행 안에서 끝나지 않는다 — TASK-0065 4.1 의 기준 그대로다.
   *
   * 체험 그룹의 쿠폰은 체험 계정에게만 간다(D-224). 대상 조회가 그 조건을 처음부터
   * 달고 나가므로, 거절할 사람을 뽑아 놓고 거절하는 일이 없다.
   */
  async bulkIssue(
    principal: RequestPrincipal,
    couponId: string,
    target: BulkIssueTarget,
  ): Promise<{ issued: number; skipped: number; remaining: number }> {
    const coupon = await this.load(couponId)

    assertMayManage(principal, coupon)

    const now = this.clock.now()

    const lifecycle = couponLifecycleOf(coupon, now)

    if (lifecycle === 'ENDED') {
      throw new ForbiddenException(
        domainFailure('COUPON_ENDED', '기간이 끝난 쿠폰은 지급할 수 없어요.'),
      )
    }

    // **멈춘 쿠폰은 한꺼번에도 나가지 않는다.** 중단의 뜻이 「더 나가지 않게」이므로
    // 한 장씩 막고 한꺼번에는 열어 두면 그 뜻이 문마다 달라진다 — 한 장씩 가는 길은
    // 발급의 조건부 갱신이 막고(`takeIssueSlot`), 이 길은 그 문장을 지나지 않는다.
    if (lifecycle === 'SUSPENDED') {
      throw new ForbiddenException(
        domainFailure('COUPON_SUSPENDED', '발행이 중단된 쿠폰은 지급할 수 없어요.'),
      )
    }

    const { recipients, skipped } = await this.audienceOf(coupon, target, couponId)

    return this.prisma.$transaction(async (tx) => {
      // 행을 잠근다. 넣을 장수가 「남은 수량」과 「대상 수」 둘 다에 달려 있고,
      // 뒤엣것은 이 행 밖에 있다.
      const [locked] = await tx.$queryRaw<{ issueLimit: number | null; issuedCount: number }[]>`
        SELECT "issueLimit", "issuedCount" FROM "Coupon" WHERE "id" = ${couponId}::uuid FOR UPDATE
      `

      if (locked === undefined) throw new NotFoundException('쿠폰을 찾을 수 없어요.')

      const room =
        locked.issueLimit === null
          ? recipients.length
          : Math.max(0, locked.issueLimit - locked.issuedCount)
      const going = recipients.slice(0, Math.min(room, BULK_ISSUE_MAX_RECIPIENTS))

      if (going.length > 0) {
        await tx.userCoupon.createMany({
          data: going.map((userId) => ({
            couponId,
            userId,
            issuedAt: now,
            createdAt: now,
            updatedAt: now,
            expiresAt: coupon.validUntil,
          })),
        })
        await tx.coupon.update({
          where: { id: couponId },
          data: { issuedCount: { increment: going.length }, updatedAt: now },
        })
      }

      return {
        issued: going.length,
        skipped,
        remaining: recipients.length - going.length,
      }
    })
  }

  // ---------------------------------------------------------------- 내부

  /**
   * 이 목록을 볼 수 있는가.
   *
   * 플랫폼 목록은 주인이 아무도 아닌 데이터라 `any` 만 지나간다. 판매자 목록은 그
   * 스토어의 소유권 검사라 주인과 관리자가 지난다 — TASK-0074 F6 의 「타 판매자 쿠폰
   * 조회 403」이 그 한 줄이고, 서비스가 역할을 직접 보지 않는다.
   */
  private async assertMayList(
    principal: RequestPrincipal,
    sellerId: string | undefined,
  ): Promise<void> {
    if (sellerId === undefined) {
      assertResourceAccess(principal, 'coupon.read', platformOwnership)

      return
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    assertResourceAccess(principal, 'coupon.read', sellerOwnership(seller))
  }

  /**
   * 페이지에 있는 쿠폰들의 현황 — **한 질의**.
   *
   * 쓰인 장수와 깎인 금액을 함께 센다. 뒤엣것을 정책으로 되계산할 수 없으므로 사용
   * 시점에 장마다 적어 두었고(`UserCoupon.discountAmount`), 이것은 그 합이다.
   */
  private async statsOf(
    couponIds: readonly string[],
  ): Promise<ReadonlyMap<string, { usedCount: number; discountTotal: number }>> {
    if (couponIds.length === 0) return new Map()

    const rows = await this.prisma.userCoupon.groupBy({
      by: ['couponId'],
      where: { couponId: { in: [...couponIds] }, status: 'USED' },
      _count: { _all: true },
      _sum: { discountAmount: true },
    })

    return new Map(
      rows.map((row) => [
        row.couponId,
        { usedCount: row._count._all, discountTotal: row._sum.discountAmount ?? 0 },
      ]),
    )
  }

  /**
   * 이 발행자의 쿠폰이 **지금까지** 만든 것 (TASK-0074 F5).
   *
   * **필터와 페이지에 무관하다.** 「지금까지의 부담액 누계」는 서 있는 수이지 지금
   * 보고 있는 페이지의 성질이 아니고, 페이지 합으로 답하면 다음 장을 넘길 때마다
   * 누계가 달라진다 — 판매자가 정산과 견주려는 수가 그것이라 더 나쁘다.
   */
  private async totalsOf(issuer: { sellerId: string | null }): Promise<{
    usedCount: number
    discountTotal: number
  }> {
    const answer = await this.prisma.userCoupon.aggregate({
      where: { status: 'USED', coupon: issuer },
      _count: { _all: true },
      _sum: { discountAmount: true },
    })

    return {
      usedCount: answer._count._all,
      discountTotal: answer._sum.discountAmount ?? 0,
    }
  }

  /**
   * 지급 대상 — 아직 이 쿠폰을 갖지 않은 사람만, 그리고 이미 가진 사람의 수.
   *
   * 「이미 가진 사람」을 여기서 빼는 이유는 그것이 **건너뛴 수**가 아니라 애초에
   * 대상이 아니기 때문이다. 넣어 보고 유니크 위반으로 세는 길도 있지만, 그러면 한
   * 사람이 실패할 때마다 트랜잭션이 통째로 중단된다 (Postgres 의 성질).
   */
  private async audienceOf(
    coupon: ConsoleRow,
    target: BulkIssueTarget,
    couponId: string,
  ): Promise<{ recipients: readonly string[]; skipped: number }> {
    const matching = {
      deletedAt: null,
      // 체험 그룹의 쿠폰은 체험 계정에게만 간다 (D-224). 실계정 쿠폰에는 이
      // 조건이 붙지 않는다 — 방문자도 진짜 흐름을 겪는다. 이 파일은 그 조건이
      // 어느 칸을 보는지 알지 못한다.
      ...accountFilterFor(ownerGroup(couponOwnership(coupon))),
      ...(target === 'ALL'
        ? {}
        : { orders: target === 'HAS_ORDERED' ? { some: {} } : { none: {} } }),
    }
    const [rows, skipped] = await Promise.all([
      this.prisma.user.findMany({
        where: { ...matching, userCoupons: { none: { couponId } } },
        orderBy: { id: 'asc' },
        // 상한보다 한 명 더 읽어 「남았는가」에 답한다. 정확한 수를 세지 않는 이유는
        // 그 수가 「한 번 더 누를까」라는 판단에 아무것도 보태지 않기 때문이다.
        take: BULK_ISSUE_MAX_RECIPIENTS + 1,
        select: { id: true },
      }),
      // **이미 가진 사람은 대상에서 빠지지만 세기는 한다.** 「0장 나갔습니다」만으로는
      // 아무도 대상이 아닌 것과 모두가 이미 가진 것을 가를 수 없고, 그 둘에 발행자가
      // 할 일이 다르다 — 앞은 조건을 바꾸는 일이고 뒤는 아무것도 안 해도 되는 일이다.
      this.prisma.user.count({ where: { ...matching, userCoupons: { some: { couponId } } } }),
    ])

    return { recipients: rows.map((row) => row.id), skipped }
  }

  /**
   * 「준비된 수량이 다 나갔다」를 `where` 로 — **칸과 칸을 견준다.**
   *
   * 상수와 비교하는 것이 아니라 `issuedCount >= issueLimit` 이라 필드 참조가 필요하고,
   * 그것은 클라이언트 인스턴스에만 있다(`this.prisma.coupon.fields`). 그래서 이
   * 조각만 메서드다 — 나머지 넷은 순수 함수 안에 있다.
   */
  private spent(): Prisma.CouponWhereInput {
    return {
      issueLimit: { not: null },
      issuedCount: { gte: this.prisma.coupon.fields.issueLimit },
    }
  }

  private async load(couponId: string): Promise<ConsoleRow> {
    const row = await this.prisma.coupon.findUnique({
      where: { id: couponId },
      select: CONSOLE_SELECT,
    })

    if (row === null) throw new NotFoundException('쿠폰을 찾을 수 없어요.')

    return row
  }
}

/**
 * 상태 하나를 `where` 조각으로.
 *
 * 화면이 고른 상태로 거르려면 **저장되지 않은 값으로 걸러야** 한다. 다섯 갈래가
 * 서로를 가리는 순서(`coupon-console.ts`)를 그대로 조건으로 옮긴 것이 아래이고,
 * 그래서 각 조각은 자기보다 위에 있는 상태들을 전부 배제한다 — 그러지 않으면 끝난
 * 쿠폰이 「진행 중」 필터에도 걸린다.
 */
function lifecycleFilters(
  lifecycles: readonly CouponLifecycle[],
  now: Date,
  spent: Prisma.CouponWhereInput,
): Prisma.CouponWhereInput[] {
  const live = { validUntil: { gt: now } }
  const running = { ...live, suspendedAt: null, validFrom: { lte: now } }

  return lifecycles.map((lifecycle) => {
    if (lifecycle === 'ENDED') return { validUntil: { lte: now } }
    if (lifecycle === 'SUSPENDED') return { ...live, suspendedAt: { not: null } }
    if (lifecycle === 'SCHEDULED') return { ...live, suspendedAt: null, validFrom: { gt: now } }
    if (lifecycle === 'EXHAUSTED') return { ...running, ...spent }

    return { ...running, NOT: spent }
  })
}

/**
 * 유효기간이 이 범위와 **겹치는** 쿠폰만.
 *
 * 「시작일이 이 사이」가 아니다. 발행자가 「9월에 돌던 쿠폰」을 찾을 때 8월에 시작해
 * 9월까지 가는 것은 찾는 그 쿠폰이고, 시작일로 거르면 그것이 목록에서 사라진다.
 * 겹침은 「시작이 `to` 보다 앞이고 끝이 `from` 보다 뒤」이며, 경계는 양쪽 다 포함이다.
 */
function periodFilter(from: string | undefined, to: string | undefined): Prisma.CouponWhereInput {
  return {
    ...(to === undefined ? {} : { validFrom: { lte: new Date(to) } }),
    ...(from === undefined ? {} : { validUntil: { gte: new Date(from) } }),
  }
}

/**
 * 이 사람이 **이 쿠폰**을 관리할 수 있는가.
 *
 * 발행·지급과 같은 검사다 (`CouponService` 의 `assertMayIssue`). 멈추는 것도 한꺼번에
 * 주는 것도 「이 쿠폰을 낸 사람이 하는 일」이므로, 다른 규칙을 세우면 그 둘이 갈리는
 * 날이 온다.
 */
function assertMayManage(principal: RequestPrincipal, coupon: ConsoleRow): void {
  assertResourceAccess(
    principal,
    coupon.sellerId === null ? 'coupon.platform' : 'coupon.write',
    couponOwnership(coupon),
  )
}

/** 계약의 칸들 · 소유권 · 그리고 상태를 정하는 값들. */
const CONSOLE_SELECT = {
  ...couponOwnershipSelect,
  id: true,
  issuerType: true,
  sellerId: true,
  name: true,
  code: true,
  discountType: true,
  discountValue: true,
  maxDiscountAmount: true,
  minOrderAmount: true,
  scopeType: true,
  scopeIds: true,
  validFrom: true,
  validUntil: true,
  issueLimit: true,
  issuedCount: true,
  audience: true,
  suspendedAt: true,
} as const

type ConsoleRow = Prisma.CouponGetPayload<{ select: typeof CONSOLE_SELECT }>
