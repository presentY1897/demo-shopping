'use client'

import type { SettlementStatus } from '@shopping/shared'
import { settlementStatuses } from '@shopping/shared'
import { Button, Input, Select } from '@shopping/ui/components'
import { useId } from 'react'

import { settlementPeriod } from '@/lib/settlements/format'
import type { SettlementFilters as Filters } from '@/lib/settlements/settlement-console'
import {
  EMPTY_SETTLEMENT_FILTERS,
  periodEndOf,
  periodStartOf,
} from '@/lib/settlements/settlement-console'
import type { SettlementListMessages, SettlementMessages } from '@/messages'

/**
 * 회차 · 상태의 두 축.
 *
 * **판매자는 여기 없다.** 계약이 아는 것은 `sellerId` 이고 이 콘솔에는 스토어를
 * 빠짐없이 답하는 엔드포인트가 없다 — 첫 페이지만 담은 셀렉트는 거기 없는 가게를
 * 조용히 못 고르게 만든다(`lib/commissions/use-sellers.ts` 가 그 사정을 적어
 * 두었다). 그래서 판매자는 **목록의 행에서** 고르고, 고른 것은 위의 칩으로 보인다
 * (`claim-filters.tsx` 와 같은 규약).
 *
 * ## 회차가 날짜 하나인 이유
 *
 * 계약의 `periodStart` 는 구간이 아니라 **한 순간**이고 회차는 언제나 월요일
 * 자정에 시작한다. 사람에게 「월요일만 고르세요」라고 요구하는 대신 아무 날이나
 * 받아 **그 날이 속한 회차로 접는다**(`periodStartOf`). 접힌 결과를 밑줄에 적는
 * 이유는, 적지 않으면 수요일을 고른 사람이 자기가 무엇을 보고 있는지 모르기
 * 때문이다.
 *
 * **네 상태를 손으로 적지 않는다.** 상태가 하나 늘면 이 목록은 저절로 자라고,
 * 문장이 없으면 `Record<SettlementStatus, string>` 이 컴파일로 잡는다.
 */

export interface SettlementFiltersProps {
  readonly value: Filters
  readonly onChange: (filters: Filters) => void
  readonly messages: SettlementListMessages
  readonly statusLabels: SettlementMessages['statusLabels']
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL'

export function SettlementFilters({
  value,
  onChange,
  messages,
  statusLabels,
  disabled = false,
}: SettlementFiltersProps) {
  const dayId = useId()
  const statusId = useId()

  const { filters } = messages
  const periodStart = value.day === null ? null : periodStartOf(value.day)

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{filters.legend}</legend>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={dayId}>
            {filters.dayLabel}
          </label>
          <Input
            disabled={disabled}
            id={dayId}
            onChange={(event) => {
              onChange({ ...value, day: event.target.value === '' ? null : event.target.value })
            }}
            type="date"
            value={value.day ?? ''}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={statusId}>
            {filters.statusLabel}
          </label>
          <Select
            disabled={disabled}
            id={statusId}
            onValueChange={(next) => {
              onChange({ ...value, status: next === ALL ? null : (next as SettlementStatus) })
            }}
            options={[
              { value: ALL, label: filters.statusAll },
              ...settlementStatuses.map((status) => ({
                value: status,
                label: statusLabels[status],
              })),
            ]}
            value={value.status ?? ALL}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_SETTLEMENT_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>

      {/*
        고른 날이 어느 회차로 접혔는지. 이 줄이 없으면 수요일을 고른 사람은 자기가
        그 주 전체를 보고 있다는 사실을 알 수 없다.
      */}
      <p className="text-fg-subtle basis-full text-xs">
        {periodStart === null
          ? filters.dayHint
          : filters.resolved.replace(
              '{period}',
              settlementPeriod(periodStart, periodEndOf(periodStart), messages.period),
            )}
      </p>
    </form>
  )
}
