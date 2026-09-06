import { Body, Controller, Param, Post } from '@nestjs/common'
import type { CouponResponse, UserCouponResponse } from '@shopping/shared'
import {
  claimCouponRequestSchema,
  couponIdSchema,
  createCouponRequestSchema,
  issueCouponRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
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
 * ## 발급받기가 `coupon.read` 인 것
 *
 * **이 파일에서 가장 설명이 필요한 줄이다.** 구매자는 `coupon.read:own` 만
 * 갖는다(`packages/shared/src/auth/role-permissions.ts`) — `coupon.write` 는
 * 발행자의 능력이고, 그것을 구매자에게 주면 **구매자가 쿠폰을 만들 수 있게
 * 된다.** 「내 쿠폰함에 넣는다」에 맞는 퍼미션(`coupon.claim` 같은)은 이 TASK 가
 * 소유하지 않은 목록에 있어서 여기서 더할 수 없다.
 *
 * 이름이 맞지 않을 뿐 **넓지는 않다.** 이 라우트는 `userId` 를 요청에서 받지
 * 않으므로 부르는 사람이 자기 쿠폰함 말고 다른 곳에 넣을 방법이 없고, 코드를
 * 모르면 아무 일도 일어나지 않는다. 그래도 이름과 행동이 갈리는 것은 부채이므로
 * 보고에 남긴다.
 */
@Controller({ version: '1' })
export class CouponController {
  constructor(private readonly coupons: CouponService) {}

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
  @RequirePermission('coupon.read')
  async claim(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<UserCouponResponse> {
    const { code } = parseInput(claimCouponRequestSchema, body)

    return { userCoupon: await this.coupons.claim(principal, code) }
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
