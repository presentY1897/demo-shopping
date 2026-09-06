'use client'

import { Button, Input } from '@shopping/ui/components'
import { useId } from 'react'

import type { PeriodProblem, RevenuePeriod } from '@/lib/revenue/revenue-console'
import { defaultRevenuePeriod } from '@/lib/revenue/revenue-console'
import type { RevenueFilterMessages } from '@/messages'

/**
 * 기간 두 칸과 되돌리기 하나.
 *
 * `order-filters.tsx` 와 같은 규약이다: **거꾸로 고른 기간을 막지 않고 그 자리에서
 * 말한다.** 고치는 방법이 그 입력뿐인데 입력을 잠그면 되돌릴 길이 없고, 대신 오류가
 * 그 칸에 붙어 어디를 고쳐야 하는지 말한다.
 *
 * 다른 것이 하나 있다: 주문 목록은 잘못된 기간도 서버에 보내지만 여기서는 **보내지
 * 않는다.** 주문 목록의 답은 「0건」이고 그것은 사실이지만, 매출의 답은 그래프 한
 * 장이라 「매출이 0원인 기간」과 구별되지 않는다.
 */
export interface RevenueFiltersProps {
  readonly value: RevenuePeriod
  readonly onChange: (period: RevenuePeriod) => void
  readonly problem: PeriodProblem | null
  readonly messages: RevenueFilterMessages
  readonly disabled?: boolean
  /** 「최근 30일로」가 되돌아가는 기준 시각. 검사가 고정된 날짜를 넣는다. */
  readonly now?: Date
}

export function RevenueFilters({
  value,
  onChange,
  problem,
  messages,
  disabled = false,
  now,
}: RevenueFiltersProps) {
  const fromId = useId()
  const toId = useId()
  const errorId = useId()

  const invalid = problem !== null

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{messages.legend}</legend>

        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={fromId}>
            {messages.fromLabel}
          </label>
          <Input
            disabled={disabled}
            id={fromId}
            invalid={invalid}
            onChange={(event) => {
              onChange({ ...value, from: event.target.value })
            }}
            type="date"
            value={value.from}
            {...(invalid ? { 'aria-describedby': errorId } : {})}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={toId}>
            {messages.toLabel}
          </label>
          <Input
            disabled={disabled}
            id={toId}
            invalid={invalid}
            onChange={(event) => {
              onChange({ ...value, to: event.target.value })
            }}
            type="date"
            value={value.to}
            {...(invalid ? { 'aria-describedby': errorId } : {})}
          />
        </div>

        <Button
          onClick={() => {
            onChange(defaultRevenuePeriod(now ?? new Date()))
          }}
          type="button"
          variant="ghost"
        >
          {messages.reset}
        </Button>
      </fieldset>

      {problem === null ? null : (
        <p className="text-danger w-full text-sm" id={errorId} role="alert">
          {problem === 'reversed' ? messages.rangeReversed : messages.rangeTooLong}
        </p>
      )}
    </form>
  )
}
