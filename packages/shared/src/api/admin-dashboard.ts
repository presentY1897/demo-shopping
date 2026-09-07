import { z } from 'zod'

import { productIdSchema } from './products.js'
import { sellerIdSchema } from './sellers.js'
import { wonSchema } from '../pricing/types.js'

/**
 * 관리자 대시보드 (TASK-0092).
 *
 * ## 한 화면인데 문이 셋인 이유
 *
 * 세 조각은 **성격이 다르다.** 지표는 기간을 받아 무겁게 집계하고, 처리 대기는
 * 가볍고 자주 바뀌며, 시스템 상태는 데이터베이스가 아니라 프로세스에 묻는다. 하나로
 * 합치면 가장 느린 것이 나머지를 붙잡고, **하나가 실패하면 화면이 통째로 빈다** —
 * 대시보드에서 그것은 「지표를 못 읽었다」가 아니라 「플랫폼이 죽었나」로 읽힌다.
 *
 * 나눠 두면 섹션 하나가 비어도 나머지는 그려진다. 홈이 섹션마다 자기 데이터를 읽는
 * 것과 같은 판단이다 (`pages.md`).
 */

export const DASHBOARD_MAX_DAYS = 90
export const DASHBOARD_TOP_LIMIT = 5

/**
 * 기간. 없으면 최근 30일이고, 최대 {@link DASHBOARD_MAX_DAYS} 일이다.
 *
 * 날짜만 받고 시각은 받지 않는다 — 「어제 얼마 팔았나」에 시·분이 붙으면 같은 질문에
 * 답이 여러 개가 되고, 두 관리자가 다른 숫자를 보게 된다. 하루의 경계는 KST 자정이다.
 */
export const dashboardQueryParamsSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})

export type DashboardQueryParams = z.infer<typeof dashboardQueryParamsSchema>

export const dashboardMetricsSchema = z.object({
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
  newUsers: z.int().min(0),
  /** 기간 안에 한 건이라도 판 스토어. 「등록된 스토어」가 아니다. */
  activeSellers: z.int().min(0),
})

export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>

export const dashboardDaySchema = z.object({
  date: z.iso.date(),
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
})

export type DashboardDay = z.infer<typeof dashboardDaySchema>

export const dashboardProductSchema = z.object({
  productId: productIdSchema,
  name: z.string(),
  brandName: z.string(),
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
})

export type DashboardProduct = z.infer<typeof dashboardProductSchema>

export const dashboardSellerSchema = z.object({
  sellerId: sellerIdSchema,
  brandName: z.string(),
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
})

export type DashboardSeller = z.infer<typeof dashboardSellerSchema>

/**
 * 지표 · 추이 · 순위 (F1 · F3).
 *
 * **`previous` 는 바로 앞의 같은 길이 기간이다.** 「전월 대비」가 아니라 「직전 같은
 * 기간 대비」인 이유는 기간을 사람이 고르기 때문이다 — 7일을 보고 있는 사람에게
 * 지난달과의 비교를 내밀면 그 수는 화면의 어느 것과도 짝이 맞지 않는다.
 *
 * 증감**률**을 서버가 계산하지 않는다. 0에서 0으로 갔을 때의 답이 정해져 있지 않고,
 * 그 판단은 「변화 없음」을 어떻게 그릴지와 같은 문제라 화면의 것이다
 * (`revenue-console.ts` 의 `growthOf` 가 판매자 쪽에서 같은 판단을 이미 했다).
 */
export const dashboardMetricsResponseSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  current: dashboardMetricsSchema,
  previous: dashboardMetricsSchema,
  days: z.array(dashboardDaySchema),
  topProducts: z.array(dashboardProductSchema),
  topSellers: z.array(dashboardSellerSchema),
})

export type DashboardMetricsResponse = z.infer<typeof dashboardMetricsResponseSchema>

/**
 * 지금 사람이 해야 할 일 (F2).
 *
 * **대시보드의 목적이 이것이다.** 예쁜 숫자가 아니라 「지금 뭘 해야 하는가」이고,
 * 그래서 이 답은 기간을 받지 않는다 — 3주 전에 들어온 신청도 아직 안 봤으면 오늘의
 * 할 일이다.
 *
 * 링크는 서버가 싣지 않는다. 어느 화면으로 가는지는 콘솔의 라우트이고, 그것을 API 가
 * 알면 화면을 옮길 때마다 서버를 고쳐야 한다.
 */
export const dashboardPendingResponseSchema = z.object({
  /** 심사를 기다리는 입점 신청. */
  sellerApplications: z.int().min(0),
  /** 관리자 개입을 기다리는 클레임. */
  claims: z.int().min(0),
  /** 아직 판단하지 않은 신고. */
  reports: z.int().min(0),
  /** 승인을 기다리는 정산서. */
  settlements: z.int().min(0),
})

