import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { CommissionController } from './commission.controller.js'
import { CommissionService } from './commission.service.js'
import { SellerRevenueService } from './seller-revenue.service.js'
import { SettlementBatchService } from './settlement-batch.service.js'
import { SettlementConsoleService } from './settlement-console.service.js'
import { SettlementController } from './settlement.controller.js'

/**
 * 정산 (M12).
 *
 * `SettlementBatchService` 는 내보내지 않는다. 주간 정산서를 만드는 일을 밖에서
 * 부를 이유가 없고, 수동 실행조차 이 모듈의 컨트롤러를 지난다 (TASK-0080).
 *
 * `CommissionService` 를 내보내는 이유는 **주문 생성이 그것을 읽기** 때문이다 —
 * 주문 시점의 요율을 항목에 박는 것(F4)이 정산의 시작이고, 그 판단은 정산이 갖고
 * 있어야 요율 규칙이 한 곳에 남는다.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [CommissionController, SettlementController],
  providers: [
    CommissionService,
    SellerRevenueService,
    SettlementBatchService,
    SettlementConsoleService,
  ],
  exports: [CommissionService],
})
export class SettlementModule {}
