import { Module } from '@nestjs/common'

import { AdminSellerController } from './admin-seller.controller.js'
import { SellerController } from './seller.controller.js'
import { SellerService } from './seller.service.js'

/**
 * Seller onboarding (TASK-0108). Prisma and the clock arrive from their global
 * modules.
 *
 * `SellerService` is exported for two callers that do not exist yet and are
 * both named in the task: TASK-0024's demo issuing path calls `openDemoStore`
 * so a visitor's store is `ACTIVE` without anybody reviewing it, and any
 * endpoint that needs the state gate calls `assertCapability`. An endpoint that
 * has already loaded the store — `ProductService` has — imports the pure
 * `assertSellerActive` instead and pays no second query.
 */
@Module({
  controllers: [SellerController, AdminSellerController],
  providers: [SellerService],
  exports: [SellerService],
})
export class SellersModule {}
