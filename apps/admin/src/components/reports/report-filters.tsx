'use client'

import type { ReportTargetType } from '@shopping/shared'
import { reportTargetTypes } from '@shopping/shared'
import { Button, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { ReportFilters as Filters, ReportScope } from '@/lib/reports/report-console'
import { EMPTY_REPORT_FILTERS, reportScopes } from '@/lib/reports/report-console'
import type { ReportListMessages, ReportMessages } from '@/messages'

/**
 * 상태 · 대상 유형의 두 축.
 *
 * ## 상태가 다섯인데 계약의 상태는 넷이다
 *
 * 계약의 `status` 는 **목록**이라(`PENDING,HIDDEN`) 화면이 고르는 것은 상태 하나가
 * 아니라 **묶음 하나**일 수 있다. 「처리됨」이 그 자리이고, 그것이 없으면 끝난 것을
 * 훑는 사람은 숨김·삭제·반려를 세 번 골라 봐야 한다 (`report-console.ts` 의
 * `statusesOf`).
 *
 * **네 대상 유형을 손으로 적지 않는다.** 계약에 대상이 하나 늘면 이 목록은 저절로
 * 자라고, 문장이 없으면 `Record<ReportTargetType, string>` 이 컴파일로 잡는다
 * (`settlement-filters.tsx` 와 같은 규약).
 */

export interface ReportFiltersProps {
  readonly value: Filters
  readonly onChange: (filters: Filters) => void
  readonly messages: ReportListMessages
  readonly targetTypeLabels: ReportMessages['targetTypeLabels']
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL'

export function ReportFilters({
  value,
  onChange,
  messages,
  targetTypeLabels,
  disabled = false,
}: ReportFiltersProps) {
  const scopeId = useId()
  const targetId = useId()

  const { filters } = messages

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
          <label className="text-fg-muted text-sm" htmlFor={scopeId}>
            {filters.scopeLabel}
          </label>
          <Select
            disabled={disabled}
            id={scopeId}
            onValueChange={(next) => {
              onChange({ ...value, scope: next === ALL ? null : (next as ReportScope) })
            }}
            options={[
              { value: ALL, label: filters.scopeAll },
              ...reportScopes.map((scope) => ({
                value: scope,
                label: messages.scopeLabels[scope],
              })),
            ]}
            value={value.scope ?? ALL}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={targetId}>
            {filters.targetLabel}
          </label>
          <Select
            disabled={disabled}
            id={targetId}
            onValueChange={(next) => {
              onChange({
                ...value,
                targetType: next === ALL ? null : (next as ReportTargetType),
              })
            }}
            options={[
              { value: ALL, label: filters.targetAll },
              ...reportTargetTypes.map((target) => ({
                value: target,
                label: targetTypeLabels[target],
              })),
            ]}
            value={value.targetType ?? ALL}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_REPORT_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>
    </form>
  )
}
