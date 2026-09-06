import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import type {
  BulkIssueResponse,
  CouponListResponse,
  CouponResponse,
  UserCouponResponse,
} from '@shopping/shared'
import {
  bulkIssueRequestSchema,
  claimCouponRequestSchema,
  couponIdSchema,
  couponListQueryParamsSchema,
  createCouponRequestSchema,
  issueCouponRequestSchema,
  updateCouponRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CouponConsoleService } from './coupon-console.service.js'
import { CouponService } from './coupon.service.js'

/**
 * 쿠폰의 발행과 발급 (TASK-0072).
 *
 * ## 라우트 순서
 *
 * `coupons/claims` 가 `coupons/:id/issues` 와 부딪히지 않는 이유는 뒤엣것이 두
 * 마디이기 때문이다. 그래도 **위에 둔다** — `SellerClaimController` 가 같은
 * 함정에 같은 주석을 달아 두었고, 나중에 `coupons/:id` 가 생기는 날 이 순서가
 * 이미 맞아 있어야 한다.
 *
 * ## 발급받기는 `coupon.claim` 이다
 *
 * 한동안 이 문은 `coupon.read` 를 썼다. 넓어서가 아니라 **이름과 행동이 달라서**
 * 부채였다 — 구매자에게 `coupon.write` 를 줄 수는 없고(주면 구매자가 쿠폰을 만들 수
 * 있다) 그 목록을 소유하지 않은 TASK 가 새 이름을 더할 수도 없어서, 「받는다」가
 * 「읽는다」로 적혀 있었다. TASK-0073 이 등급을 나누면서 그 이름이 생겼다.
 *
 * ## 발행은 두 퍼미션으로 갈린다 (TASK-0073)
 *
 * 판매자 쿠폰은 `coupon.write` 이고 플랫폼 쿠폰은 `coupon.platform` 이다. 라우트는
 * 하나인데 **요청의 `sellerId` 가 어느 쪽인지를 정하므로**, 데코레이터가 아니라
 * 서비스가 그 갈림을 판정한다 — 데코레이터에 둘 중 하나를 적으면 다른 쪽이 열린다.
 * 여기 `coupon.write` 만 걸려 있는 것은 **문을 지나는 최소 조건**이고, 그 뒤의
 * 진짜 판정은 `CouponService.assertMayCreate` 에 있다.
 */
@Controller({ version: '1' })
export class CouponController {
  constructor(
    private readonly coupons: CouponService,
    private readonly console: CouponConsoleService,
  ) {}

  /**
   * 발행한 쿠폰 목록과 현황 (TASK-0073 F6 · TASK-0074 F5).
   *
   * **`sellerId` 가 어느 목록인지를 정한다.** 없으면 플랫폼 쿠폰이고, 있으면 그
   * 스토어의 것이다. 라우트를 둘로 나누지 않는 이유는 **답의 모양이 같기** 때문이다 —
   * 나누면 「사용률」과 「부담 누계」의 정의가 두 곳에 살게 된다.
   */
  @Get('coupons')
  @RequirePermission('coupon.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<CouponListResponse> {
    return this.console.list(principal, parseInput(couponListQueryParamsSchema, query))
  }

  /** 쿠폰을 발행한다. 플랫폼 쿠폰은 관리자만, 판매자 쿠폰은 그 가게의 주인이. */
  @Post('coupons')
  @RequirePermission('coupon.write')
  async create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<CouponResponse> {
    const coupon = await this.coupons.create(principal, parseInput(createCouponRequestSchema, body))

    return { coupon }
  }

  /** 코드를 넣어 **본인이** 받는다. `:id/issues` 보다 위에 있어야 한다. */
  @Post('coupons/claims')
  @RequirePermission('coupon.claim')
  async claim(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<UserCouponResponse> {
    const { code } = parseInput(claimCouponRequestSchema, body)

    return { userCoupon: await this.coupons.claim(principal, code) }
  }

  /**
   * 발행을 멈추거나 다시 연다 (TASK-0073 F5).
   *
   * **이미 발급된 장에는 아무 일도 일어나지 않는다.** 중단은 「더 나가지 않게」이지
   * 「나간 것을 무르게」가 아니다 — 무르는 것은 사람이 받은 것을 빼앗는 일이라 다른
   * 결정이고, 그 문은 없다.
   */
  @Patch('coupons/:id')
  @RequirePermission('coupon.write')
  async update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CouponResponse> {
    const couponId = parseInput(couponIdSchema, id, 'id')
    const { suspended } = parseInput(updateCouponRequestSchema, body)

    return { coupon: await this.console.setSuspended(principal, couponId, suspended) }
  }

  /**
   * 조건에 맞는 회원에게 한꺼번에 지급한다 (TASK-0073 F4).
   *
   * `:id/issues` 보다 **아래**에 있어도 부딪히지 않는다 — 마디 수가 다르다.
   */
  @Post('coupons/:id/issues/bulk')
  @RequirePermission('coupon.write')
  bulkIssue(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BulkIssueResponse> {
    const couponId = parseInput(couponIdSchema, id, 'id')
    const { target } = parseInput(bulkIssueRequestSchema, body)

    return this.console.bulkIssue(principal, couponId, target)
  }

  /** 발행자가 한 사람에게 지급한다. */
  @Post('coupons/:id/issues')
  @RequirePermission('coupon.write')
  async grant(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<UserCouponResponse> {
    const couponId = parseInput(couponIdSchema, id, 'id')
    const { userId } = parseInput(issueCouponRequestSchema, body)

    return { userCoupon: await this.coupons.grant(principal, couponId, userId) }
  }
}
