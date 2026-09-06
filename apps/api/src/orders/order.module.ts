import { Module } from '@nestjs/common'

import { CouponModule } from '../coupons/coupon.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ReservationModule } from '../reservation/reservation.module.js'
import { SettlementModule } from '../settlement/settlement.module.js'
import { CheckoutService } from './checkout.service.js'
import { OrderController } from './order.controller.js'
import { OrderService } from './order.service.js'
import { SellerOrderListService } from './seller-order-list.service.js'
import { SellerOrderModule } from './seller-order.module.js'

/**
 * 주문 (TASK-0049).
 *
 * `ReservationModule` 을 들여오는 것이 이 모듈의 핵심 의존이다 — 주문 생성 트랜잭션
 * 안에서 재고를 잡고, 하나라도 실패하면 롤백이 앞선 예약까지 없던 일로 만든다(F5).
 *
 * `SellerOrderModule` 은 상태를 옮기는 문이다 (TASK-0059). `markPaid` 가 상태를 직접
 * 쓰지 않고 그 문을 지나므로, 「정의되지 않은 전이는 불가능하다」가 **새 코드에만
 * 적용되는 규칙**이 되지 않는다.
 *
 * `CouponModule` 은 M11 이 더한 방향이다 (TASK-0075). 주문서와 주문이 고른 쿠폰을
 * 확인하고 소진하는 일이 그 모듈을 지나고, 반대 방향은 없다 — 쿠폰은 주문서를
 * 받기만 하고 찾지 않는다.
 *
 * `SettlementModule` 은 M12 가 더한 방향이다 (TASK-0079). 주문 시점의 수수료율을
 * 항목에 박는 판단이 그쪽에 있고, 반대 방향은 없다 — 정산은 주문을 읽기만 한다.
 *
 * `SellerOrderListService` 는 판매자 콘솔의 읽기다 (TASK-0060). 컨트롤러가
 * `OrderController` 인 것은 취향이 아니라 **라우트 순서** 때문이다 —
 * `seller-orders/summary` 는 `seller-orders/:id` 보다 먼저 선언돼야 하고, 두 라우트가
 * 다른 컨트롤러에 있으면 그 순서를 모듈 스캔 순서가 정한다(그쪽 주석).
 */
@Module({
  imports: [PrismaModule, ReservationModule, SellerOrderModule, CouponModule, SettlementModule],
  controllers: [OrderController],
  providers: [CheckoutService, OrderService, SellerOrderListService],
  exports: [CheckoutService, OrderService],
})
export class OrderModule {}
