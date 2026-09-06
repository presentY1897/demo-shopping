import { Controller, Get, Query } from '@nestjs/common'
import type { PointLedgerResponse, PointSummaryResponse } from '@shopping/shared'
import { pointLedgerQueryParamsSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { PointSummaryService } from './point-summary.service.js'
import { PointsService } from './points.service.js'

/**
 * 내 적립금 (TASK-0077).
 *
 * **읽기뿐이다.** 적립도 사용도 사람이 부르는 것이 아니라 주문이 일으키는 일이라
 * (`points-order-confirmed.ts` · 주문 생성), 이 컨트롤러에 쓰기가 없는 것이 그 구조가
 * 밖에서 보이는 자리다. 잔액을 손으로 고치는 문이 있으면 원장이 진실이라는 성질이
 * 그 문 하나로 무너진다.
 *
 * `user.read` 인 이유는 **자기 계정의 값**이기 때문이다. 적립금에만 쓰이는 퍼미션을
 * 새로 만들지 않은 것은 그것이 「내 것을 읽는다」와 다른 능력이 아니어서다 — 남의
 * 적립금을 읽는 길은 이 라우트에 없다: `userId` 를 받지 않는다.
 */
@Controller({ path: 'me/points', version: '1' })
export class PointController {
  constructor(
    private readonly points: PointsService,
    private readonly summary: PointSummaryService,
  ) {}

  /**
   * 잔액과 그 주변 — 마이페이지 요약과 적립금 화면 머리가 읽는다.
   *
   * 원장과 라우트를 나눈 이유는 **읽는 빈도가 다르기** 때문이다. 요약은 마이페이지를
   * 열 때마다 필요하고 원장은 그 화면에 들어간 사람만 넘긴다.
   */
  @Get()
  @RequirePermission('user.read')
  summaryOf(@Principal() principal: RequestPrincipal): Promise<PointSummaryResponse> {
    return this.summary.summaryOf(principal.userId)
  }

  /**
   * 원장 그대로, 최신순 (F4).
   *
   * 잔액만 보여 주는 화면은 「왜 줄었지」에 답할 수 없다 — 그것이 원장을 그대로
   * 내보내는 이유이고, `balanceAfter` 가 줄마다 실리는 이유다.
   */
  @Get('transactions')
  @RequirePermission('user.read')
  ledger(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<PointLedgerResponse> {
    return this.points.ledger(principal.userId, parseInput(pointLedgerQueryParamsSchema, query))
  }
}
