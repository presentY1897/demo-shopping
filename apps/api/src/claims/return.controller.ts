import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import type { ReturnResponse } from '@shopping/shared'
import { createReturnRequestSchema, inspectReturnRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ReturnService } from './return.service.js'

/**
 * 반품의 라우트 (TASK-0067).
 *
 * **`/claims` 를 대체하지 않는다.** 목록·상세·전이는 여전히 저쪽이고, 여기 있는 것은
 * **반품에만 있는 걸음** 넷이다. 퍼미션은 `ClaimController` 의 표를 그대로 따른다 —
 * 신청은 자기 주문에 대한 행위라 `order.write`, 수거·검수는 파는 쪽의 판단이라
 * `claim.handle`, 조회는 `claim.read` 다.
 *
 * ## 왜 수거·검수가 `POST /claims/:id/transitions` 가 아닌가
 *
 * 그 라우트로도 상태는 옮겨진다. 그런데 **옮겨지기만 한다** — 회수 운송장은 나지
 * 않고 검수 결과는 적히지 않으며, 합격했는데 환불이 시작되지 않는다. 즉 그 길로
 * 가면 「반품완료인데 아무 일도 일어나지 않은 반품」이 만들어지고, 그것은 아무
 * 오류도 내지 않는다.
 *
 * `ShipmentService.ship` 이 `POST /seller-orders/:id/transitions` 가 아닌 것과 **정확히
 * 같은 이유**다: 조건을 만드는 일은 문을 지나는 일과 다르고, 만드는 쪽이 따로 있어야
 * 문이 그것을 요구할 수 있다.
 */
@Controller({ path: 'returns', version: '1' })
export class ReturnController {
  constructor(private readonly returns: ReturnService) {}

  /**
   * 반품을 신청한다 (F1 · F2 · F6).
   *
   * **`fault` 를 받지 않는다.** 귀책 둘은 세 갈래 사유에서 파생되고, 요청이 주장하게
   * 두면 「오배송인데 구매자 귀책」이 만들어진다.
   */
  @Post()
  @RequirePermission('order.write')
  request(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ReturnResponse> {
    return this.returns.request(principal, parseInput(createReturnRequestSchema, body))
  }

  /**
   * 수거를 시작한다 — 회수 운송장 발급 + `RETURN_APPROVED → PICKING_UP` (F3).
   *
   * 몸통이 없다. 운송사도 번호도 서버가 정하고(가상이다), 요청이 고를 것이 하나도
   * 없다 — 발송(`POST /seller-orders/:id/shipment`)이 운송사를 **선택**으로 받는 것과
   * 다른 점이고, 회수는 판매자가 부르는 배차가 아니기 때문이다.
   */
  @Post(':claimId/pickup')
  @RequirePermission('claim.handle')
  pickUp(
    @Principal() principal: RequestPrincipal,
    @Param('claimId') claimId: string,
  ): Promise<ReturnResponse> {
    return this.returns.pickUp(principal, claimId)
  }

  /**
   * 입고 검수 (F4 · F5). 합격이면 환불이 시작되고, 불합격이면 반송장이 난다.
   *
   * 상태가 아니라 **합격 여부**를 받는다. 상태를 고르게 두면 검수가 「반품완료로
   * 옮겨 줘」가 되어 전이표와 검수 결과가 서로 다른 사실을 말할 수 있다.
   */
  @Post(':claimId/inspection')
  @RequirePermission('claim.handle')
  inspect(
    @Principal() principal: RequestPrincipal,
    @Param('claimId') claimId: string,
    @Body() body: unknown,
  ): Promise<ReturnResponse> {
    return this.returns.inspect(principal, claimId, parseInput(inspectReturnRequestSchema, body))
  }

  /** 반품 하나 — 클레임과 부속을 함께. 구매자·판매자·관리자가 같은 모양을 본다. */
  @Get(':claimId')
  @RequirePermission('claim.read')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('claimId') claimId: string,
  ): Promise<ReturnResponse> {
    return this.returns.get(principal, claimId)
  }
}
