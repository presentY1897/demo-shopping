import { Injectable, NotFoundException } from '@nestjs/common'
import type { UserCouponListQueryParams, UserCouponListResponse } from '@shopping/shared'
import { USER_COUPON_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { toCoupon } from './coupon.service.js'

/**
 * 내 쿠폰함 (TASK-0077).
 *
 * 발행자의 목록(`CouponConsoleService`)과 **세는 단위가 다르다.** 저기서 한 줄은
 * 정책 한 건이고 여기서 한 줄은 **발급된 장**이다 — 같은 쿠폰이 만 명에게 나갔으면
 * 저기서는 한 줄, 여기서는 그 사람의 한 장이다. 그래서 같은 표를 읽으면서도 서비스가
 * 나뉜다: 합쳐 두면 「목록」이라는 말이 두 뜻을 갖는다.
 */
@Injectable()
export class CouponBoxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 내 쿠폰함 한 쪽과 **탭에 붙는 수**.
   *
   * 수를 함께 내는 이유는 탭이 셋이기 때문이다. 각 탭이 자기 수를 따로 물으면 화면
   * 하나가 네 번 묻고, 그 넷은 서로 다른 순간의 답이라 합이 맞지 않을 수 있다 —
   * 「사용 가능 3장」인데 그 탭에 두 장만 있는 화면이 그렇게 만들어진다.
   *
   * 정책을 조인하는 것은 **화면이 그것 없이는 아무것도 그릴 수 없기** 때문이다.
   * 쿠폰함의 한 줄은 「가을 쿠폰 · 3,000원 할인 · 9월 30일까지」이고 앞의 둘이 정책에
   * 있다. 조인하지 않으면 화면이 장마다 한 번씩 더 묻는다.
   */
  async list(
    principal: RequestPrincipal,
    query: UserCouponListQueryParams,
  ): Promise<UserCouponListResponse> {
    const account = await this.account(principal)
    const limit = query.limit ?? USER_COUPON_LIST_DEFAULT_LIMIT
    const [rows, counts] = await Promise.all([
      this.prisma.userCoupon.findMany({
        where: {
          userId: account.id,
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
        },
        // id 가 UUIDv7 이라 시간순이다 — 방금 받은 장이 맨 위다.
        orderBy: { id: 'desc' },
        take: limit + 1,
        select: USER_COUPON_SELECT,
      }),
      // **상태로 좁혀도 이 수는 달라지지 않는다.** 탭의 수는 그 탭을 보고 있는지와
      // 무관한 사실이고, 좁혀서 세면 고른 탭만 0이 아닌 화면이 된다.
      this.prisma.userCoupon.groupBy({
        by: ['status'],
        where: { userId: account.id },
        _count: { _all: true },
      }),
    ])
    const page = rows.slice(0, limit)

    return {
      coupons: page.map((row) => ({
        id: row.id,
        couponId: row.couponId,
        userId: row.userId,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        issuedAt: row.issuedAt.toISOString(),
        usedAt: row.usedAt?.toISOString() ?? null,
        orderId: row.orderId,
        coupon: toCoupon(row.coupon),
      })),
      // **세 상태가 전부 나간다, 0이어도.** 없는 키를 화면이 `?? 0` 으로 메우게 하면
      // 그 `?? 0` 은 「아직 안 왔다」와 「없다」를 같은 것으로 만든다.
      counts: counts.reduce((all, entry) => ({ ...all, [entry.status]: entry._count._all }), {
        ISSUED: 0,
        USED: 0,
        EXPIRED: 0,
      }),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  private async account(principal: RequestPrincipal): Promise<{ id: string }> {
    const account = await this.prisma.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없어요.')

    assertResourceAccess(principal, 'coupon.read', accountOwnership(account))

    return account
  }
}

/** 발급된 장과 **그 정책**. 화면의 한 줄이 둘을 모두 읽는다. */
const USER_COUPON_SELECT = {
  id: true,
  couponId: true,
  userId: true,
  status: true,
  expiresAt: true,
  issuedAt: true,
  usedAt: true,
  orderId: true,
  coupon: {
    select: {
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
    },
  },
} as const
