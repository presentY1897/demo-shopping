import { Module } from '@nestjs/common'

import { AttributeController } from './attribute.controller.js'
import { AttributeService } from './attribute.service.js'
import { CategoryController } from './category.controller.js'
import { CategoryService } from './category.service.js'

/** The catalogue. Prisma and the clock arrive from their global modules. */
@Module({
  controllers: [CategoryController, AttributeController],
  providers: [CategoryService, AttributeService],
  // `AttributeService.validateAttributes` is the only sanctioned way to judge a
  // product's `attributes` (TASK-0030 4장), so the module that will save
  // products (TASK-0032) has to be able to inject it.
  exports: [AttributeService],
})
export class CatalogModule {}
