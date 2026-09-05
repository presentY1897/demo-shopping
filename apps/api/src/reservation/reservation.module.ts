import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { StockModule } from '../stock/stock.module.js'
import { ReservationController } from './reservation.controller.js'
import { ReservationService } from './reservation.service.js'
import { ReservationSweeperService } from './reservation-sweeper.service.js'

/**
 * 재고 예약 (TASK-0048).
 *
 * **예약 자체에는 여전히 엔드포인트가 없다** (TASK-0048 4.2 ①). 잡고 확정하고 푸는
 * 일은 주문 생성(TASK-0049)과 주문서(TASK-0050)가 부르는 서비스다. 컨트롤러가 내주는
 * 것은 **운영의 두 가지** — 만료 정리를 손으로 돌리는 일과 정합성 점검(TASK-0051)이고,
 * 그 둘은 사람이 직접 부를 일이 실제로 있다.
 *
 * `StockModule` 을 들여오는 것은 확정이 원장을 거쳐야 하기 때문이다 —
 * `ProductVariant.stock` 을 쓰는 길은 그 하나뿐이다(TASK-0036).
 */
@Module({
  imports: [PrismaModule, StockModule],
  controllers: [ReservationController],
  providers: [ReservationService, ReservationSweeperService],
  exports: [ReservationService, ReservationSweeperService],
})
export class ReservationModule {}
