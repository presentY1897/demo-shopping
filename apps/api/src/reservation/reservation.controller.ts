import { Controller, Get, Post } from '@nestjs/common'

import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { ReservationDiscrepancy } from './reservation.service.js'
import type { SweepResult } from './reservation-sweeper.service.js'
import { ReservationSweeperService } from './reservation-sweeper.service.js'

/**
 * 만료 정리의 수동 실행과 정합성 점검 (TASK-0051).
 *
 * **손으로 돌릴 수 있어야 하는 이유는 R1 이다** — 스케줄러가 멈추면 재고가 잠기고,
 * 그때 사람이 즉시 복구할 방법이 있어야 한다. 헬스체크가 degraded 를 보여 주는데
 * 고칠 방법이 배포뿐이면 그 신호는 절반만 쓸모 있다.
 *
 * `reservation.sweep` 은 자기 퍼미션이다. `order.write` 를 재사용하지 않은 이유는
 * 스코프다 — 구매자와 판매자가 그것을 `own` 으로 갖고 있는데 이 잡은 소유자가 없다.
 */
@Controller({ path: 'reservations', version: '1' })
export class ReservationController {
  constructor(private readonly sweeper: ReservationSweeperService) {}

  /** 지금 한 번 돈다. 다른 인스턴스가 돌고 있으면 `skipped` 로 답한다. */
  @Post('sweep')
  @RequirePermission('reservation.sweep')
  sweep(): Promise<SweepResult> {
    return this.sweeper.sweep()
  }

  /**
   * `reserved` 캐시가 예약 표와 어긋난 조합 (F7).
   *
   * **자동 보정하지 않는다** (R2). 원인을 모르는 채 값을 고치면 문제가 숨는다 —
   * 검출과 기록까지가 이 라우트의 일이다.
   */
  @Get('reconciliation')
  @RequirePermission('reservation.sweep')
  reconcile(): Promise<readonly ReservationDiscrepancy[]> {
    return this.sweeper.reconcile()
  }
}
