import { Controller, Get, Query } from '@nestjs/common'
import type {
  DashboardMetricsResponse,
  DashboardPendingResponse,
  DashboardSystemResponse,
} from '@shopping/shared'
import { dashboardQueryParamsSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { DashboardService } from './dashboard.service.js'

/**
 * 관리자 대시보드 (TASK-0092).
 *
 * ## 왜 `order.read:any` 인가
 *
 * 이 화면의 머리는 거래액과 주문 수이고, 그것은 주문을 **플랫폼 전체로** 읽는 일이다.
 * 구매자와 판매자는 `order.read:own` 만 갖고 있어 여기서 403 을 받는다 (F6) —
 * 스코프가 좁혀진 것은 통과하지 못하므로, 「자기 주문은 읽을 수 있다」가 「전체를 볼
 * 수 있다」로 새지 않는다.
 *
 * **새 퍼미션을 만들지 않았다.** 만들면 `permission-matrix.md` 의 역할 다섯에 줄이
 * 하나씩 늘고, 그것은 이 화면 하나를 위해 권한 모델을 넓히는 일이다. 데모 관리자도
 * 이 문을 지난다 — 대시보드는 **읽기**뿐이고, 데모 계정이 못 하는 것은 쓰기다 (D-058).
 */
@Controller({ path: 'admin/dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** 지표 · 추이 · 순위 (F1 · F3). */
  @Get('metrics')
  @RequirePermission('order.read')
  metrics(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<DashboardMetricsResponse> {
    return this.dashboard.metrics(principal, parseInput(dashboardQueryParamsSchema, query))
  }

  /**
   * 지금 해야 할 일 (F2).
   *
   * 기간을 받지 않는다 — 3주 전에 들어온 신청도 아직 안 봤으면 오늘의 할 일이다.
   */
  @Get('pending')
  @RequirePermission('order.read')
  pending(@Principal() principal: RequestPrincipal): Promise<DashboardPendingResponse> {
    return this.dashboard.pending(principal)
  }

  /** 배치들이 돌고 있는가 (F4). */
  @Get('system')
  @RequirePermission('order.read')
  system(@Principal() principal: RequestPrincipal): Promise<DashboardSystemResponse> {
    return this.dashboard.system(principal)
  }
}
