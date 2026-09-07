import { Module } from '@nestjs/common'

import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionsModule } from '../collections/collections.module.js'
import { PaymentModule } from '../payment/payment.module.js'
import { PointsModule } from '../points/points.module.js'
import { ReservationModule } from '../reservation/reservation.module.js'
import { StockModule } from '../stock/stock.module.js'
import { ConsistencyController } from './consistency.controller.js'
import { ConsistencyService } from './consistency.service.js'

/**
 * 정합성 점검 (TASK-0097).
 *
 * 여섯 도메인 모듈을 들여온다 — **각 대사가 그 도메인의 것**이기 때문이다. 「재고가
 * 맞는가」는 원장을 아는 쪽이 답해야 하고, 여기서 다시 세면 두 답이 갈릴 수 있다.
 */
@Module({
  imports: [
    StockModule,
    ReservationModule,
    PointsModule,
    PaymentModule,
    CatalogModule,
    CollectionsModule,
  ],
  controllers: [ConsistencyController],
  providers: [ConsistencyService],
  exports: [ConsistencyService],
})
export class ConsistencyModule {}
