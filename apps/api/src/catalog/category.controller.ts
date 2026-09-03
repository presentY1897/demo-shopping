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
import type { CategoryListResponse, CategoryResponse, CategoryTreeResponse } from '@shopping/shared'
import {
  categoryIdSchema,
  categoryTreeQueryParamsSchema,
  createCategoryRequestSchema,
  moveCategoryRequestSchema,
  reorderCategoriesRequestSchema,
  updateCategoryRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CategoryService } from './category.service.js'

/**
 * The category tree over HTTP (TASK-0028).
 *
 * Reading is `catalog.read`, which every role holds with scope `any` — the
 * catalogue is shared (DECISIONS 2), and a seller has to pick a category from
 * it. Writing is `catalog.write` and deleting is `catalog.delete`, neither of
 * which a buyer or a seller has: the tree is platform data, and
 * `platformOwnership` in the service is what keeps a demo administrator out of
 * it as well.
 *
 * Every body and every parameter is parsed with a schema from
 * `@shopping/shared`, so the shapes the front-ends are typed against and the
 * shapes this controller accepts are the same objects (gate C1).
 */
@Controller({ path: 'categories', version: '1' })
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @RequirePermission('catalog.read')
  tree(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<CategoryTreeResponse> {
    return this.categories.tree(principal, parseInput(categoryTreeQueryParamsSchema, query))
  }

  @Post()
  @RequirePermission('catalog.write')
  create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<CategoryResponse> {
    return this.categories.create(principal, parseInput(createCategoryRequestSchema, body))
  }

  /**
   * Declared before `:id` handlers on purpose — Nest matches routes in
   * declaration order, and `reorder` would otherwise be read as an id.
   */
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.write')
  reorder(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<CategoryListResponse> {
    return this.categories.reorder(principal, parseInput(reorderCategoriesRequestSchema, body))
  }

  @Patch(':id')
  @RequirePermission('catalog.write')
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CategoryResponse> {
    return this.categories.update(
      principal,
      parseInput(categoryIdSchema, Number(id), 'id'),
      parseInput(updateCategoryRequestSchema, body),
    )
  }

  /** 200, not 201: a move creates nothing, it answers with the moved node. */
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('catalog.write')
  move(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CategoryResponse> {
    return this.categories.move(
      principal,
      parseInput(categoryIdSchema, Number(id), 'id'),
      parseInput(moveCategoryRequestSchema, body),
    )
  }

  /**
   * Retires a category. The row and its id survive — ids are never reused, so a
   * `categoryId` in an old order snapshot keeps meaning what it meant.
   */
  @Delete(':id')
  @RequirePermission('catalog.delete')
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<CategoryResponse> {
    return this.categories.remove(principal, parseInput(categoryIdSchema, Number(id), 'id'))
  }
}
