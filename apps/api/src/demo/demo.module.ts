import { Module } from '@nestjs/common'

import { PointsModule } from '../points/points.module.js'
import { StockModule } from '../stock/stock.module.js'
import { SettlementModule } from '../settlement/settlement.module.js'
import { DemoTradeSeedService } from './demo-trade-seed.service.js'
import { AuthModule } from '../auth/auth.module.js'
import { SearchModule } from '../search/search.module.js'
import { PaymentModule } from '../payment/payment.module.js'
import { SellersModule } from '../sellers/sellers.module.js'
import { DemoController } from './demo.controller.js'
import { DemoCleanupService } from './demo-cleanup.service.js'
import { DemoSeedService } from './demo-seed.service.js'
import { DemoService } from './demo.service.js'

/**
 * Demo account issuing (TASK-0024).
 *
 * Imports the two modules whose services it composes rather than reimplementing
 * either: `SessionService` starts the session on the same path a Google sign-in
 * takes, and `SellerService.openDemoStore` is the entry point TASK-0108 built
 * for this task so that an approved store and its `SELLER_OWNER` grant stay one
 * transaction.
 *
 * `DemoCleanupService` is the other half of the same lifecycle (TASK-0025): it
 * has no consumer either, because Nest calls its `OnModuleInit` and the timer
 * does the rest. The force-expiry endpoint is the one part a caller reaches.
 */
@Module({
  imports: [
    AuthModule,
    PaymentModule,
    SellersModule,
    SearchModule,
    PointsModule,
    StockModule,
    SettlementModule,
  ],
  controllers: [DemoController],
  providers: [DemoService, DemoSeedService, DemoTradeSeedService, DemoCleanupService],
  exports: [DemoService, DemoCleanupService],
})
export class DemoModule {}
