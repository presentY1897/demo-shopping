'use client'

import type {
  ApiFailure,
  DashboardMetricsResponse,
  DashboardProduct,
  DashboardSeller,
  ErrorMessages,
} from '@shopping/shared'
import { DASHBOARD_TOP_LIMIT, failureMessage } from '@shopping/shared'
import { ErrorState, Skeleton, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'

import type { DashboardGrowth } from '@/lib/dashboard/dashboard-console'
import { dayCount, growthOf } from '@/lib/dashboard/dashboard-console'
import { dashboardCount, dashboardDay, dashboardMoney } from '@/lib/dashboard/format'
import type { DashboardMetricsController } from '@/lib/dashboard/use-dashboard'
import type { DashboardComparisonMessages, DashboardMessages } from '@/messages'

import { PeriodFilters } from './period-filters'
import { SalesChart } from './sales-chart'

/**
 * 지표 · 추이 · 순위 (TASK-0092 F1 · F3).
 *
 * ## 증감률을 화면이 계산한다
 *
 * 계약은 두 기간의 숫자만 보낸다. 0에서 0으로 갔을 때의 답이 정해져 있지 않고, 그
 * 판단은 「변화 없음을 어떻게 그릴지」와 같은 문제라 화면의 것이다
 * (`dashboardMetricsResponseSchema`). `growthOf` 가 그 판단을 한 곳에서 하고, 여기서는
 * 결과를 문장으로 옮길 뿐이다 — 0으로 나눈 값을 화면에서 손보기 시작하면 언젠가 한
 * 곳이 「+100%」로 반올림되고, 그것은 두 배로 늘었다는 거짓말이다.
 *
 * ## 이 섹션만 실패할 수 있다
 *
 * 지표는 셋 중 가장 무겁게 집계하는 문이라 가장 먼저 느려지고 가장 먼저 실패한다.
 * 그때 처리 대기와 시스템 상태는 **그대로 그려져 있어야 한다** (4.1).
 */
export interface MetricsPanelProps {
  readonly controller: DashboardMetricsController
  readonly messages: DashboardMessages
  readonly errors: ErrorMessages
  /** 「최근 30일로」의 기준 시각. 검사가 고정된 날짜를 넣는다. */
  readonly now?: Date
}

export function MetricsPanel({ controller, messages, errors, now }: MetricsPanelProps) {
  const copy = messages.metrics
  const { state } = controller

  const describe = (failure: ApiFailure): string =>
    failureMessage(failure, { errors, failures: messages.failures })

  return (
    <section aria-label={copy.title} className="flex flex-col gap-4">
      <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>

      <PeriodFilters
        disabled={state.status === 'loading'}
        messages={copy.filters}
        now={now}
        onChange={controller.setPeriod}
        problem={controller.problem}
        value={controller.period}
      />

      {state.status === 'loading' ? <Skeleton label={copy.loadingLabel} lines={4} /> : null}

      {state.status === 'error' ? (
        <ErrorState
          description={describe(state.failure)}
          onRetry={controller.reload}
          retryLabel={copy.retryLabel}
          title={copy.errorTitle}
        />
      ) : null}

      {state.status === 'ready' ? <MetricsBody messages={messages} metrics={state.data} /> : null}
    </section>
  )
}

function MetricsBody({
  messages,
  metrics,
}: {
  readonly messages: DashboardMessages
  readonly metrics: DashboardMetricsResponse
}) {
  const copy = messages.metrics
  // 「직전 N일 대비」의 N 은 **답이 실어 온 기간**에서 센다. 사람이 고른 기간을 서버가
  // 접었을 수 있고(`rangeOf`), 그때 화면의 입력칸과 답이 가리키는 날 수가 다르다.
  const days = dayCount({ from: metrics.from, to: metrics.to })

  return (
    <div className="flex flex-col gap-6">
      {/*
        **기간은 답에서 읽는다**, 입력칸에서가 아니다. 두 가지 이유가 있고 둘 다 실제로
        일어난다. 하나는 서버가 기간을 접는다는 것이다(`rangeOf`) — 화면의 두 칸이
        90일을 넘겨도 답은 90일이고, 입력칸을 그대로 적으면 이 줄이 아래 숫자와 다른
        기간을 가리킨다. 다른 하나는 사람이 날짜 칸을 **지우는 순간**이다: 그때 입력은
        빈 문자열이고, 그것을 날짜로 포맷하면 `Intl` 이 던져 **화면 전체가 사라진다.**
      */}
      <p className="text-fg-muted text-sm">
        {copy.periodValue
          .replace('{from}', dashboardDay(metrics.from))
          .replace('{to}', dashboardDay(metrics.to))}
      </p>

      <div
        aria-label={copy.regionLabel}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        role="group"
      >
        <Figure
          growth={growthOf(metrics.current.salesAmount, metrics.previous.salesAmount)}
          days={days}
          label={copy.salesLabel}
          messages={copy.comparison}
          value={dashboardMoney(metrics.current.salesAmount)}
        />
        <Figure
          growth={growthOf(metrics.current.orderCount, metrics.previous.orderCount)}
          days={days}
          label={copy.orderCountLabel}
          messages={copy.comparison}
          value={copy.orderCountValue.replace(
            '{count}',
            dashboardCount(metrics.current.orderCount),
          )}
        />
        <Figure
          growth={growthOf(metrics.current.newUsers, metrics.previous.newUsers)}
          days={days}
          label={copy.newUsersLabel}
          messages={copy.comparison}
          value={copy.newUsersValue.replace('{count}', dashboardCount(metrics.current.newUsers))}
        />
        <Figure
          growth={growthOf(metrics.current.activeSellers, metrics.previous.activeSellers)}
          days={days}
          label={copy.activeSellersLabel}
          messages={copy.comparison}
          note={copy.activeSellersNote}
          value={copy.activeSellersValue.replace(
            '{count}',
            dashboardCount(metrics.current.activeSellers),
          )}
        />
      </div>

      <SalesChart days={metrics.days} messages={messages.chart} />

      <Rankings messages={messages} metrics={metrics} />
    </div>
  )
}

/**
 * 큰 숫자 하나, 그 이름, 그리고 직전 기간과의 차이.
 *
 * 이름이 위에 오는 이유는 읽는 순서가 그래서다. 증감은 **문장**이라 색이나 화살표
 * 없이도 뜻이 남는다 (P2 — 색만으로 정보를 전달하지 않는다).
 */
function Figure({
  label,
  value,
  growth,
  days,
  messages,
  note,
}: {
  readonly label: string
  readonly value: string
  readonly growth: DashboardGrowth
  readonly days: number
  readonly messages: DashboardComparisonMessages
  readonly note?: string
}) {
  return (
    <p className="border-border bg-surface-raised flex flex-col gap-1 rounded-md border p-4">
      <span className="text-fg-muted text-sm">{label}</span>
      <span className="text-fg text-2xl font-bold">{value}</span>
      <span className="text-fg-muted text-sm">
        {messages.label.replace('{days}', String(days))} · {describeGrowth(growth, messages)}
      </span>
      {note === undefined ? null : <span className="text-fg-subtle text-2xs">{note}</span>}
    </p>
  )
}

/**
 * 방향에 맞는 한 문장.
 *
 * **부호를 화살표나 색으로만 말하지 않는다.** 붉은 삼각형은 색을 구분하지 못하는
 * 사람에게 아무것도 아니고 흑백 인쇄에서 사라진다 — 문장이 「늘었어요 · 줄었어요」를
 * 들고 있고, 그 앞의 퍼센트는 언제나 절댓값이다.
 */
function describeGrowth(growth: DashboardGrowth, messages: DashboardComparisonMessages): string {
  if (growth.kind === 'none') return messages.none
  if (growth.direction === 'flat') return messages.flat

  const template = growth.direction === 'up' ? messages.up : messages.down

  return template.replace('{percent}', String(Math.abs(growth.percent)))
}

/** 인기 상품과 인기 판매자. 둘 다 다섯 줄까지라 「전체」로 읽히지 않게 적는다. */
function Rankings({
  messages,
  metrics,
}: {
  readonly messages: DashboardMessages
  readonly metrics: DashboardMetricsResponse
}) {
  const copy = messages.rankings

  const products: readonly TableColumn<DashboardProduct>[] = [
    { cell: (row) => row.name, header: copy.nameHeader, key: 'name' },
    { cell: (row) => row.brandName, header: copy.brandHeader, key: 'brand' },
    {
      align: 'end',
      cell: (row) => dashboardMoney(row.salesAmount),
      header: copy.salesHeader,
      key: 'sales',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => dashboardCount(row.orderCount),
      header: copy.orderCountHeader,
      key: 'orderCount',
      numeric: true,
    },
  ]

  const sellers: readonly TableColumn<DashboardSeller>[] = [
    { cell: (row) => row.brandName, header: copy.brandHeader, key: 'brand' },
    {
      align: 'end',
      cell: (row) => dashboardMoney(row.salesAmount),
      header: copy.salesHeader,
      key: 'sales',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => dashboardCount(row.orderCount),
      header: copy.orderCountHeader,
      key: 'orderCount',
      numeric: true,
    },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label={copy.productsTitle} className="flex flex-col gap-3">
        <h3 className="text-fg text-base font-semibold">{copy.productsTitle}</h3>

        {metrics.topProducts.length === 0 ? (
          <p className="text-fg-muted text-sm">{copy.productsEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              caption={copy.productsCaption}
              columns={products}
              rowKey={(row) => row.productId}
              rows={metrics.topProducts}
            />
          </div>
        )}
      </section>

      <section aria-label={copy.sellersTitle} className="flex flex-col gap-3">
        <h3 className="text-fg text-base font-semibold">{copy.sellersTitle}</h3>

        {metrics.topSellers.length === 0 ? (
          <p className="text-fg-muted text-sm">{copy.sellersEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              caption={copy.sellersCaption}
              columns={sellers}
              rowKey={(row) => row.sellerId}
              rows={metrics.topSellers}
            />
          </div>
        )}
      </section>

      {/* 「전체」로 읽히지 않게 한다 — 계약이 다섯 줄까지만 보낸다. */}
      <p className="text-fg-subtle text-xs lg:col-span-2">
        {copy.note.replace('{count}', String(DASHBOARD_TOP_LIMIT))}
      </p>
    </div>
  )
}
