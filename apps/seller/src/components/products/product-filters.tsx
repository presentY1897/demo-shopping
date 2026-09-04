'use client'

import type { ProductStatus, SellerStockFilter } from '@shopping/shared'
import { productStatuses, sellerStockFilters } from '@shopping/shared'
import { Button, Input, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { CategoryChoice } from '@/lib/products/use-catalog-taxonomy'
import type { SellerProductFilters } from '@/lib/products/use-seller-products'
import { EMPTY_FILTERS } from '@/lib/products/use-seller-products'
import type { ProductListMessages } from '@/messages'

/**
 * The four ways to narrow the list (F3).
 *
 * **Each control changes the query as it is used; the search box does not.**
 * A `<select>` is a decision the moment it closes, and waiting for a submit
 * would leave the screen showing rows the filter says are excluded. Typing is
 * not a decision until it stops, so the box carries its own state and commits on
 * Enter or blur — otherwise every keystroke is a request and the list flickers
 * through four wrong answers on the way to the right one.
 *
 * **The vocabulary is the API's.** `productStatuses` and `sellerStockFilters`
 * are iterated rather than listed, so a value added to the contract appears here
 * without an edit and a value removed stops compiling.
 */
export interface ProductFiltersProps {
  readonly messages: ProductListMessages
  readonly statusLabels: Readonly<Record<ProductStatus, string>>
  readonly value: SellerProductFilters
  readonly categories: readonly CategoryChoice[]
  readonly onChange: (filters: SellerProductFilters) => void
  readonly disabled?: boolean
}

export function ProductFilters({
  messages,
  statusLabels,
  value,
  categories,
  onChange,
  disabled,
}: ProductFiltersProps) {
  const statusId = useId()
  const categoryId = useId()
  const stockId = useId()
  const searchId = useId()
  const [draft, setDraft] = useState(value.q)
  const [committed, setCommitted] = useState(value.q)

  // The box follows the filter when it is cleared from outside — otherwise
  // 「조건 지우기」 empties the query and leaves the word on screen.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component before touching the DOM, so the input never paints the stale
  // word, and there is no second commit for the browser to show in between.
  if (committed !== value.q) {
    setCommitted(value.q)
    setDraft(value.q)
  }

  const commitSearch = (): void => {
    if (draft.trim() !== value.q.trim()) onChange({ ...value, q: draft })
  }

  return (
    <section aria-label={messages.filters.legend} className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-40 flex-col gap-1">
        <label className="text-fg-muted text-sm" htmlFor={statusId}>
          {messages.filters.statusLabel}
        </label>
        <Select
          disabled={disabled}
          id={statusId}
          onValueChange={(next) => {
            onChange({ ...value, status: next === '' ? null : (next as ProductStatus) })
          }}
          options={[
            { value: '', label: messages.filters.statusAll },
            ...productStatuses.map((status) => ({ value: status, label: statusLabels[status] })),
          ]}
          value={value.status ?? ''}
        />
      </div>

      <div className="flex min-w-52 flex-col gap-1">
        <label className="text-fg-muted text-sm" htmlFor={categoryId}>
          {messages.filters.categoryLabel}
        </label>
        <Select
          disabled={disabled}
          id={categoryId}
          onValueChange={(next) => {
            onChange({ ...value, categoryId: next === '' ? null : Number(next) })
          }}
          options={[
            { value: '', label: messages.filters.categoryAll },
            ...categories.map((choice) => ({
              value: String(choice.id),
              label: choice.path.join(' > '),
            })),
          ]}
          value={value.categoryId === null ? '' : String(value.categoryId)}
        />
      </div>

      <div className="flex min-w-40 flex-col gap-1">
        <label className="text-fg-muted text-sm" htmlFor={stockId}>
          {messages.filters.stockLabel}
        </label>
        <Select
          disabled={disabled}
          id={stockId}
          onValueChange={(next) => {
            onChange({ ...value, stock: next === '' ? null : (next as SellerStockFilter) })
          }}
          options={[
            { value: '', label: messages.filters.stockAll },
            ...sellerStockFilters.map((filter) => ({
              value: filter,
              label: messages.filters.stockOptions[filter],
            })),
          ]}
          value={value.stock ?? ''}
        />
      </div>

      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <label className="text-fg-muted text-sm" htmlFor={searchId}>
          {messages.filters.searchLabel}
        </label>
        <Input
          disabled={disabled}
          id={searchId}
          onBlur={commitSearch}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitSearch()
            }
          }}
          placeholder={messages.filters.searchPlaceholder}
          type="search"
          value={draft}
        />
      </div>

      <Button
        disabled={disabled}
        onClick={() => {
          onChange(EMPTY_FILTERS)
        }}
        type="button"
        variant="ghost"
      >
        {messages.filters.reset}
      </Button>
    </section>
  )
}
