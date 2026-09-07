'use client'

import { Button, Input } from '@shopping/ui/components'
import { useId } from 'react'

import type { DemoPeriodProblem, DemoStatsPeriod } from '@/lib/demo/demo-console'
import { DEMO_STATS_MAX_DAYS, defaultDemoStatsPeriod } from '@/lib/demo/demo-console'
import type { DemoStatsFilterMessages } from '@/messages'

/**
 * 기간 두 칸과 되돌리기 하나.
 *
 * **거꾸로 고른 기간을 막지 않고 그 자리에서 말한다.** 고치는 방법이 그 입력뿐인데
 * 입력을 잠그면 되돌릴 길이 없고, 대신 오류가 그 칸에 붙어 어디를 고쳐야 하는지
 * 말한다 (`components/dashboard/period-filters.tsx` 와 같은 규약).
 *
 * **서버에 보내지는 않는다** (`use-demo-console.ts`). 서버는 잘못 고른 기간을 접어
 * 200 으로 답하므로(`rangeOf`), 그대로 보내면 화면의 날짜 두 칸과 답이 서로 다른
 * 기간을 가리킨다.
 */

export interface DemoPeriodFiltersProps {
  readonly value: DemoStatsPeriod
  readonly onChange: (period: DemoStatsPeriod) => void
  readonly problem: DemoPeriodProblem | null
  readonly messages: DemoStatsFilterMessages
  readonly disabled?: boolean
  /** 「최근 2주로」가 되돌아가는 기준 시각. 검사가 고정된 날짜를 넣는다. */
  readonly now?: Date
}

export function DemoPeriodFilters({
  value,
  onChange,
  problem,
  messages,
  disabled = false,
  now,
}: DemoPeriodFiltersProps) {
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
            onChange(defaultDemoStatsPeriod(now ?? new Date()))
          }}
          type="button"
          variant="ghost"
        >
          {messages.reset}
        </Button>
      </fieldset>

      {problem === null ? null : (
        <p className="text-danger w-full text-sm" id={errorId} role="alert">
          {problem === 'incomplete'
            ? messages.rangeIncomplete
            : problem === 'reversed'
              ? messages.rangeReversed
              : messages.rangeTooLong.replace('{max}', String(DEMO_STATS_MAX_DAYS))}
        </p>
      )}
    </form>
  )
}
