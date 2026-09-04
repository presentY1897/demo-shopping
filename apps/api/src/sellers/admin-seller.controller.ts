import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import type { SellerResponse, SellerReviewListResponse } from '@shopping/shared'
import {
  sellerDecisionRequestSchema,
  sellerIdSchema,
  sellerReasonedDecisionRequestSchema,
  sellerReviewListQueryParamsSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerService } from './seller.service.js'

/**
 * The operator's review queue (TASK-0108).
 *
 * **The listing and the detail require `seller.approve`, not `seller.read`.**
 * TASK-0108 4장 wrote `seller.read:any` for both, and that grant is held by
 * every `BUYER` — a storefront is public, so reading a store is not an
 * administrative act. Requiring it here would have let any signed-in buyer page
 * through every pending application with the applicant's account id attached.
 * The queue is the approving officer's worklist, so the permission that decides
 * it is the one that approves (9장, 2026-09-04).
 *
 * **정지·해제 are `seller.suspend`,** which only `ADMIN_SUPER` holds. Cutting a
 * store's trading is separated from everyday operation, and the reversal is
 * held to the same permission — a lower bar for undoing it would be a way
 * around the suspension.
 *
 * A demo administrator holds `seller.approve` narrowed to `demo`. They see the
 * whole queue, because reading is not narrowed (`docs/design/erd.md` 1), and
 * `SellerService.decide` refuses them a real applicant when they try to act
 * (F12).
 */
@Controller({ path: 'admin/sellers', version: '1' })
export class AdminSellerController {
  constructor(private readonly sellers: SellerService) {}

  @Get()
  @RequirePermission('seller.approve')
  list(@Query() query: unknown): Promise<SellerReviewListResponse> {
    return this.sellers.review(parseInput(sellerReviewListQueryParamsSchema, query))
  }

  @Get(':id')
  @RequirePermission('seller.approve')
  detail(@Param('id') id: string): Promise<SellerResponse> {
    return this.sellers.reviewOne(parseInput(sellerIdSchema, id, 'id'))
  }

  /**
   * 승인. The store becomes `ACTIVE` and its owner gains `SELLER_OWNER` in the
   * same transaction (F2).
   *
   * 200, not 201: nothing is created that the caller could go and fetch — the
   * answer is the store they were already looking at, moved.
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('seller.approve')
  approve(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerResponse> {
    return this.sellers.decide(
      principal,
      parseInput(sellerIdSchema, id, 'id'),
      'approve',
      parseInput(sellerDecisionRequestSchema, body),
    )
  }

  /** 반려. The reason is required — the applicant has to know what to fix (F4). */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('seller.approve')
  reject(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerResponse> {
    return this.sellers.decide(
      principal,
      parseInput(sellerIdSchema, id, 'id'),
      'reject',
      parseInput(sellerReasonedDecisionRequestSchema, body),
    )
  }

  /** 정지. The reason is required, and it is shown to the seller. */
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('seller.suspend')
  suspend(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerResponse> {
    return this.sellers.decide(
      principal,
      parseInput(sellerIdSchema, id, 'id'),
      'suspend',
      parseInput(sellerReasonedDecisionRequestSchema, body),
    )
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('seller.suspend')
  reinstate(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerResponse> {
    return this.sellers.decide(
      principal,
      parseInput(sellerIdSchema, id, 'id'),
      'reinstate',
      parseInput(sellerDecisionRequestSchema, body),
    )
  }
}
