'use client'

import { Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { OrderFilter } from '@/lib/orders/order-filters'
import {
  orderPeriods,
  orderStatusFilters,
  type OrderPeriod,
  type OrderStatusFilter,
} from '@/lib/orders/order-filters'
import type { OrderHistoryMessages } from '@/messages'

/**
 * 기간과 상태, 셀렉트 둘 (TASK-0063).
 *
 * **`fieldset` 이다.** 둘이 함께 하나의 질문 — 「어떤 주문을 찾나」 — 을 이루고, 그
 * 사실을 마크업으로 말하는 것이 `fieldset`/`legend` 다. 스크린 리더는 각 셀렉트를
 * 읽을 때 그 legend 를 함께 들려준다.
 *
 * **폼이 아니라 즉시 적용이다.** 고르는 것이 둘뿐이고 둘 다 한 번에 하나를 고르는
 * 셀렉트라, 「적용」을 누르기 전에 화면이 이미 무엇이 될지 정해져 있다 — 그 버튼이
 * 하는 일은 왕복을 한 번 미루는 것뿐이다. 서버가 조건을 받게 된 뒤에도 그대로인데,
 * 셀렉트 하나가 요청 하나이고 그 요청은 취소 가능하기 때문이다
 * (`use-order-history.ts` 가 지난 요청을 `AbortController` 로 끊는다).
 *
 * **네이티브 `<select>` 가 아니라 `Select` 인 이유**는 이 앱의 다른 셀렉트들과 같은
 * 것을 쓰기 위해서다 — 검색 정렬이 이미 그것이고, 키보드 조작과 밀도가 한 벌로
 * 관리된다.
 */
export function OrderFilterBar({
  filter,
  onChange,
  messages,
}: {
  readonly filter: OrderFilter
  readonly onChange: (next: OrderFilter) => void
  readonly messages: OrderHistoryMessages
}) {
  const periodId = useId()
  const statusId = useId()

  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="text-fg mb-2 text-sm font-semibold">{messages.filterLegend}</legend>

      <div className="flex flex-col gap-1">
        <label className="text-fg-muted text-xs" htmlFor={periodId}>
          {messages.periodLabel}
        </label>
        <Select
          id={periodId}
          onValueChange={(value) => {
            onChange({ ...filter, period: value as OrderPeriod })
          }}
          options={orderPeriods.map((period) => ({
            value: period,
            label: messages.periods[period],
          }))}
          size="sm"
          value={filter.period}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-fg-muted text-xs" htmlFor={statusId}>
          {messages.statusLabel}
        </label>
        <Select
          id={statusId}
          onValueChange={(value) => {
            onChange({ ...filter, status: value as OrderStatusFilter })
          }}
          options={orderStatusFilters.map((status) => ({
            value: status,
            label: messages.statusFilters[status],
          }))}
          size="sm"
          value={filter.status}
        />
      </div>
    </fieldset>
  )
}
