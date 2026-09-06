import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type {
  ClaimableResponse,
  ClaimListResponse,
  ClaimResponse,
  ClaimTransitionResponse,
} from '@shopping/shared'
import {
  claimListQueryParamsSchema,
  claimTransitionRequestSchema,
  createClaimRequestSchema,
  fileClaimAppealRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ClaimAppealService } from './claim-appeal.service.js'
import { ClaimService } from './claim.service.js'

/**
 * 취소 · 반품의 라우트 (TASK-0065).
 *
 * **퍼미션이 라우트마다 다르고, 그 차이가 이 도메인의 규칙 절반이다.**
 *
 * | 라우트 | 퍼미션 | 왜 |
 * | --- | --- | --- |
 * | 신청 | `order.write` | 신청은 **자기 주문에 대한 행위**다. 구매자가 갖고 있는 것이 그것이고, `claim.handle` 을 요구하면 아무도 신청할 수 없다 |
 * | 전이 | `claim.handle` | 승인·거절·검수는 **파는 쪽의 판단**이다. 구매자에게 이 퍼미션이 없는 것이 「신청자가 자기 클레임을 승인하지 못한다」의 첫 방어선이고, 전이표가 두 번째다 |
 * | 조회 | `claim.read` | 구매자·판매자·관리자가 **같은 모양**을 본다. 다른 것은 볼 수 있는가뿐이고, 그 판정은 서버가 한다 |
 *
 * **주체를 요청이 주장하지 않는다.** 요청한 사람이 그 주문의 판 사람인지 산 사람인지는
 * 서비스가 행에서 읽어 정한다 — 주장하게 두면 구매자가 `SELLER` 를 주장해 자기
 * 클레임을 승인한다.
 */
@Controller({ version: '1' })
export class ClaimController {
  constructor(
    private readonly claims: ClaimService,
    private readonly appeals: ClaimAppealService,
  ) {}

  /**
   * 취소 · 반품을 신청한다 (F1 ~ F6).
   *
   * **유형을 받지 않는다.** 취소인지 반품인지는 주문 상태가 정한다 — 고르게 두면
   * 배송된 물건을 취소로 신청해 재고가 두 번 늘어난다.
   */
  @Post('claims')
  @RequirePermission('order.write')
  create(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<ClaimResponse> {
    return this.claims.create(principal, parseInput(createClaimRequestSchema, body))
  }

  /**
   * 다음 상태로 옮긴다 (F7).
   *
   * 멱등이다. 이미 그 상태면 성공으로 답하고 `changed: false` 를 싣는다.
   */
  @Post('claims/:id/transitions')
  @RequirePermission('claim.handle')
  transition(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ClaimTransitionResponse> {
    return this.claims.transition(principal, id, parseInput(claimTransitionRequestSchema, body))
  }

  /**
   * 거절에 **이의를 제기한다** (TASK-0071 F2).
   *
   * **퍼미션이 `order.write` 인 것이 이 라우트의 자리다.** 이의는 자기 주문에 대한
   * 행위라 신청과 같은 축이고, `claim.handle` 을 요구하면 구매자는 아무것도 할 수
   * 없다 — 위 표의 첫 줄과 같은 이유다.
   *
   * 관리자의 답(기각)은 여기가 아니라 `POST /admin/claims/:id/appeal/dismiss` 이고,
   * 인용은 강제 처리 그 자체다 (`POST /admin/claims`).
   */
  @Post('claims/:id/appeal')
  @RequirePermission('order.write')
  appeal(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ClaimResponse> {
    return this.appeals.file(principal, id, parseInput(fileClaimAppealRequestSchema, body))
  }

  /** 클레임 목록. 보이는 범위는 `claim.read` 의 스코프가 정한다. */
  @Get('claims')
  @RequirePermission('claim.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<ClaimListResponse> {
    return this.claims.list(principal, parseInput(claimListQueryParamsSchema, query))
  }

  /** 클레임 하나. */
  @Get('claims/:id')
  @RequirePermission('claim.read')
  get(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<ClaimResponse> {
    return this.claims.get(principal, id)
  }

  /**
   * 「이 주문에 지금 무엇을 몇 개까지 신청할 수 있나」 (F8).
   *
   * **경로가 `seller-orders` 아래인 것은 묻는 대상이 주문이기 때문이다** —
   * `/seller-orders/:id/actions` 가 전이에 대해 답하는 것을 클레임에 대해 답한다.
   * 클레임이 아직 없는 상태에서 묻는 질문이라 `/claims` 아래에 둘 자리가 없다.
   */
  @Get('seller-orders/:id/claimable')
  @RequirePermission('claim.read')
  claimable(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<ClaimableResponse> {
    return this.claims.claimable(principal, id)
  }
}
