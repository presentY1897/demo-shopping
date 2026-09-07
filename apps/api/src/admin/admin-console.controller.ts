import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common'
import type {
  AdminOrderPaymentsResponse,
  DemoSweepResponse,
  AdminOrderSearchResponse,
  AdminSellerListResponse,
  DemoAccountListResponse,
  DemoPolicyResponse,
  DemoStatsResponse,
  ProductModerationResponse,
  SellerStatusHistoryResponse,
} from '@shopping/shared'
import {
  adminOrderSearchQueryParamsSchema,
  adminSellerListQueryParamsSchema,
  demoPolicySchema,
  hideProductRequestSchema,
  productIdSchema,
  sellerIdSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { AdminCatalogService } from './admin-catalog.service.js'
import { AdminDemoService } from './admin-demo.service.js'
import { AdminSellerService } from './admin-seller.service.js'

/** 질의 문자열은 전부 문자열이다 — 참/거짓과 수는 여기서 옮긴다. */
function readQuery(raw: Record<string, string>): Record<string, unknown> {
  return {
    ...raw,
    ...(raw.isDemo === undefined ? {} : { isDemo: raw.isDemo === 'true' }),
    ...(raw.failedOnly === undefined ? {} : { failedOnly: raw.failedOnly === 'true' }),
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
  }
}

/**
 * 판매자 관리 · 전체 조회 · 데모 관리 (TASK-0094 · 0095 · 0096).
 *
 * **주문 상태를 직접 바꾸는 문이 여기 없다** (0095 F7). 일부러 없다 — 상태를 손으로
 * 옮기면 재고·정산·환불이 따라오지 않고, 그 어긋남은 몇 단계 뒤에 「정산 금액이
 * 이상하다」로 나타난다. 관리자가 결과를 바꿔야 하면 클레임 개입으로 간다.
 */
@Controller({ path: 'admin', version: '1' })
export class AdminConsoleController {
  constructor(
    private readonly sellers: AdminSellerService,
    private readonly catalog: AdminCatalogService,
    private readonly demo: AdminDemoService,
  ) {}

  // ------------------------------------------------------------ 판매자 관리

  /**
   * `sellers` 가 아니라 `stores` 다.
   *
   * M04 의 심사 콘솔이 `admin/sellers/:id` 를 이미 쓰고 있어, 같은 자리에 이름을
   * 하나 더 두면 **그 이름이 uuid 로 읽힌다** — 그리고 증상은 404 가 아니라 400 이라
   * 원인이 라우팅이라는 것도 안 보인다. 묻는 축이 다르므로 경로도 다르다: 저쪽은
   * 「이 신청을 승인할까」이고 이쪽은 「어느 스토어를 봐야 하나」다.
   */
  @Get('stores')
  @RequirePermission('seller.read')
  sellerList(
    @Principal() principal: RequestPrincipal,
    @Query() query: Record<string, string>,
  ): Promise<AdminSellerListResponse> {
    return this.sellers.list(
      principal,
      parseInput(adminSellerListQueryParamsSchema, readQuery(query)),
    )
  }

  @Get('stores/:sellerId/history')
  @RequirePermission('seller.read')
  sellerHistory(
    @Principal() principal: RequestPrincipal,
    @Param('sellerId') sellerId: string,
  ): Promise<SellerStatusHistoryResponse> {
    return this.sellers.history(principal, parseInput(sellerIdSchema, sellerId, 'sellerId'))
  }

  // ------------------------------------------------------------ 상품 강제 숨김

  /** `catalog.write` 라 데모 관리자는 `demo` 로 좁혀져 있다 — 실계정 상품은 못 내린다. */
  @Post('products/:productId/hidden')
  @RequirePermission('catalog.write')
  hideProduct(
    @Principal() principal: RequestPrincipal,
    @Param('productId') productId: string,
    @Body() body: unknown,
  ): Promise<ProductModerationResponse> {
    return this.catalog.hide(
      principal,
      parseInput(productIdSchema, productId, 'productId'),
      parseInput(hideProductRequestSchema, body),
    )
  }

  @Delete('products/:productId/hidden')
  @RequirePermission('catalog.write')
  unhideProduct(
    @Principal() principal: RequestPrincipal,
    @Param('productId') productId: string,
  ): Promise<ProductModerationResponse> {
    return this.catalog.unhide(principal, parseInput(productIdSchema, productId, 'productId'))
  }

  // ---------------------------------------------------------------- 주문 조회

  @Get('orders')
  @RequirePermission('order.read')
  orders(
    @Principal() principal: RequestPrincipal,
    @Query() query: Record<string, string>,
  ): Promise<AdminOrderSearchResponse> {
    return this.catalog.searchOrders(
      principal,
      parseInput(adminOrderSearchQueryParamsSchema, readQuery(query)),
    )
  }

  @Get('orders/:orderId/payments')
  @RequirePermission('order.read')
  payments(
    @Principal() principal: RequestPrincipal,
    @Param('orderId') orderId: string,
  ): Promise<AdminOrderPaymentsResponse> {
    return this.catalog.payments(principal, parseInput(z.uuid(), orderId, 'orderId'))
  }

  // ---------------------------------------------------------------- 데모 관리

  @Get('demo/policy')
  @RequirePermission('demo.manage')
  policy(): Promise<DemoPolicyResponse> {
    return this.demo.policy()
  }

  @Put('demo/policy')
  @RequirePermission('demo.manage')
  updatePolicy(@Body() body: unknown): Promise<DemoPolicyResponse> {
    return this.demo.updatePolicy(parseInput(demoPolicySchema, body))
  }

  @Get('demo/accounts')
  @RequirePermission('demo.manage')
  accounts(@Query() query: Record<string, string>): Promise<DemoAccountListResponse> {
    return this.demo.accounts(
      parseInput(
        z.object({
          failedOnly: z.boolean().optional(),
          cursor: z.string().max(64).optional(),
          limit: z.int().min(1).max(100).optional(),
        }),
        readQuery(query),
      ),
    )
  }

  @Get('demo/stats')
  @RequirePermission('demo.manage')
  stats(@Query() query: Record<string, string>): Promise<DemoStatsResponse> {
    return this.demo.stats(
      parseInput(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }), query),
    )
  }

  /** 강제 만료 (F2). 지우지 않고 만료 시각을 당긴다 — 지우는 순서는 청소기만 안다. */
  @Post('demo/accounts/:userId/expiry')
  @RequirePermission('demo.manage')
  @HttpCode(204)
  expire(@Param('userId') userId: string): Promise<void> {
    return this.demo.expire(parseInput(z.uuid(), userId, 'userId'))
  }

  /** 지금 한 번 정리한다 (F5). 실패한 계정은 이미 만료돼 있으므로 함께 집힌다. */
  @Post('demo/sweeps')
  @RequirePermission('demo.manage')
  sweep(): Promise<DemoSweepResponse> {
    return this.demo.sweep()
  }
}
