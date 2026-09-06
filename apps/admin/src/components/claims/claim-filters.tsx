'use client'

import type { ClaimHandlingStage, ClaimStatus, ClaimType } from '@shopping/shared'
import { claimHandlingStages, claimStatuses, claimTypes } from '@shopping/shared'
import { Button, Input, Switch } from '@shopping/ui/components'
import { Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { AdminClaimFilters } from '@/lib/claims/claim-console'
import { EMPTY_ADMIN_CLAIM_FILTERS } from '@/lib/claims/claim-console'
import type { AdminClaimListMessages, ClaimVocabularyMessages } from '@/messages'

/**
 * 상태 · 단계 · 유형 · 기간 · 이의의 축.
 *
 * **판매자와 구매자는 여기 없다.** 계약이 아는 것은 식별자이고 이 콘솔에는 그 둘을
 * 빠짐없이 답하는 엔드포인트가 없다 — 첫 페이지만 담은 셀렉트는 거기 없는 가게를
 * 조용히 못 고르게 만든다. 그래서 그 둘은 **목록의 행에서** 고르고, 고른 것은 위의
 * 칩으로 보인다.
 *
 * **열 개짜리 상태 목록을 손으로 적지 않는다.** 상태가 하나 늘면 이 목록은 저절로
 * 자라고, 문장이 없으면 `Record<ClaimStatus, string>` 이 컴파일로 잡는다.
 */

export interface ClaimFiltersProps {
  readonly value: AdminClaimFilters
  readonly onChange: (filters: AdminClaimFilters) => void
  readonly messages: AdminClaimListMessages
  readonly vocabulary: ClaimVocabularyMessages
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL'

export function ClaimFilters({
  value,
  onChange,
  messages,
  vocabulary,
  disabled = false,
}: ClaimFiltersProps) {
  const statusId = useId()
  const stageId = useId()
  const typeId = useId()
  const fromId = useId()
  const toId = useId()

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

        <div className="flex min-w-48 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={statusId}>
            {filters.statusLabel}
          </label>
          <Select
            disabled={disabled}
            id={statusId}
            onValueChange={(next) => {
              onChange({ ...value, status: next === ALL ? null : (next as ClaimStatus) })
            }}
            options={[
              { value: ALL, label: filters.statusAll },
              ...claimStatuses.map((status) => ({
                value: status,
                label: vocabulary.statusLabels[status],
              })),
            ]}
            value={value.status ?? ALL}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={stageId}>
            {filters.stageLabel}
          </label>
          <Select
            disabled={disabled}
            id={stageId}
            onValueChange={(next) => {
              onChange({ ...value, stage: next === ALL ? null : (next as ClaimHandlingStage) })
            }}
            options={[
              { value: ALL, label: filters.stageAll },
              ...claimHandlingStages.map((stage) => ({
                value: stage,
                label: vocabulary.stageLabels[stage],
              })),
            ]}
            value={value.stage ?? ALL}
          />
        </div>

        <div className="flex min-w-32 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={typeId}>
            {filters.typeLabel}
          </label>
          <Select
            disabled={disabled}
            id={typeId}
            onValueChange={(next) => {
              onChange({ ...value, type: next === ALL ? null : (next as ClaimType) })
            }}
            options={[
              { value: ALL, label: filters.typeAll },
              ...claimTypes.map((type) => ({ value: type, label: vocabulary.typeLabels[type] })),
            ]}
            value={value.type ?? ALL}
          />
        </div>

        {/*
          날짜 입력 둘. 계약이 받는 것은 **순간**이고 사람이 고르는 것은 **날짜**라,
          그 사이는 `queryOf` 가 한국 시간의 하루로 메운다 — 그 규칙을 아래 한 줄이
          말한다. 감추면 「9월 5일까지」가 왜 그날 저녁까지인지 설명할 수 없다.
        */}
        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={fromId}>
            {filters.fromLabel}
          </label>
          <Input
            disabled={disabled}
            id={fromId}
            onChange={(event) => {
              onChange({ ...value, from: event.target.value === '' ? null : event.target.value })
            }}
            type="date"
            value={value.from ?? ''}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={toId}>
            {filters.toLabel}
          </label>
          <Input
            disabled={disabled}
            id={toId}
            onChange={(event) => {
              onChange({ ...value, to: event.target.value === '' ? null : event.target.value })
            }}
            type="date"
            value={value.to ?? ''}
          />
        </div>

        <Switch
          checked={value.appealed}
          disabled={disabled}
          label={filters.appealedLabel}
          onCheckedChange={(next) => {
            onChange({ ...value, appealed: next })
          }}
        />

        <Button
          onClick={() => {
            onChange(EMPTY_ADMIN_CLAIM_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>

      <p className="text-fg-subtle basis-full text-xs">{filters.periodHint}</p>
    </form>
  )
}
