'use client'

import type { ApiFailure, RevenueProduct, SellerRevenueResponse } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { DataList, EmptyState, ErrorState, Link, Skeleton, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useCallback } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { count, money } from '@/lib/orders/format'
import { growthOf } from '@/lib/revenue/revenue-console'
import { useSellerRevenue } from '@/lib/revenue/use-seller-revenue'
import type { Messages, RevenueComparisonMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { RevenueChart } from './revenue-chart'
import { RevenueFilters } from './revenue-filters'

/**
 * `/` — 「내가 얼마 벌었나」 (TASK-0082).
 *
 * `pages.md` 2장이 매출 추이를 이 경로에 배정해 두었고, 사이드바의 「대시보드」가
 * 가리키는 곳도 여기다.
 *
 * **서버 렌더에서 아무것도 기다리지 않는다.** 제목과 기간 칸은 이 경계 바깥에서
 * 만들어져 나가고, 그것이 이 화면에 네 상태가 있는 이유다 (P5 · U1).
 *
 * **스토어가 없으면 부르지 않는다.** 쿠폰 목록과 같은 규약이다 — 판단이 화면의 것이라
 * 훅은 세션을 읽지 않는다.
 */
export interface RevenueDashboardProps {
  readonly messages?: Messages
  /** 기본 기간을 정하는 기준 시각. 검사가 고정된 날짜를 넣는다. */
  readonly now?: Date
}

/** 입점 신청. 스토어가 없는 계정이 여기서 할 수 있는 유일한 다음 걸음이다. */
const APPLY_HREF = '/apply'

export function RevenueDashboard({ messages = messagesFor(), now }: RevenueDashboardProps) {
  const { state } = useAuth()
  const copy = messages.revenue
  const sellerId = state.status === 'signedIn' ? state.user.sellerId : null

  return (
    <section aria-label={copy.description} className="flex flex-col gap-6">
      {/*
        세션을 아직 모른다. 「스토어가 없다」와 **같은 화면을 보여 주면 안 되는** 상태다 —
        묻지도 않고 입점 신청을 권하는 셈이 된다.
      */}
      {state.status === 'checking' ? <Skeleton label={copy.loadingLabel} shape="text" /> : null}

      {state.status !== 'checking' && sellerId === null ? (
        <EmptyState
          action={<Link href={APPLY_HREF}>{copy.noStore.applyLabel}</Link>}
          description={copy.noStore.body}
          title={copy.noStore.title}
        />
      ) : null}

      {sellerId === null ? null : <RevenueConsole messages={messages} now={now} />}
    </section>
  )
}

/**
 * 매출을 실제로 읽는 자리.
 *
 * `sellerId` 를 **쓰지 않는데도** 스토어가 있는 것이 확실해진 뒤에 마운트된다.
 * 서버가 부르는 사람의 스토어에서 그것을 정하므로 질의에는 실리지 않지만, 스토어가
 * 없는 계정이 부르면 서버는 답할 스토어가 없다.
 */
function RevenueConsole({ messages, now }: { readonly messages: Messages; readonly now?: Date }) {
  const copy = messages.revenue
  const revenue = useSellerRevenue(now)
  const { state } = revenue

  const describe = useCallback(
    (failure: ApiFailure) =>
      failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures }),
    [messages],
  )

  return (
    <>
      <RevenueFilters
        disabled={state.status === 'loading'}
        messages={copy.filters}
        now={now}
        onChange={revenue.setPeriod}
        problem={revenue.problem}
        value={revenue.period}
      />

      <DataList
        /*
          닿지 않는 갈래인데도 값을 채운다 — `DataList` 가 빈 상태를 **필수 prop 으로**
          강제하기 때문이고, `claim-detail-workspace.tsx` 도 같은 이유로 같은 자리를
          채운다. 계약이 기간 안의 모든 날을 0으로라도 보내므로 이 화면은 「비어 있는」
          답을 받지 않는다.
        */
        empty={<EmptyState description={copy.empty.description} title={copy.empty.title} />}
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={revenue.reload}
            retryLabel={copy.retry}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={state.status}
      >
        {state.status === 'ready' ? <RevenueBody copy={copy} revenue={state.revenue} /> : null}
      </DataList>
    </>
  )
}

