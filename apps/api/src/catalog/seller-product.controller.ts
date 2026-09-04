import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import type {
  ProductBulkStatusResponse,
  ProductResponse,
  SellerProductListResponse,
  SellerVariantListResponse,
} from '@shopping/shared'
import {
  productBulkStatusRequestSchema,
  productIdSchema,
  sellerProductListQueryParamsSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerProductService } from './seller-product.service.js'

/**
 * The seller console's catalogue page (TASK-0115).
 *
 * **The one place in this repository where a path carries a role.** Every other
 * controller is named after a resource — `products`, `categories`, `variants` —
 * and TASK-0036 moved the ledger out from under `/seller` for exactly that
 * reason. These three routes are the exception on purpose: they are not "the
 * products, narrowed", they are **the console's list of things to manage**.
 * They take no `sellerId`, they answer only about the caller's own store, and a
 * principal with no store is refused however wide their grants are. An operator
 * reading somebody's catalogue uses `GET /products?sellerId=` and gets the
 * storefront's shape, which is a different answer to a different question.
 *
 * Every parameter and body is parsed with a schema from `@shopping/shared`, so
 * the shapes TASK-0116 is typed against and the shapes this controller accepts
 * are the same objects (gate C1).
 */
@Controller({ path: 'seller/products', version: '1' })
export class SellerProductController {
  constructor(private readonly console: SellerProductService) {}

  /**
   * A page of the caller's listings, with the aggregates a management screen
   * decides from: total stock, the cheapest variant, whether stock is running
   * out, and the thumbnail.
   */
  @Get()
  @RequirePermission('product.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<SellerProductListResponse> {
    return this.console.list(principal, parseInput(sellerProductListQueryParamsSchema, query))
  }

  /**
   * Puts several listings on or off sale.
   *
   * 200 rather than 201: nothing is created. Declared before `:id/duplicate`
   * for readability only — the two patterns differ in shape, so no ordering is
   * required for `status` not to be read as an id.
   */
  @Post('status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('product.write')
  changeStatuses(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ProductBulkStatusResponse> {
    return this.console.changeStatuses(principal, parseInput(productBulkStatusRequestSchema, body))
  }

  /** The listing's live variants, each with its combination already spelled out. */
  @Get(':id/variants')
  @RequirePermission('product.read')
  variants(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SellerVariantListResponse> {
    return this.console.variants(principal, parseInput(productIdSchema, id, 'id'))
  }

  /**
   * Copies a listing as a `DRAFT` with no stock.
   *
   * 201 and no body: the request says which listing, and everything about the
   * copy is decided from the original. A body would be a second way to describe
   * a product, which is what `POST /products` already is.
   */
  @Post(':id/duplicate')
  @RequirePermission('product.write')
  duplicate(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<ProductResponse> {
    return this.console.duplicate(principal, parseInput(productIdSchema, id, 'id'))
  }
}
