import { Module } from '@nestjs/common'

import { StockModule } from '../stock/stock.module.js'

import { AttributeController } from './attribute.controller.js'
import { AttributeService } from './attribute.service.js'
import { CategoryController } from './category.controller.js'
import { CategoryService } from './category.service.js'
import { ProductController } from './product.controller.js'
import { ProductService } from './product.service.js'

/** The catalogue. Prisma and the clock arrive from their global modules. */
@Module({
  // Every change to a variant's stock goes through `StockService`, product
  // writes included (TASK-0036 4.7) — so the catalogue imports it rather than
  // writing the column itself.
  imports: [StockModule],
  controllers: [CategoryController, AttributeController, ProductController],
  providers: [CategoryService, AttributeService, ProductService],
  // `AttributeService.validateAttributes` is the only sanctioned way to judge a
  // product's `attributes` (TASK-0030 4장), so the module that will save
  // products (TASK-0032) has to be able to inject it.
  exports: [AttributeService, ProductService],
})
export class CatalogModule {}
