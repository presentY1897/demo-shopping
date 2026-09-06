import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { CouponApplyService } from './coupon-apply.service.js'
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
 * 화살표가 한 방향이다: 쿠폰은 아무 모듈도 모른다. 주문이 쿠폰을 알 뿐이고
 * (TASK-0075 의 `CouponApplyService`), 그 방향이 뒤집히면 — 쿠폰이 주문서를 읽으러
 * 가면 — 두 모듈이 서로를 들여오게 되어 어느 쪽도 혼자 세울 수 없게 된다. 그래서
 * 적용 서비스는 주문서를 **받고**, 찾지 않는다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CouponController],
  providers: [
    CouponService,
    // 적용 (TASK-0075). 주문서와 주문이 이것을 지나 쿠폰을 얹고 소진한다.
    CouponApplyService,
    // 만료 전환 (F7). 부르는 쪽이 없는 것이 정상이다 — 자기 주기로 돌고, 무엇을
    // 보고 몇 장씩 옮기는지는 `coupon-expiry.ts` 가 정한다.
    CouponExpiryService,
  ],
  exports: [CouponService, CouponApplyService, CouponExpiryService],
})
export class CouponModule {}
