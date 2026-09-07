'use client'

import type { DashboardDay } from '@shopping/shared'
import { Button, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useId, useState } from 'react'

import { salesChartGeometry } from '@/lib/dashboard/chart'
import { dashboardCount, dashboardDay, dashboardMoney } from '@/lib/dashboard/format'
import type { DashboardChartMessages } from '@/messages'

/**
 * 거래액 추이 — **그림 하나와 표 하나** (TASK-0092 F1).
 *
 * ## 그림은 장식이고 표가 내용이다
 *
 * `<svg>` 에 `aria-hidden` 이 붙어 있고, 같은 숫자가 **진짜 `<table>`** 로 DOM 안에
 * 있다. 흔한 반대 선택 — `<svg role="img" aria-label="거래액 추이 차트">` — 은 접근성
 * 검사를 통과하지만 30일치 숫자를 한 마디로 요약해 버린다. 스크린리더로 읽는 운영자에게
 * 「거래액 추이 차트」는 **아무 데이터도 아니다.**
 *
 * 표는 접혀 있을 수 있지만 **DOM 에서 사라지지는 않는다.** 접기는 `sr-only` 로 하고
 * `hidden` 이나 조건부 렌더로 하지 않는다 — 그 둘은 접근성 트리에서도 지워 버리므로,
 * 「접힌 기본 상태」가 곧 「대체 텍스트가 없는 상태」가 된다. 버튼이 바꾸는 것은 **눈에
 * 보이는지**뿐이고, 읽어 주는 쪽에는 언제나 표가 있다.
 *
 * `apps/seller` 의 매출 추이가 같은 구조를 먼저 세웠다. 좌표를 왜 라이브러리 없이
 * 구하는지는 `lib/dashboard/chart.ts` 의 머리말에 있다.
 */
export interface SalesChartProps {
  readonly days: readonly DashboardDay[]
  readonly messages: DashboardChartMessages
}

export function SalesChart({ days, messages }: SalesChartProps) {
  const [open, setOpen] = useState(false)
  const tableId = useId()
  const geometry = salesChartGeometry(days)

  const columns: readonly TableColumn<DashboardDay>[] = [
    { cell: (row) => dashboardDay(row.date), header: messages.dateHeader, key: 'date' },
    {
      align: 'end',
      cell: (row) => dashboardMoney(row.salesAmount),
      header: messages.salesHeader,
      key: 'sales',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => dashboardCount(row.orderCount),
      header: messages.orderCountHeader,
      key: 'orderCount',
      numeric: true,
    },
  ]

  return (
    <section aria-label={messages.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-fg text-base font-semibold">{messages.title}</h3>
        <p className="text-fg-muted text-sm">
          {messages.peak.replace('{amount}', dashboardMoney(geometry.peak))}
        </p>
      </div>

      {days.length === 0 ? (
        <p className="text-fg-muted text-sm">{messages.empty}</p>
      ) : (
        <>
          {/*
            **장식이다.** 값을 읽는 일은 아래 표가 맡는다.

            `preserveAspectRatio="none"` 으로 가로를 늘리고, 선에는
            `vector-effect="non-scaling-stroke"` 를 걸어 늘어난 만큼 굵어지지 않게
            한다. 그것이 없으면 넓은 화면에서 선이 띠가 된다.
          */}
          <svg
            aria-hidden="true"
            className="text-primary border-border bg-surface h-40 w-full rounded-md border"
            preserveAspectRatio="none"
            viewBox={geometry.viewBox}
          >
            <path className="fill-current opacity-15" d={geometry.area} />
            <polyline
              className="stroke-current"
              fill="none"
              points={geometry.line}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              aria-controls={tableId}
              aria-expanded={open}
              onClick={() => {
                setOpen((shown) => !shown)
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {open ? messages.hideTable : messages.showTable}
            </Button>
            <p className="text-fg-subtle text-sm">{messages.caption}</p>
          </div>

          {/* 접혀도 여기 있다 — 위 머리말이 왜인지를 적고 있다. */}
          <div className={open ? 'overflow-x-auto' : 'sr-only'} id={tableId}>
            <Table
              caption={messages.tableCaption}
              columns={columns}
              rowKey={(row) => row.date}
              rows={days}
            />
          </div>
        </>
      )}
    </section>
  )
}
