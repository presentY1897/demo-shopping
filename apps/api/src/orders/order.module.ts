import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ReservationModule } from '../reservation/reservation.module.js'
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
 * `SellerOrderListService` 는 판매자 콘솔의 읽기다 (TASK-0060). 컨트롤러가
 * `OrderController` 인 것은 취향이 아니라 **라우트 순서** 때문이다 —
 * `seller-orders/summary` 는 `seller-orders/:id` 보다 먼저 선언돼야 하고, 두 라우트가
 * 다른 컨트롤러에 있으면 그 순서를 모듈 스캔 순서가 정한다(그쪽 주석).
 */
@Module({
  imports: [PrismaModule, ReservationModule, SellerOrderModule],
  controllers: [OrderController],
  providers: [CheckoutService, OrderService, SellerOrderListService],
  exports: [CheckoutService, OrderService],
})
export class OrderModule {}
