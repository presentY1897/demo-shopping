import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { OrderConfirmService } from './order-confirm.service.js'
import { NoopOrderConfirmedEvents, ORDER_CONFIRMED_EVENTS } from './order-confirmed-events.js'
import { NoopSellerOrderEvents, SELLER_ORDER_EVENTS } from './seller-order-events.js'
import { SellerOrderController } from './seller-order.controller.js'
import { SellerOrderService } from './seller-order.service.js'

/**
 * 주문 상태 전이 (TASK-0059).
 *
 * **`OrderModule` 과 따로 있는 이유는 순환 때문이다.** `OrderModule` 은 이미
 * `ReservationModule` 을 들여오는데(주문 생성이 재고를 잡는다), 예약 만료 스케줄러도
 * 이 문을 지나야 한다 — 전이를 `OrderModule` 에 두면 `Reservation → Order →
 * Reservation` 이 되어 `forwardRef` 로 겨우 도는 모양이 된다. 문을 따로 세우면 둘 다
 * 여기를 들여오기만 하면 되고, 그 방향은 **한쪽으로만** 흐른다.
 *
 * 의존이 `PrismaModule` 하나인 것도 그래서다. 전이는 주문의 금액도 재고도 모른다 —
 * 아는 것은 상태와 이력뿐이고, 그 좁음이 이 모듈이 아무 데서나 쓰일 수 있는 이유다.
 *
 * **자동 구매확정 스케줄러도 여기 있다** (TASK-0064). 그 잡이 하는 일이 「상태와
 * 이력을 보고 문을 지나는 것」뿐이라 이 모듈의 좁은 의존 그대로이고, 무엇보다
 * `OrderModule` 에 두면 배송·예약 쪽에서 그것을 부를 길이 다시 `forwardRef` 가 된다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SellerOrderController],
  providers: [
    SellerOrderService,
    OrderConfirmService,
    // M13 이 실제 발행을 붙일 때 여기 한 줄만 바뀐다. 지금 구현이 무엇을 뜻하는지는
    // `seller-order-events.ts` 가 설명한다.
    { provide: SELLER_ORDER_EVENTS, useClass: NoopSellerOrderEvents },
    // M11(적립금)·M12(정산)가 붙을 때 여기 한 줄만 바뀐다. 「아무것도 안 한다」가
    // 지금 무엇을 뜻하는지는 `order-confirmed-events.ts` 가 설명한다.
    { provide: ORDER_CONFIRMED_EVENTS, useClass: NoopOrderConfirmedEvents },
  ],
  exports: [SellerOrderService, OrderConfirmService],
})
export class SellerOrderModule {}
