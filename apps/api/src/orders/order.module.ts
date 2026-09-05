import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ReservationModule } from '../reservation/reservation.module.js'
import { CheckoutService } from './checkout.service.js'
import { OrderController } from './order.controller.js'
import { OrderService } from './order.service.js'
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
 */
@Module({
  imports: [PrismaModule, ReservationModule, SellerOrderModule],
  controllers: [OrderController],
  providers: [CheckoutService, OrderService],
  exports: [CheckoutService, OrderService],
})
export class OrderModule {}
