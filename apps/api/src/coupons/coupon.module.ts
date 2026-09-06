import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { CouponExpiryService } from './coupon-expiry.service.js'
import { CouponController } from './coupon.controller.js'
import { CouponService } from './coupon.service.js'

/**
 * 쿠폰 (TASK-0072).
 *
 * **의존이 `PrismaModule` 하나다.** 발행도 발급도 다른 도메인의 문을 지나지
 * 않는다 — 범위 대상이 실재하는지 확인할 때 `Category` · `Product` · `Seller` 를
 * 읽지만, 그것은 **읽기**라 저 표들을 소유한 모듈의 규칙을 비켜 가지 않는다. 쓰는
 * 순간이 오면(적용 · 정산) 그때 문이 필요해지고, 그것은 TASK-0075 와 M12 다.
 *
 * 화살표가 한 방향인 것도 그래서다: 아무 모듈도 쿠폰을 모른다. 주문이 쿠폰을 쓰는
 * 것은 TASK-0075 가 그 방향을 만들 때이고, 그때도 `Order → Coupon` 이다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CouponController],
  providers: [
    CouponService,
    // 만료 전환 (F7). 부르는 쪽이 없는 것이 정상이다 — 자기 주기로 돌고, 무엇을
    // 보고 몇 장씩 옮기는지는 `coupon-expiry.ts` 가 정한다.
    CouponExpiryService,
  ],
  exports: [CouponService, CouponExpiryService],
})
export class CouponModule {}
