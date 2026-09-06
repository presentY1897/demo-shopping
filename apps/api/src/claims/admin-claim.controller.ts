import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import type {
  AdminClaimListResponse,
  AdminFailedRefundListResponse,
  AdminOverdueClaimsResponse,
  ClaimResponse,
} from '@shopping/shared'
import {
  adminClaimListQueryParamsSchema,
  adminFailedRefundQueryParamsSchema,
  adminOverdueClaimsQueryParamsSchema,
  createAdminClaimRequestSchema,
  dismissClaimAppealRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { AdminClaimService } from './admin-claim.service.js'
import { ClaimAppealService } from './claim-appeal.service.js'

/**
 * 관리자 콘솔이 쓰는 클레임 라우트 (TASK-0071).
 *
 * **`/claims` 를 대체하지 않는다.** 클레임 하나를 읽는 것은 여전히
 * `GET /claims/:id` 이고(`claim.read` 가 `any` 라 관리자는 전부 본다), 승인·거절·검수도
 * 여전히 `ClaimController` · `ReturnController` 다 — 전이표에 `ADMIN` 이 이미 들어
 * 있는 화살표는 그 문으로 지난다. 여기 있는 것은 **그 문들로는 할 수 없는 것**뿐이다.
 *
 * | 라우트 | 퍼미션 | 왜 그것인가 |
 * | --- | --- | --- |
 * | 목록 · 지연 · 실패한 환불 | `claim.read` | 읽기다. 데모 관리자에게도 `any` 로 남는다 (`erd.md` 1장 — 「시드·실계정 데이터는 조회만」) |
 * | 강제 처리 | `claim.handle` | 관리자가 대신 내는 신청은 신청이 아니라 **처리**다. `order.write` 를 요구하면 아무도 못 부른다 — `ADMIN_OPERATOR` 에게 그 퍼미션이 없다 |
 * | 이의 기각 | `claim.handle` | 〃 |
 *
 * ## 데모 스코프가 표에만 있는 값이 되지 않게 하는 것
 *
 * `DEMO_ADMIN` 은 `claim.handle` 을 `demo` 로 좁혀 갖는다(`narrowToDemo`). 그 값이
 * 실제로 물려면 **라우트가 `assertResourceAccess` 를 지나야** 하고, 위 두 쓰기가
 * 지나는 자리는 `AdminClaimService` 에 적혀 있다 — 가게 쪽과 구매자 쪽 **양쪽**이다.
 *
 * ## `overdue` 가 `:id` 보다 위에 있어야 한다는 함정은 여기 없다
 *
 * 이 컨트롤러에 `GET admin/claims/:id` 가 **없기 때문**이다. 클레임 하나는
 * `GET /claims/:id` 가 답하므로 경로가 겹치지 않는다. 나중에 상세를 여기 더한다면
 * `overdue` 아래에 두어야 하고, 그 이유는 `SellerClaimController` 가 적어 두었다.
 */
@Controller({ version: '1' })
export class AdminClaimController {
  constructor(
    private readonly admin: AdminClaimService,
    private readonly appeals: ClaimAppealService,
  ) {}

  /** 전체 클레임 — 판매자 · 구매자 · 상태 · 단계 · 유형 · 기간 · 이의 (F1). */
  @Get('admin/claims')
  @RequirePermission('claim.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<AdminClaimListResponse> {
    return this.admin.list(principal, parseInput(adminClaimListQueryParamsSchema, query))
  }

  /**
   * 기한을 넘긴 채 처리를 기다리는 클레임 (F7).
   *
   * **목록의 필터가 아니라 라우트인 이유**는 기한이 영업일이라 SQL 이 계산하지 못하기
   * 때문이다. 자세한 것은 `AdminClaimService.overdue` 에 있다.
   */
  @Get('admin/claims/overdue')
  @RequirePermission('claim.read')
  overdue(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<AdminOverdueClaimsResponse> {
    return this.admin.overdue(
      principal,
      parseInput(adminOverdueClaimsQueryParamsSchema, query).limit,
    )
  }

  /**
   * 나가지 못한 환불 (TASK-0068 R3 이 넘긴 항목).
   *
   * 경로가 `admin/claim-refunds` 인 것은 세는 단위가 클레임이 아니라 **환불**이기
   * 때문이다 — 한 클레임에 환불은 하나지만, 이 목록이 답하는 것은 「어떤 환불이 못
   * 나갔나」이고 정렬도 시도 시각이다.
   */
  @Get('admin/claim-refunds/failed')
  @RequirePermission('claim.read')
  failedRefunds(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<AdminFailedRefundListResponse> {
    return this.admin.failedRefunds(
      principal,
      parseInput(adminFailedRefundQueryParamsSchema, query).limit,
    )
  }

  /**
   * 강제 처리 — 관리자가 대신 신청하고 그 자리에서 승인한다 (F3 · F4).
   *
   * 201 이다. **실제로 행이 하나 생긴다** — 그것이 이 TASK 의 설계 판단이고
   * (`AdminClaimService` 의 표), 답에 실리는 클레임은 방금 만들어진 개입이다.
   */
  @Post('admin/claims')
  @RequirePermission('claim.handle')
  force(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<ClaimResponse> {
    return this.admin.force(principal, parseInput(createAdminClaimRequestSchema, body))
  }

  /**
   * 이의를 기각한다 — 판매자의 거절이 유지된다.
   *
   * **인용에 해당하는 라우트가 없는 것이 일부러다.** 인용은 곧 위의 강제 처리이고,
   * 그쪽이 개입 클레임과 **같은 트랜잭션에서** 이의를 인용으로 닫는다. 따로 두면
   * 「인용됐는데 아무 개입도 없는 이의」가 만들어진다.
   *
   * 200 이다 — 만들어지는 것이 없고, 답은 보고 있던 그 클레임이 움직인 모습이다.
   */
  @Post('admin/claims/:id/appeal/dismiss')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('claim.handle')
  dismissAppeal(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ClaimResponse> {
    return this.appeals.dismiss(principal, id, parseInput(dismissClaimAppealRequestSchema, body))
  }
}
