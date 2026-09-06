import { Controller, Get, Query } from '@nestjs/common'
import type { UserCouponListResponse } from '@shopping/shared'
import { userCouponListQueryParamsSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CouponBoxService } from './coupon-box.service.js'

/**
 * 내 쿠폰함 (TASK-0077).
 *
 * 발행자의 `GET /coupons` 와 라우트를 나눈 이유는 **세는 단위가 다르기** 때문이다.
 * 저기서 한 줄은 정책 한 건이고 여기서 한 줄은 **발급된 장**이다 — 같은 경로에 두고
 * 역할로 갈라 주면 응답의 모양이 부르는 사람에 따라 달라지고, 그것은 계약이 아니다
 * (주문이 `/orders` 와 `/seller-orders` 로 갈린 것과 같은 판단).
 *
 * **받는 문은 여기 없다.** 코드를 넣어 받는 것은 `POST /coupons/claims` 이고, 그것이
 * 쿠폰을 소유하는 쪽이 아니라 발급하는 쪽의 일이기 때문이다.
 */
@Controller({ path: 'me/coupons', version: '1' })
export class CouponBoxController {
  constructor(private readonly box: CouponBoxService) {}

  @Get()
  @RequirePermission('coupon.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<UserCouponListResponse> {
    return this.box.list(principal, parseInput(userCouponListQueryParamsSchema, query))
  }
}
