import { Module } from '@nestjs/common'

import { StockController } from './stock.controller.js'
import { StockService } from './stock.service.js'

/**
 * The stock ledger (TASK-0036). Prisma and the clock arrive from their global
 * modules.
 *
 * `StockService` is exported because it is the **only** way to change
 * `ProductVariant.stock`: the catalogue imports this module so that a product
 * write can record its movements, and M07's reservations and orders will do the
 * same. Nothing gets to write that column by reaching for Prisma instead.
 */
@Module({
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
