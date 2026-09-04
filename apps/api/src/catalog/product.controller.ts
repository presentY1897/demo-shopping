import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import type { ProductListResponse, ProductResponse } from '@shopping/shared'
import {
  createProductRequestSchema,
  productIdSchema,
  productListQueryParamsSchema,
  productPublishRequestSchema,
  updateProductRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ProductService } from './product.service.js'

/**
 * Products over HTTP (TASK-0032).
 *
 * Three permissions, and they are not the catalogue's. `catalog.*` is platform
 * data that only an administrator writes; a product belongs to a **store**, so
 * `product.write` is held by the seller at scope `own` and by an operator at
 * `any`, and the service resolves the row's ownership before either of them
 * gets through. `product.delete` is narrower still — a seller may retire their
 * own listing and an operator may not retire anybody's (TASK-0105 4).
 *
 * Every body and every parameter is parsed with a schema from
 * `@shopping/shared`, so the shapes the front-ends are typed against and the
 * shapes this controller accepts are the same objects (gate C1).
 */
@Controller({ path: 'products', version: '1' })
export class ProductController {
  constructor(private readonly products: ProductService) {}

  /**
   * A page of listings.
   *
   * `sellerId` is optional and its absence is not "every product a caller may
   * see": a seller who omits it is narrowed to their own store by the service,
   * because that is the only scope their grant carries.
   */
  @Get()
  @RequirePermission('product.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<ProductListResponse> {
    return this.products.list(principal, parseInput(productListQueryParamsSchema, query))
  }

  @Get(':id')
  @RequirePermission('product.read')
  get(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<ProductResponse> {
    return this.products.get(principal, parseInput(productIdSchema, id, 'id'))
  }

  @Post()
  @RequirePermission('product.write')
  create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ProductResponse> {
    return this.products.create(principal, parseInput(createProductRequestSchema, body))
  }

  @Patch(':id')
  @RequirePermission('product.write')
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProductResponse> {
    return this.products.update(
      principal,
      parseInput(productIdSchema, id, 'id'),
      parseInput(updateProductRequestSchema, body),
    )
  }

  /**
   * Puts a listing on sale, and takes it off again (TASK-0113).
   *
   * 200 rather than 201: nothing is created, an existing listing changes state.
   *
   * Two endpoints instead of `PATCH { status }`, which would do the same thing.
   * The reason is not the transition but what rides on it — 판매 시작 is the
   * moment the category's required attributes stop being optional, so 저장 and
   * 판매 시작 fail for different reasons and a screen has to be able to say
   * which one it asked for. The service routes both back through `update`, so
   * the row lock, the version check and the price derivation happen once and in
   * one place.
   */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('product.write')
  publish(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProductResponse> {
    return this.products.publish(
      principal,
      parseInput(productIdSchema, id, 'id'),
      parseInput(productPublishRequestSchema, body).version,
    )
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('product.write')
  unpublish(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProductResponse> {
    return this.products.unpublish(
      principal,
      parseInput(productIdSchema, id, 'id'),
      parseInput(productPublishRequestSchema, body).version,
    )
  }

  /**
   * Retires a listing. The row and its variants survive — an order item points
   * at a variant forever, so a hard delete would leave history unable to say
   * what was bought.
   */
  @Delete(':id')
  @RequirePermission('product.delete')
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<ProductResponse> {
    return this.products.remove(principal, parseInput(productIdSchema, id, 'id'))
  }
}