export type DashboardPendingResponse = z.infer<typeof dashboardPendingResponseSchema>

/**
 * 대시보드가 지켜보는 배치들의 열쇠 (TASK-0092 F4).
 *
 * **계약에 있는 이유**: 서버의 목록(`scheduler-registry.ts`)과 화면의 이름표가
 * 따로 놀면, 배치가 하나 늘었을 때 화면은 점 찍힌 열쇠를 날것으로 그리고 **아무
 * 검사도 빨개지지 않는다.** 여기 한 벌만 두면 이름표가 `Record<SchedulerKey, string>`
 * 이 되어, 새 배치는 typecheck 에서 걸린다.
 *
 * 서버가 이 목록을 **다 덮는지**는 `scheduler-registry-parity.spec.ts` 가 소스를
 * 읽어 확인한다. 그래서 양쪽이 이 한 줄에 묶인다.
 */
export const schedulerKeys = [
  'reservation.sweep.lastRunAt',
  'order.confirm.lastRunAt',
  'shipping.delivery.lastRunAt',
  'payment.reconcile.lastRunAt',
  'payment.straggler.lastRunAt',
  'settlement.batch.lastRunAt',
  'claims.refund.lastRunAt',
  'point.expiry.lastRunAt',
  'coupon.expiry.lastRunAt',
  'demo.cleanup.lastRunAt',
] as const

export type SchedulerKey = (typeof schedulerKeys)[number]

export const schedulerStatuses = ['ok', 'stale', 'never'] as const

export type SchedulerStatus = (typeof schedulerStatuses)[number]

export const schedulerStatusSchema = z.enum(schedulerStatuses)

/**
 * 배치 하나의 상태.
 *
 * `never` 와 `stale` 을 가른다. 한 번도 안 돈 것은 **갓 뜬 프로세스의 정상 상태**이고,
 * 돌다가 멈춘 것은 사고다 — 둘을 같은 색으로 칠하면 배포 직후마다 빨간 화면을 보게
 * 되고, 그것이 몇 번 반복되면 사람은 그 색을 안 믿는다.
 */
export const schedulerHealthSchema = z.object({
  /**
   * **`z.enum` 이 아니다.** 이름표는 {@link schedulerKeys} 로 전수를 강제하지만,
   * 응답은 열어 둔다 — 서버와 콘솔은 따로 배포되므로 서버가 먼저 배치를 하나 늘리는
   * 순간이 있고, 그때 `enum` 이면 **시스템 상태 패널이 통째로 파싱에 실패한다.**
   * 배치 하나의 이름을 못 붙이는 것과 화면 전체가 비는 것은 다른 크기의 사고다.
   */
  key: z.string().min(1),
  status: schedulerStatusSchema,
  lastRunAt: z.iso.datetime().nullable(),
})

export type SchedulerHealth = z.infer<typeof schedulerHealthSchema>

/**
 * 시스템 상태 (F4).
 *
 * **공개 `GET /health` 로는 이것을 할 수 없다.** 저쪽은 로드밸런서가 부르는 문이라
 * 의존성 몇 개만 말하고, 배치 하나하나의 마지막 실행 시각까지 공개하면 그것은 운영
 * 내부를 밖에 내놓는 일이다. 그래서 같은 사실을 관리자에게만 자세히 답한다.
 */
export const dashboardSystemResponseSchema = z.object({
  schedulers: z.array(schedulerHealthSchema),
  /**
   * 색인 큐 (TASK-0092 2장 「인덱싱 큐」).
   *
   * **배치 목록에 없다.** 저 열 개는 주기적으로 도는 일이고 이것은 **줄 서 있는 일**
   * 이라, 「마지막으로 언제 돌았나」로는 상태를 말할 수 없다 — 방금 돌았어도 큐가
   * 만 건이면 색인은 뒤처져 있다.
   *
   * `pending` 이 안 줄면 멈춘 것이고 줄고 있으면 바쁜 것이다. 그 판정을 서버가 하지
   * 않는 이유는 한 번의 응답으로는 **줄고 있는지 알 수 없기** 때문이다 — 두 번을 본
   * 사람만 아는 사실이라 화면에 맡긴다. `oldestAt` 이 그 대신 쓰인다: 가장 오래
   * 기다린 줄이 언제 들어왔는지는 한 번만 봐도 뜻이 있다.
   */
  searchIndex: z.object({
    pending: z.int().min(0),
    oldestAt: z.iso.datetime().nullable(),
  }),
  /** 데모 계정 현황 요약 — 자세한 것은 TASK-0096 의 화면이 답한다. */
  demo: z.object({
    activeAccounts: z.int().min(0),
    expiringWithinHour: z.int().min(0),
  }),
})

export type DashboardSystemResponse = z.infer<typeof dashboardSystemResponseSchema>
