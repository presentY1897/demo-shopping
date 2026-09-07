import { Module } from '@nestjs/common'

import { SearchModule } from '../search/search.module.js'
import { CollectionsModule } from '../collections/collections.module.js'
import { StockModule } from '../stock/stock.module.js'

import { AttributeController } from './attribute.controller.js'
import { AttributeService } from './attribute.service.js'
import { CategoryController } from './category.controller.js'
import { CategoryService } from './category.service.js'
import { ProductController } from './product.controller.js'
import { ProductService } from './product.service.js'
import { SellerProductController } from './seller-product.controller.js'
import { SellerProductService } from './seller-product.service.js'
import { VariantStockController } from './variant-stock.controller.js'

/** The catalogue. Prisma and the clock arrive from their global modules. */
@Module({
  // Every change to a variant's stock goes through `StockService`, product
  // writes included (TASK-0036 4.7) — so the catalogue imports it rather than
  // writing the column itself.
  // 상품 상세가 「본 것」을 적는다 (TASK-0087 F1). 답을 만든 뒤에 적고 기다리지
  // 않으므로 조회의 비용에 들어가지 않는다 — 반대 방향의 의존은 없다.
  imports: [StockModule, SearchModule, CollectionsModule],
  controllers: [
    CategoryController,
    AttributeController,
    ProductController,
    // The seller console's own reads and the stock adjustment (TASK-0115).
    // `VariantStockController` shares the `variants` prefix with TASK-0036's
    // `StockController` — a resource path rather than a role path, which is
    // where the ledger already lives.
    SellerProductController,
    VariantStockController,
  ],
  providers: [CategoryService, AttributeService, ProductService, SellerProductService],
  // `AttributeService.validateAttributes` is the only sanctioned way to judge a
  // product's `attributes` (TASK-0030 4장), so the module that will save
  // products (TASK-0032) has to be able to inject it.
  exports: [AttributeService, ProductService],
})
export class CatalogModule {}
