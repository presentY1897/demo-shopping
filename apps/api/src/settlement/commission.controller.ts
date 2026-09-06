import { Body, Controller, Get, Put, Query } from '@nestjs/common'
import type {
  CommissionRateListResponse,
  CommissionRateResponse,
  CommissionSimulationResponse,
} from '@shopping/shared'
import {
  commissionRateListQueryParamsSchema,
  commissionSimulationQueryParamsSchema,
  setCommissionRateRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CommissionService } from './commission.service.js'

/**
 * 수수료율 설정 (TASK-0079).
 *
 * ## 읽기와 쓰기가 다른 퍼미션이다
 *
 * 운영자는 요율을 **보고**, 최고 관리자만 **바꾼다**. F7 의 「데모 관리자는 요율을
 * 변경할 수 없다」가 여기서 따로 판정되지 않는 이유는 그 등급이 운영자에서
 * 파생되고, 운영자에게 `commission.write` 가 없기 때문이다 — 거절은 조건문이 아니라
 * 권한 목록의 **빈자리**가 만든다 (`role-permissions.ts`).
 *
 * ## 라우트가 셋뿐인 이유
 *
 * 요율은 지우지 않는다. 「이 카테고리의 요율을 없앤다」는 「상위 요율로 되돌린다」와
 * 같은 뜻인데, 그것을 표현하려면 닫힌 이력에 「무효화됨」이라는 세 번째 상태가
 * 필요하고 그 상태를 읽는 곳이 아직 없다. 지금은 요율을 바꾸는 것만 할 수 있다.
 */
@Controller({ version: '1' })
export class CommissionController {
  constructor(private readonly commissions: CommissionService) {}

  /**
   * 요율을 바꾸면 얼마가 달라지나 (F6).
   *
   * `commission-rates` 보다 **위에** 있다. 지금은 부딪힐 라우트가 없지만
   * `commission-rates/:id` 가 생기는 날 이 순서가 이미 맞아 있어야 한다.
   */
  @Get('commission-rates/simulation')
  @RequirePermission('commission.read')
  simulate(@Query() query: unknown): Promise<CommissionSimulationResponse> {
    return this.commissions.simulate(parseInput(commissionSimulationQueryParamsSchema, query))
  }

  /** 지금 유효한 요율들, 또는 한 범위의 변경 이력 (F5). */
  @Get('commission-rates')
  @RequirePermission('commission.read')
  list(@Query() query: unknown): Promise<CommissionRateListResponse> {
    return this.commissions.list(parseInput(commissionRateListQueryParamsSchema, query))
  }

  /** 한 범위의 요율을 바꾼다 (F1 · F2 · F5). */
  @Put('commission-rates')
  @RequirePermission('commission.write')
  async set(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<CommissionRateResponse> {
    const request = parseInput(setCommissionRateRequestSchema, body)

    return { rate: await this.commissions.set(principal.userId, request) }
  }
}
