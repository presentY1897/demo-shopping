import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import type { AttributeListResponse, AttributeResponse } from '@shopping/shared'
import {
  attributeIdSchema,
  attributeListQueryParamsSchema,
  createAttributeRequestSchema,
  updateAttributeRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { AttributeService } from './attribute.service.js'

/**
 * Attribute definitions over HTTP (TASK-0030).
 *
 * The same three permissions as the category tree, for the same reason: this is
 * platform data that every role reads — a seller filling in a product form needs
 * the definitions of the category they picked — and that only an administrator
 * writes. `platformOwnership` in the service is what additionally keeps a demo
 * administrator out, whose `catalog.write` is narrowed to the `demo` scope.
 *
 * There is deliberately **no endpoint that validates values**. Validation is a
 * service method the product save path calls (TASK-0030 4.5); a surface that
 * only validates would invite "it passed, so the save will succeed", which stops
 * being true the moment a definition changes in between.
 *
 * Every body and every parameter is parsed with a schema from
 * `@shopping/shared`, so the shapes the front-ends are typed against and the
 * shapes this controller accepts are the same objects (gate C1).
 */
@Controller({ path: 'attributes', version: '1' })
export class AttributeController {
  constructor(private readonly attributes: AttributeService) {}

  /**
   * The definitions that apply to one category.
   *
   * `categoryId` is required rather than optional: an attribute list with no
   * category is a list of every definition in the platform, which is a report
   * and not something any screen in this product asks for.
   */
  @Get()
  @RequirePermission('catalog.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<AttributeListResponse> {
    return this.attributes.list(principal, parseInput(attributeListQueryParamsSchema, query))
  }

  @Post()
  @RequirePermission('catalog.write')
  create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<AttributeResponse> {
    return this.attributes.create(principal, parseInput(createAttributeRequestSchema, body))
  }

  @Patch(':id')
  @RequirePermission('catalog.write')
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AttributeResponse> {
    return this.attributes.update(
      principal,
      parseInput(attributeIdSchema, Number(id), 'id'),
      parseInput(updateAttributeRequestSchema, body),
    )
  }

  /**
   * Retires a definition. The row survives, because a product may still carry
   * the key it describes.
   */
  @Delete(':id')
  @RequirePermission('catalog.delete')
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<AttributeResponse> {
    return this.attributes.remove(principal, parseInput(attributeIdSchema, Number(id), 'id'))
  }
}
