import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module.js'
import { SellersModule } from '../sellers/sellers.module.js'
import { DemoController } from './demo.controller.js'
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
 */
@Module({
  imports: [AuthModule, SellersModule],
  controllers: [DemoController],
  providers: [DemoService, DemoSeedService],
  exports: [DemoService],
})
export class DemoModule {}
