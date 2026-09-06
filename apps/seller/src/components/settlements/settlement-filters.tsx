'use client'

import type { SettlementStatus } from '@shopping/shared'
import { settlementStatuses } from '@shopping/shared'
import { Button, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { SellerSettlementFilters } from '@/lib/settlements/settlement-console'
import { EMPTY_SETTLEMENT_FILTERS } from '@/lib/settlements/settlement-console'
import type { Messages } from '@/messages'

/**
 * 상태 하나.
 *
 * 축이 하나뿐인 이유는 판매자가 자기 것만 보기 때문이다 — 관리자 화면에는 판매자와
 * 회차 축이 더 있다(TASK-0081). 여기서 「전체 판매자」를 고를 수 있는 것처럼 보이는
 * 자리를 만들면, 그 요청은 403 으로 끝난다.
 *
 * `coupon-filters.tsx` 와 같은 규약: **`null` 이 「전체」다.** 계약의 `status` 는
 * 목록이지만 화면이 고르는 것은 한 값이고, 보낼 때 한 원소짜리 목록으로 감싼다.
 */
export interface SettlementFiltersProps {
  readonly value: SellerSettlementFilters
  readonly onChange: (filters: SellerSettlementFilters) => void
  readonly messages: Messages
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다 (`coupon-filters.tsx` 가 같은 상수를 같은 이유로 둔다).
 */
const ALL = 'ALL'

export function SettlementFilters({
  value,
  onChange,
  messages,
  disabled = false,
}: SettlementFiltersProps) {
  const copy = messages.settlementList.filters
  const statusId = useId()

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{copy.legend}</legend>

        <div className="flex min-w-48 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={statusId}>
            {copy.statusLabel}
          </label>
          <Select
            disabled={disabled}
            id={statusId}
            onValueChange={(next) => {
              onChange({ status: next === ALL ? null : (next as SettlementStatus) })
            }}
            options={[
              { label: copy.statusAll, value: ALL },
              ...settlementStatuses.map((status) => ({
                label: messages.settlements.statusLabels[status],
                value: status,
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
          {copy.reset}
        </Button>
      </fieldset>
    </form>
  )
}
