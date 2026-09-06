import { Controller, Post } from '@nestjs/common'
import type { SettlementRunResponse } from '@shopping/shared'

import { RequirePermission } from '../auth/require-permission.decorator.js'
import { SettlementBatchService } from './settlement-batch.service.js'

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
 */
@Controller({ version: '1' })
export class SettlementController {
  constructor(private readonly batch: SettlementBatchService) {}

  @Post('settlements/batch')
  @RequirePermission('settlement.run')
  run(): Promise<SettlementRunResponse> {
    return this.batch.run()
  }
}