/** 답이 도착한 뒤의 화면 — 합계 · 비교 · 추이 · 인기 상품. */
function RevenueBody({
  copy,
  revenue,
}: {
  readonly copy: Messages['revenue']
  readonly revenue: SellerRevenueResponse
}) {
  const products: readonly TableColumn<RevenueProduct>[] = [
    {
      cell: (row) => row.productName,
      header: copy.topProducts.nameHeader,
      key: 'name',
    },
    {
      align: 'end',
      cell: (row) => copy.topProducts.quantityValue.replace('{count}', count(row.quantity)),
      header: copy.topProducts.quantityHeader,
      key: 'quantity',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => money(row.salesAmount),
      header: copy.topProducts.salesHeader,
      key: 'sales',
      numeric: true,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/*
        큰 숫자 셋. 평균 주문금액을 화면이 나누지 않는 것에 주의 — 계약이 계산해서
        보내고(`revenueTotalsSchema`), 주문이 0건인 기간에서 0으로 나누는 자리를
        읽는 쪽마다 만들지 않기 위해서다.
      */}
      <section
        aria-label={copy.totals.regionLabel}
        className="border-border grid gap-4 rounded-md border p-4 sm:grid-cols-3"
      >
        <Figure label={copy.totals.salesLabel} value={money(revenue.totals.salesAmount)} />
        <Figure
          label={copy.totals.orderCountLabel}
          value={copy.totals.orderCountValue.replace('{count}', count(revenue.totals.orderCount))}
        />
        <Figure label={copy.totals.averageLabel} value={money(revenue.totals.averageOrderAmount)} />
      </section>

      <Comparison
        current={revenue.totals.salesAmount}
        messages={copy.comparison}
        previous={revenue.previous.salesAmount}
      />

      <RevenueChart days={revenue.days} messages={copy.chart} />

      <section aria-label={copy.topProducts.title} className="flex flex-col gap-3">
        <h2 className="text-fg text-lg font-semibold">{copy.topProducts.title}</h2>

        {revenue.topProducts.length === 0 ? (
          <p className="text-fg-muted text-sm">{copy.topProducts.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table
              caption={copy.topProducts.caption}
              columns={products}
              rowKey={(row) => row.productId}
              rows={revenue.topProducts}
            />
          </div>
        )}

        {/* 「전체」로 읽히지 않게 한다 — 계약이 다섯 줄까지만 보낸다. */}
        <p className="text-fg-subtle text-xs">{copy.topProducts.note}</p>
      </section>
    </div>
  )
}

/** 큰 숫자 하나와 그 이름. 이름이 위에 오는 이유는 읽는 순서가 그래서다. */
function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <p className="flex flex-col gap-1">
      <span className="text-fg-muted text-sm">{label}</span>
      <span className="text-fg text-2xl font-bold">{value}</span>
    </p>
  )
}

/**
 * 전 기간 대비 (F6).
 *
 * **지난 기간 매출이 0원이면 퍼센트를 그리지 않는다.** `growthOf` 가 그 판단을 하고
 * 여기서는 그 결과를 문장으로 옮길 뿐이다 — 0으로 나눈 값을 화면에서 손보기
 * 시작하면 언젠가 한 곳이 「+100%」로 반올림되고, 그것은 두 배로 늘었다는 거짓말이다.
 */
function Comparison({
  current,
  previous,
  messages,
}: {
  readonly current: number
  readonly previous: number
  readonly messages: RevenueComparisonMessages
}) {
  const growth = growthOf(current, previous)

  return (
    <section
      aria-label={messages.title}
      className="border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border p-3"
    >
      <h2 className="text-fg-muted text-sm">{messages.title}</h2>

      <p className="text-fg text-lg font-semibold">
        {growth.kind === 'none'
          ? messages.none
          : describeGrowth(growth.direction, growth.percent, messages)}
      </p>

      <p className="text-fg-muted text-sm">
        {messages.previous.replace('{amount}', money(previous))}
      </p>

      <p className="text-fg-subtle w-full text-xs">{messages.note}</p>
    </section>
  )
}

/**
 * 방향에 맞는 한 문장.
 *
 * **부호를 화살표나 색으로만 말하지 않는다.** 붉은 삼각형은 색을 구분하지 못하는
 * 사람에게 아무것도 아니고 흑백 인쇄에서 사라진다 — 문장이 「늘었어요 · 줄었어요」를
 * 들고 있고, 그 앞의 퍼센트는 언제나 절댓값이다.
 */
function describeGrowth(
  direction: 'up' | 'down' | 'flat',
  percent: number,
  messages: RevenueComparisonMessages,
): string {
  if (direction === 'flat') return messages.flat

  const template = direction === 'up' ? messages.up : messages.down

  return template.replace('{percent}', String(Math.abs(percent)))
}
