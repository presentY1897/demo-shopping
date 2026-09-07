/**
 * 대시보드 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가 실제로
 * 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로 통과한다
 * (게이트 C2).
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/admin/dashboard/*` 세 라우트는 그
 * 패키지에 아직 등록되어 있지 않고(`mockPaths` 에 항목이 없다), 이 TASK 는
 * `apps/admin` 밖을 고치지 않는다. 그래서 이 화면의 검사는
 * `lib/dashboard/console-api` 를 대신 세운다 — 경로와 스키마가 그 한 파일에 모여
 * 있는 것이 그것을 가능하게 한다 (`support/reports.ts` 와 같은 사정).
 */

import type {
  DashboardDay,
  DashboardMetrics,
  DashboardMetricsResponse,
  DashboardPendingResponse,
  DashboardSystemResponse,
  SchedulerHealth,
} from '@shopping/shared'
import {
  dashboardMetricsResponseSchema,
  dashboardPendingResponseSchema,
  dashboardSystemResponseSchema,
  schedulerHealthSchema,
} from '@shopping/shared'

/** 검사가 고정해 두는 「지금」. 자정을 넘기며 도는 검사는 재현되지 않는다. */
export const DASHBOARD_NOW = new Date('2026-09-06T03:00:00.000Z')

/** `DASHBOARD_NOW` 기준 최근 30일. 화면이 처음 여는 기간과 같다. */
export const DEFAULT_FROM = '2026-08-08'

export const DEFAULT_TO = '2026-09-06'

const PRODUCT_ID = '019596e0-1000-7000-8000-000000000001'

const SELLER_ID = '019596e0-2000-7000-8000-000000000001'

/** 사흘치. 30일을 다 적을 이유가 없고, 세 칸으로도 선과 표는 같은 것을 말한다. */
export const METRIC_DAYS: readonly DashboardDay[] = [
  { date: '2026-09-04', orderCount: 2, salesAmount: 120_000 },
  { date: '2026-09-05', orderCount: 5, salesAmount: 480_000 },
  { date: '2026-09-06', orderCount: 3, salesAmount: 300_000 },
]

const CURRENT: DashboardMetrics = {
  activeSellers: 4,
  newUsers: 12,
  orderCount: 10,
  salesAmount: 900_000,
}

/**
 * 직전 같은 길이 기간. 넷이 **서로 다른 증감**을 내도록 골랐다 — 두 지표가 같은
 * 퍼센트를 내면 화면의 문장이 겹쳐, 검사가 어느 칸을 보고 있는지 알 수 없게 된다.
 * 거래액 +50% · 주문 +25% · 가입 +100% · 활성 판매자 변화 없음.
 */
const PREVIOUS: DashboardMetrics = {
  activeSellers: 4,
  newUsers: 6,
  orderCount: 8,
  salesAmount: 600_000,
}

export function dashboardMetrics(
  overrides: Partial<DashboardMetricsResponse> = {},
): DashboardMetricsResponse {
  return dashboardMetricsResponseSchema.parse({
    current: CURRENT,
    days: METRIC_DAYS,
    from: DEFAULT_FROM,
    previous: PREVIOUS,
    to: DEFAULT_TO,
    topProducts: [
      {
        brandName: '루미에르',
        name: '오버사이즈 울 코트',
        orderCount: 3,
        productId: PRODUCT_ID,
        salesAmount: 540_000,
      },
    ],
    topSellers: [
      { brandName: '루미에르', orderCount: 6, salesAmount: 720_000, sellerId: SELLER_ID },
    ],
    ...overrides,
  })
}

export function dashboardPending(
  overrides: Partial<DashboardPendingResponse> = {},
): DashboardPendingResponse {
  return dashboardPendingResponseSchema.parse({
    claims: 2,
    reports: 7,
    sellerApplications: 3,
    settlements: 0,
    ...overrides,
  })
}

/** 배치 한 줄. 기본값은 방금 돈 재고 예약 정리다. */
export function scheduler(overrides: Partial<SchedulerHealth> = {}): SchedulerHealth {
  return schedulerHealthSchema.parse({
    key: 'reservation.sweep.lastRunAt',
    lastRunAt: '2026-09-06T02:59:00.000Z',
    status: 'ok',
    ...overrides,
  })
}

export function dashboardSystem(
  overrides: Partial<DashboardSystemResponse> = {},
): DashboardSystemResponse {
  return dashboardSystemResponseSchema.parse({
    demo: { activeAccounts: 5, expiringWithinHour: 1 },
    // 색인 큐는 배치가 아니라 **줄 서 있는 일**이라 따로 온다.
    searchIndex: { oldestAt: null, pending: 0 },
    schedulers: [
      scheduler(),
      scheduler({ key: 'order.confirm.lastRunAt' }),
      scheduler({ key: 'settlement.batch.lastRunAt' }),
    ],
    ...overrides,
  })
}
