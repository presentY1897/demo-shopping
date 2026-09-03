import { Module } from '@nestjs/common'

import { CategoryController } from './category.controller.js'
import { CategoryService } from './category.service.js'

/** The catalogue. Prisma and the clock arrive from their global modules. */
@Module({
  controllers: [CategoryController],
  providers: [CategoryService],
})
export class CatalogModule {}
