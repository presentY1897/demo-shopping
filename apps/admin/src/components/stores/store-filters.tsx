'use client'

import type { SellerSortKey, SellerStatus } from '@shopping/shared'
import { sellerSortKeys, sellerStatuses } from '@shopping/shared'
import { Button, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { StoreFilters as Filters } from '@/lib/stores/store-console'
import { EMPTY_STORE_FILTERS } from '@/lib/stores/store-console'
import type { SellerReviewMessages, StoreListMessages } from '@/messages'

/**
 * 두 축과 정렬 하나 (F1 · F2 · F7).
 *
 * ## 정렬이 필터와 같은 줄에 있다
 *
 * 「문제 판매자를 지표로 찾을 수 있다」는 요구는 좁히기가 아니라 **줄 세우기**로
 * 답한다. 정렬을 다른 자리에 두면 클레임률 높은 순이 이 화면의 주된 쓰임이라는 것이
 * 화면에서 안 보이고, 그러면 사람은 스무 줄을 눈으로 훑는다.
 *
 * ## 세 값을 손으로 적지 않는다
 *
 * 상태 넷도 정렬 키 셋도 계약에서 온다(`sellerStatuses` · `sellerSortKeys`). 계약에
 * 값이 하나 늘면 이 목록은 저절로 자라고, 이름이 없으면 `Record<…, string>` 이
 * 컴파일로 잡는다 (`user-filters.tsx` 와 같은 규약).
 *
 * ## 상태 이름은 심사 탭의 것을 빌려 쓴다
 *
 * 한 화면의 두 탭이 같은 상태를 다르게 부르면 그것이 한 화면인 이유가 없어진다
 * (`sellers.statusLabels`).
 */

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다.
 */
const ALL = 'ALL'

const YES = 'YES'

const NO = 'NO'

function toTriState(value: string): boolean | null {
  if (value === YES) return true

  return value === NO ? false : null
}

function fromTriState(value: boolean | null): string {
  if (value === null) return ALL

  return value ? YES : NO
}

export interface StoreFiltersProps {
  readonly value: Filters
  readonly onChange: (filters: Filters) => void
  readonly messages: StoreListMessages
  readonly statusLabels: SellerReviewMessages['statusLabels']
  readonly disabled?: boolean
}

export function StoreFilters({
  value,
  onChange,
  messages,
  statusLabels,
  disabled = false,
}: StoreFiltersProps) {
  const statusId = useId()
  const demoId = useId()
  const sortId = useId()

  const { filters } = messages

  return (
    <div className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3">
      <fieldset className="contents">
        <legend className="sr-only">{filters.legend}</legend>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={statusId}>
            {filters.statusLabel}
          </label>
          <Select
            disabled={disabled}
            id={statusId}
            onValueChange={(next) => {
              onChange({ ...value, status: next === ALL ? null : (next as SellerStatus) })
            }}
            options={[
              { value: ALL, label: filters.statusAll },
              ...sellerStatuses.map((status) => ({ value: status, label: statusLabels[status] })),
            ]}
            value={value.status ?? ALL}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={demoId}>
            {filters.demoLabel}
          </label>
          <Select
            disabled={disabled}
            id={demoId}
            onValueChange={(next) => {
              onChange({ ...value, isDemo: toTriState(next) })
            }}
            options={[
              { value: ALL, label: filters.demoAll },
              { value: YES, label: filters.demoOnly },
              { value: NO, label: filters.realOnly },
            ]}
            value={fromTriState(value.isDemo)}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={sortId}>
            {filters.sortLabel}
          </label>
          <Select
            disabled={disabled}
            id={sortId}
            onValueChange={(next) => {
              onChange({ ...value, sort: next as SellerSortKey })
            }}
            options={sellerSortKeys.map((key) => ({
              value: key,
              label: filters.sortNames[key],
            }))}
            value={value.sort}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_STORE_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>
    </div>
  )
}
