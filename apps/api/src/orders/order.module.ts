import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ReservationModule } from '../reservation/reservation.module.js'
import { OrderController } from './order.controller.js'
import { OrderService } from './order.service.js'

/**
 * 주문 (TASK-0049).
 *
 * `ReservationModule` 을 들여오는 것이 이 모듈의 핵심 의존이다 — 주문 생성 트랜잭션
 * 안에서 재고를 잡고, 하나라도 실패하면 롤백이 앞선 예약까지 없던 일로 만든다(F5).
 */
@Module({
  imports: [PrismaModule, ReservationModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
