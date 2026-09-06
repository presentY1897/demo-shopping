import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type {
  BulkApproveSettlementsResponse,
  SellerRevenueResponse,
  SettlementDetailResponse,
  SettlementListResponse,
  SettlementOutlookResponse,
  SettlementResponse,
  SettlementRunResponse,
} from '@shopping/shared'
import {
  bulkApproveSettlementsRequestSchema,
  holdSettlementRequestSchema,
  sellerIdSchema,
  sellerRevenueQueryParamsSchema,
  settlementListQueryParamsSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerRevenueService } from './seller-revenue.service.js'
import { SettlementBatchService } from './settlement-batch.service.js'
import { SettlementConsoleService } from './settlement-console.service.js'

const settlementIdSchema = z.uuid()

/**
 * 정산 배치의 수동 실행 (TASK-0080).
 *
 * 스케줄러가 한 시간마다 같은 일을 하므로 이 문은 **놓친 회차를 즉시 따라잡는**
 * 자리다. `reservation.sweep` 이 예약 청소기에 대해 하는 일과 같고, 그쪽 컨트롤러가
 * 이 모양의 원본이다.
 *
 * **몇 번을 눌러도 결과가 같다.** 한 판매자 몫은 한 번만 정산되고(F6), 이미 적힌
 * 차감은 다시 계산돼도 같은 값이 된다 — 배치가 세는 것이 「무슨 일이 있었나」가
 * 아니라 「지금 정산돼야 하는 금액과 이미 정산된 금액의 차이」이기 때문이다.
 *
 * ## 검토의 문들 (TASK-0081)
 *
 * 읽기는 `settlement.read`, 승인·보류는 `settlement.approve`, 지급은
 * `settlement.pay` 다. 셋을 나눈 이유는 **되돌릴 수 있는 정도가 다르기** 때문이고,
 * F7 의 「데모 관리자는 지급 확정 불가」가 여기서 따로 판정되지 않는 것도 그래서다 —
 * 데모 관리자는 운영자에서 파생되고 운영자에게는 뒤의 둘이 없다.
 *
 * ## 라우트 순서
 *
 * `settlements/batch` 와 `settlements/approvals` 는 `settlements/:id` 보다 **위에**
 * 있어야 한다. 아래에 두면 `:id` 가 `batch` 를 uuid 로 읽으려다 400 을 낸다.
 */
@Controller({ version: '1' })
export class SettlementController {
  constructor(
    private readonly batch: SettlementBatchService,
    private readonly console: SettlementConsoleService,
    private readonly revenue: SellerRevenueService,
  ) {}

  /**
   * 판매자의 기간별 매출 (TASK-0082 F5 · F6).
   *
   * `settlements` 와 다른 라우트인 이유는 **다른 시계로 세기** 때문이다. 매출은
   * 주문이 일어난 날로 세고 정산은 구매확정된 날로 센다 — 한 라우트가 둘을 답하면
   * 읽는 쪽이 어느 시계의 숫자인지 매번 되짚어야 한다.
   */
  @Get('seller-revenue')
  @RequirePermission('settlement.read')
  sellerRevenue(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<SellerRevenueResponse> {
    return this.revenue.revenue(principal, parseInput(sellerRevenueQueryParamsSchema, query))
  }

  /** 아직 정산서에 실리지 않은 돈 — **두 단계로 나눠서** (TASK-0082 F4). */
  @Get('seller-settlement-outlook')
  @RequirePermission('settlement.read')
  settlementOutlook(
    @Principal() principal: RequestPrincipal,
    @Query('sellerId') sellerId?: string,
  ): Promise<SettlementOutlookResponse> {
    return this.revenue.outlook(
      principal,
      sellerId === undefined ? undefined : parseInput(sellerIdSchema, sellerId, 'sellerId'),
    )
  }

  @Post('settlements/batch')
  @RequirePermission('settlement.run')
  run(): Promise<SettlementRunResponse> {
    return this.batch.run()
  }

  /**
   * 한꺼번에 승인한다 (F6).
   *
   * `settlements/:id` 보다 **위에** 있어야 한다. 그리고 답에 실패 목록이 함께
   * 오는 것이 이 문의 요점이다 — 실패를 조용히 빼면 남은 건은 아무도 다시 보지 않고,
   * 그 건들이야말로 사람이 봐야 하는 것들이다.
   */
  @Post('settlements/approvals')
  @RequirePermission('settlement.approve')
  approveMany(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<BulkApproveSettlementsResponse> {
    const { ids } = parseInput(bulkApproveSettlementsRequestSchema, body)

    return this.console.bulkApprove(principal.userId, ids)
  }

  /** 정산서 목록과 **필터 전체의 합계**. 스토어를 지정하지 않으면 플랫폼 전체다. */
  @Get('settlements')
  @RequirePermission('settlement.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<SettlementListResponse> {
    return this.console.list(principal, parseInput(settlementListQueryParamsSchema, query))
  }

  /** 계산 근거를 항목별로 펼친다 (F1 · F2). */
  @Get('settlements/:id')
  @RequirePermission('settlement.read')
  detail(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SettlementDetailResponse> {
    return this.console.detail(principal, parseInput(settlementIdSchema, id, 'id'))
  }

  /** 승인한다 (F3). 대기와 보류에서 온다. */
  @Post('settlements/:id/approval')
  @RequirePermission('settlement.approve')
  async approve(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SettlementResponse> {
    const settlementId = parseInput(settlementIdSchema, id, 'id')

    return { settlement: await this.console.approve(principal.userId, settlementId) }
  }

  /** 분쟁·이상 건으로 보류한다 (F4). **사유 없이는 들어올 수 없다.** */
  @Post('settlements/:id/hold')
  @RequirePermission('settlement.approve')
  async hold(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SettlementResponse> {
    const settlementId = parseInput(settlementIdSchema, id, 'id')
    const { reason } = parseInput(holdSettlementRequestSchema, body)

    return { settlement: await this.console.hold(principal.userId, settlementId, reason) }
  }

  /**
   * 지급 완료로 옮긴다 (F5 · F7). **실제 이체는 없다** — 상태만 바뀐다.
   *
   * `settlement.pay` 는 최고 관리자만 갖는다. 데모 관리자가 여기서 막히는 것은 이
   * 라우트의 조건문이 아니라 **권한 목록의 빈자리**가 만든다.
   */
  @Post('settlements/:id/payment')
  @RequirePermission('settlement.pay')
  async pay(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SettlementResponse> {
    const settlementId = parseInput(settlementIdSchema, id, 'id')

    return { settlement: await this.console.pay(principal.userId, settlementId) }
  }
}
