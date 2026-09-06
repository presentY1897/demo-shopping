import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { CommissionController } from './commission.controller.js'
import { CommissionService } from './commission.service.js'

/**
 * 정산 (M12).
 *
 * `CommissionService` 를 내보내는 이유는 **주문 생성이 그것을 읽기** 때문이다 —
 * 주문 시점의 요율을 항목에 박는 것(F4)이 정산의 시작이고, 그 판단은 정산이 갖고
 * 있어야 요율 규칙이 한 곳에 남는다.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [CommissionController],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class SettlementModule {}
