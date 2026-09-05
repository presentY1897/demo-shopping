import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import type {
  BrandNameAvailabilityResponse,
  SellerResponse,
  StorefrontSellerResponse,
} from '@shopping/shared'
import {
  brandNameAvailabilityQuerySchema,
  sellerApplicationRequestSchema,
  sellerIdSchema,
  sellerStoreUpdateRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerService } from './seller.service.js'

/**
 * The seller's own side of onboarding (TASK-0108).
 *
 * Everything here is about **one** store — the caller's — so no route takes an
 * id. That is not a shortcut: an endpoint that accepted a store id would need a
 * scope check to stop a seller naming somebody else's, and the check would be
 * the only thing standing between a buyer with `seller.write:own` and another
 * brand's copy. `me` cannot be pointed at anybody.
 *
 * `seller.write` is held by `BUYER` as well as `SELLER_OWNER`, because applying
 * is done by somebody who is not a seller yet (`role-permissions.ts`).
 */
@Controller({ path: 'sellers', version: '1' })
export class SellerController {
  constructor(private readonly sellers: SellerService) {}

  /**
   * Applies to sell, or applies again after a rejection.
   *
   * 201 in both cases: a re-application creates a review, which is the thing
   * the operator's queue is a list of, even though the row it hangs on already
   * existed.
   */
  @Post('applications')
  @RequirePermission('seller.write')
  apply(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<SellerResponse> {
    return this.sellers.apply(principal, parseInput(sellerApplicationRequestSchema, body))
  }

  /** The caller's store — its status, and the reason behind it (F4). */
  @Get('me')
  @RequirePermission('seller.read')
  me(@Principal() principal: RequestPrincipal): Promise<SellerResponse> {
    return this.sellers.me(principal)
  }

  /** Brand name, introduction and logo. Not the slug (R4). */
  @Patch('me')
  @RequirePermission('seller.write')
  update(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<SellerResponse> {
    return this.sellers.updateStore(principal, parseInput(sellerStoreUpdateRequestSchema, body))
  }

  /**
   * Whether a brand name is free, for a form that wants to say so before the
   * submit button is pressed.
   *
   * Guarded by `seller.write` rather than a read permission: the answer is only
   * useful to somebody about to write, and leaving it open would turn it into a
   * way to enumerate which brand names exist.
   */
  @Get('brand-name-availability')
  @RequirePermission('seller.write')
  brandNameAvailability(@Query() query: unknown): Promise<BrandNameAvailabilityResponse> {
    const { value } = parseInput(brandNameAvailabilityQuerySchema, query)

    return this.sellers.brandNameAvailability(value)
  }

  /**
   * One store as a shopper sees it — the brand page (TASK-0044 4.2).
   *
   * Public, because a brand page is one a visitor who has not signed in must be
   * able to open, and so must a crawler. `ACTIVE` only; anything else is a 404,
   * because telling a visitor that a store is *under review* publishes the
   * review state of every application.
   *
   * **Declared last on purpose.** Nest takes the first route that matches, and
   * `:id` would happily read `me` and `brand-name-availability` as ids — the
   * same trap `categoryReorder` carries a comment about.
   */
  @Get(':id')
  @PublicEndpoint()
  storefront(@Param('id') id: string): Promise<StorefrontSellerResponse> {
    return this.sellers.storefront(parseInput(sellerIdSchema, id, 'id'))
  }
}
