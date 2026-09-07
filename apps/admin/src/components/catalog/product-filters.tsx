'use client'

import type { ProductStatus } from '@shopping/shared'
import { productStatuses } from '@shopping/shared'
import { PRODUCT_SEARCH_MAX } from '@shopping/shared'
import { Button, Input, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { CategoryChoicesState } from '@/lib/catalog/use-products'
import type { ProductFilters as Filters } from '@/lib/catalog/product-console'
import { EMPTY_PRODUCT_FILTERS } from '@/lib/catalog/product-console'
import type { StoreChoicesState } from '@/lib/stores/use-stores'
import type { AdminProductListMessages, AdminProductMessages } from '@/messages'

/**
 * 세 축과 되돌리기 하나 (F1).
 *
 * ## 검색은 **제출로** 건다
 *
 * 세 셀렉트는 고르는 즉시 좁히지만 검색어는 버튼을 눌러야 나간다. 글자마다 보내면
 * 「hong」을 치는 동안 `ILIKE '%…%'` 가 네 번 나가고, 그것은 상품 표 전체를 훑는
 * 질의다 — 회원 목록이 같은 판단을 먼저 했다 (`user-filters.tsx`).
 *
 * **이 목록은 검색 엔진을 쓰지 않는다.** 색인은 판매 중인 것만 담으므로, 관리자가
 * 정작 찾으려는 초안이나 강제로 내려진 상품은 거기 없다 (TASK-0095 4.1).
 *
 * ## 두 목록은 실패해도 화면을 세우지 않는다
 *
 * 스토어와 카테고리는 **좁히기 위한 것**이지 목록의 내용이 아니다. 못 받아도 상품
 * 목록은 읽히므로, 그때는 셀렉트가 「전체」 하나만 들고 선다 — 이 화면의 본 일이 아닌
 * 실패로 본 일을 막지 않는다 (`lib/commissions/use-sellers.ts` 와 같은 판단).
 *
 * ## 상태 넷을 손으로 적지 않는다
 *
 * 계약에서 온다(`productStatuses`). 값이 하나 늘면 이 목록은 저절로 자라고, 이름이
 * 없으면 `Record<ProductStatus, string>` 이 컴파일로 잡는다.
 */

const ALL = 'ALL'

export interface ProductFiltersProps {
  readonly value: Filters
  readonly onChange: (filters: Filters) => void
  readonly messages: AdminProductListMessages
  readonly statusLabels: AdminProductMessages['statusLabels']
  readonly stores: StoreChoicesState
  readonly categories: CategoryChoicesState
  readonly disabled?: boolean
}

export function ProductFilters({
  value,
  onChange,
  messages,
  statusLabels,
  stores,
  categories,
  disabled = false,
}: ProductFiltersProps) {
  const searchId = useId()
  const hintId = useId()
  const sellerId = useId()
  const categoryId = useId()
  const statusId = useId()

  /** 아직 보내지 않은 검색어. 밖에서 들어온 값을 효과로 따라가지 않는다. */
  const [draft, setDraft] = useState(value.q ?? '')

  const { filters } = messages

  const storeOptions = [
    { value: ALL, label: filters.sellerAll },
    ...(stores.status === 'ready'
      ? stores.choices.map((store) => ({ value: store.id, label: store.name }))
      : []),
  ]

  const categoryOptions = [
    { value: ALL, label: filters.categoryAll },
    ...(categories.status === 'ready'
      ? categories.choices.map((category) => ({
          value: String(category.id),
          label: category.label,
        }))
      : []),
  ]

  return (
    <div className="flex flex-col gap-2">
      <form
        className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          onChange({ ...value, q: draft.trim() === '' ? null : draft.trim() })
        }}
        role="search"
      >
        <fieldset className="contents">
          <legend className="sr-only">{filters.legend}</legend>

          <div className="flex min-w-64 grow flex-col gap-1">
            <label className="text-fg-muted text-sm" htmlFor={searchId}>
              {filters.searchLabel}
            </label>
            <Input
              aria-describedby={hintId}
              disabled={disabled}
              id={searchId}
              maxLength={PRODUCT_SEARCH_MAX}
              onChange={(event) => {
                setDraft(event.target.value)
              }}
              placeholder={filters.searchPlaceholder}
              type="search"
              value={draft}
            />
            <p className="text-fg-subtle text-xs" id={hintId}>
              {filters.searchHint}
            </p>
          </div>

          <div className="flex min-w-56 flex-col gap-1">
            <label className="text-fg-muted text-sm" htmlFor={sellerId}>
              {filters.sellerLabel}
            </label>
            <Select
              disabled={disabled || stores.status === 'loading'}
              id={sellerId}
              onValueChange={(next) => {
                onChange({ ...value, sellerId: next === ALL ? null : next })
              }}
              options={storeOptions}
              value={value.sellerId ?? ALL}
            />
            {/* 「전체」 하나만 든 셀렉트는 다 불러온 것과 구별되지 않는다. 아직
                기다리는 중이라는 것을 말해야 사람이 없는 스토어를 찾다 포기하지 않는다. */}
            {stores.status === 'loading' ? (
              <p className="text-fg-subtle text-xs">{filters.sellerLoading}</p>
            ) : null}
          </div>

          <div className="flex min-w-56 flex-col gap-1">
            <label className="text-fg-muted text-sm" htmlFor={categoryId}>
              {filters.categoryLabel}
            </label>
            <Select
              disabled={disabled || categories.status === 'loading'}
              id={categoryId}
              onValueChange={(next) => {
                onChange({ ...value, categoryId: next === ALL ? null : Number(next) })
              }}
              options={categoryOptions}
              value={value.categoryId === null ? ALL : String(value.categoryId)}
            />
            {categories.status === 'loading' ? (
              <p className="text-fg-subtle text-xs">{filters.categoryLoading}</p>
            ) : null}
          </div>

          <div className="flex min-w-40 flex-col gap-1">
            <label className="text-fg-muted text-sm" htmlFor={statusId}>
              {filters.statusLabel}
            </label>
            <Select
              disabled={disabled}
              id={statusId}
              onValueChange={(next) => {
                onChange({ ...value, status: next === ALL ? null : (next as ProductStatus) })
              }}
              options={[
                { value: ALL, label: filters.statusAll },
                ...productStatuses.map((status) => ({
                  value: status,
                  label: statusLabels[status],
                })),
              ]}
              value={value.status ?? ALL}
            />
          </div>

          <Button type="submit">{filters.searchAction}</Button>
          <Button
            onClick={() => {
              setDraft('')
              onChange(EMPTY_PRODUCT_FILTERS)
            }}
            type="button"
            variant="ghost"
          >
            {filters.reset}
          </Button>
        </fieldset>
      </form>

      <p className="text-fg-subtle text-xs">{filters.sellerNotice}</p>
    </div>
  )
}
