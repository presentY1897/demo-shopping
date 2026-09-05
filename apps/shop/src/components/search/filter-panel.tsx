'use client'

/**
 * 필터 패널 — 속성 정의에서 자동 생성 (TASK-0041 F2 · F3, D-005).
 *
 * **Nothing here knows any filter's name.** No `if (key === 'fit')`, no list of
 * expected attributes, no Korean for a value: the sections are whatever
 * `GET /search/filters` named, the checkboxes are whatever options it listed,
 * and the labels are the ones an operator typed into the admin console. That is
 * the whole of F3 — an attribute switched on for filtering appears here with no
 * code change — and it is a property of this file containing no catalogue rather
 * than a thing to test for.
 *
 * The two filters that are *not* attributes — price and stock — are hard-coded,
 * and they should be: they live on every listing regardless of category, they
 * are columns rather than rows, and no operator can add or remove them.
 *
 * **Counts come from the response, and a zero disables the box** (F5). They are
 * counted after the other filters (see `facetCountsSchema`), so the number beside
 * a value is what clicking it would actually leave — which is why a zero is worth
 * showing at all rather than hiding the value.
 */

import type { FacetCounts, SearchFilter, SearchQuery } from '@shopping/shared'
import { Accordion, Button, Checkbox, Input } from '@shopping/ui/components'
import { useId, useState } from 'react'

import { toggleAttribute } from '@/lib/search/search-params'
import type { SearchFilterMessages } from '@/messages'

/** R1 — the sections past this one start folded. `sortOrder` decides which. */
const OPEN_SECTIONS = 5

export interface FilterPanelProps {
  readonly filters: readonly SearchFilter[]
  readonly facets: FacetCounts
  readonly query: SearchQuery
  readonly onChange: (query: SearchQuery) => void
  readonly messages: SearchFilterMessages
  readonly loading: boolean
}

/** One attribute's values, as checkboxes with their counts. */
function FacetOptions({
  filter,
  facets,
  query,
  onChange,
  messages,
}: Omit<FilterPanelProps, 'filters' | 'loading'> & { readonly filter: SearchFilter }) {
  const chosen = query.attributes?.[filter.key] ?? []
  const counts = facets[filter.key] ?? {}

  return (
    <ul className="flex flex-col gap-2 py-2">
      {filter.options.map((option) => {
        const count = counts[option] ?? 0
        const checked = chosen.includes(option)

        return (
          <li key={option}>
            <Checkbox
              checked={checked}
              // A value that would leave nothing cannot be chosen — but one that
              // is *already* chosen stays operable whatever its count says, or a
              // filter could be applied and never taken off again.
              disabled={count === 0 && !checked}
              label={
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span>{option}</span>
                  <span className="text-fg-subtle text-sm tabular-nums">
                    {messages.facetCount.replace('{count}', String(count))}
                  </span>
                </span>
              }
              onCheckedChange={() => {
                onChange(toggleAttribute(query, filter.key, option))
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}

/** The price range. Applied on its own button — a range is not final until both ends are. */
function PriceRange({
  query,
  onChange,
  messages,
}: Pick<FilterPanelProps, 'query' | 'onChange'> & { readonly messages: SearchFilterMessages }) {
  const minId = useId()
  const maxId = useId()
  const errorId = useId()

  const [min, setMin] = useState(query.priceMin === undefined ? '' : String(query.priceMin))
  const [max, setMax] = useState(query.priceMax === undefined ? '' : String(query.priceMax))

  const minValue = min.trim() === '' ? undefined : Number(min)
  const maxValue = max.trim() === '' ? undefined : Number(max)
  const invalid =
    minValue !== undefined &&
    maxValue !== undefined &&
    Number.isFinite(minValue) &&
    maxValue < minValue

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="text-fg-subtle text-sm" htmlFor={minId}>
            {messages.price.minLabel}
          </label>
          <Input
            aria-describedby={invalid ? errorId : undefined}
            id={minId}
            inputMode="numeric"
            invalid={invalid}
            onChange={(event) => {
              setMin(event.target.value)
            }}
            placeholder={messages.price.placeholderMin}
            value={min}
          />
        </div>
        <div className="min-w-0 flex-1">
          <label className="text-fg-subtle text-sm" htmlFor={maxId}>
            {messages.price.maxLabel}
          </label>
          <Input
            aria-describedby={invalid ? errorId : undefined}
            id={maxId}
            inputMode="numeric"
            invalid={invalid}
            onChange={(event) => {
              setMax(event.target.value)
            }}
            placeholder={messages.price.placeholderMax}
            value={max}
          />
        </div>
      </div>

      {invalid ? (
        <p className="text-danger text-sm" id={errorId} role="alert">
          {messages.price.invalid}
        </p>
      ) : null}

      <Button
        disabled={invalid}
        onClick={() => {
          onChange({
            ...query,
            priceMin: Number.isFinite(minValue) ? minValue : undefined,
            priceMax: Number.isFinite(maxValue) ? maxValue : undefined,
          })
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {messages.price.applyLabel}
      </Button>
    </div>
  )
}

export function FilterPanel({
  filters,
  facets,
  query,
  onChange,
  messages,
  loading,
}: FilterPanelProps) {
  if (loading) {
    return (
      <p aria-live="polite" className="text-fg-subtle p-3 text-sm" role="status">
        {messages.loadingLabel}
      </p>
    )
  }

  const items = [
    {
      value: 'price',
      title: messages.price.legend,
      content: <PriceRange messages={messages} onChange={onChange} query={query} />,
    },
    {
      value: 'inStock',
      title: messages.inStockChip,
      content: (
        <div className="py-2">
          <Checkbox
            checked={query.inStock === true}
            label={messages.inStock}
            onCheckedChange={(checked) => {
              onChange({ ...query, inStock: checked === true ? true : undefined })
            }}
          />
        </div>
      ),
    },
    ...filters.map((filter) => ({
      value: filter.key,
      title: filter.label,
      content: (
        <FacetOptions
          facets={facets}
          filter={filter}
          messages={messages}
          onChange={onChange}
          query={query}
        />
      ),
    })),
  ]

  return (
    <Accordion
      defaultValue={items.slice(0, OPEN_SECTIONS).map((item) => item.value)}
      items={items}
      type="multiple"
    />
  )
}
