import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { StockModule } from '../stock/stock.module.js'
import { ReservationService } from './reservation.service.js'

/**
 * 재고 예약 (TASK-0048).
 *
 * 컨트롤러가 없다 (4.2 ①). 예약을 부르는 쪽은 주문 생성(TASK-0049)과 만료
 * 스케줄러(TASK-0051)이고, 둘 다 아직 없다. 부를 화면이 없는 REST 표면을 먼저 뚫어
 * 두면 실제로 쓸 때가 되어서야 모양이 안 맞는다는 것을 알게 된다.
 *
 * `StockModule` 을 들여오는 것은 확정이 원장을 거쳐야 하기 때문이다 —
 * `ProductVariant.stock` 을 쓰는 길은 그 하나뿐이다(TASK-0036).
 */
@Module({
  imports: [PrismaModule, StockModule],
  providers: [ReservationService],
  exports: [ReservationService],
})
export class ReservationModule {}
