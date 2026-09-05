'use client'

/**
 * 적용된 필터 칩 (TASK-0041 「필터 칩 + 개별·전체 해제」).
 *
 * The chips exist because the panel is not always on screen: on a phone it is
 * behind a button, and after 「결과 보기」 closes the sheet the only remaining
 * evidence of three narrowings is the count of results. A row of chips is what
 * makes an applied filter visible *and* removable from where the results are.
 *
 * Which chips there are is derived from the query rather than tracked — see
 * `appliedFilters`. A list built by remembering each click would drift from the
 * URL the moment somebody pressed Back.
 */

import type { SearchFilter, SearchQuery } from '@shopping/shared'
import { Button, Tag } from '@shopping/ui/components'

import { appliedFilters, removeFilter } from '@/lib/search/search-params'
import type { SearchFilterMessages } from '@/messages'

export interface FilterChipsProps {
  readonly query: SearchQuery
  readonly filters: readonly SearchFilter[]
  readonly onChange: (query: SearchQuery) => void
  readonly messages: SearchFilterMessages
}

export function FilterChips({ query, filters, onChange, messages }: FilterChipsProps) {
  const chips = appliedFilters(query, {
    price: messages.priceChip,
    inStock: messages.inStockChip,
    // The attribute's own label when it is known, its key when it is not — a
    // chip for a filter whose definition has not arrived yet still has to say
    // something, and the key is at least true.
    attribute: (key) => filters.find((filter) => filter.key === key)?.label ?? key,
  })

  if (chips.length === 0) return null

  return (
    <div
      aria-label={messages.appliedLabel}
      className="flex flex-wrap items-center gap-2"
      role="group"
    >
      {chips.map((chip) => (
        <Tag
          key={`${chip.kind}:${chip.key}:${chip.value}`}
          onRemove={() => {
            onChange(removeFilter(query, chip))
          }}
          removeLabel={messages.removeLabel.replace('{name}', chip.label)}
          variant="primary"
        >
          {chip.label}
        </Tag>
      ))}

      <Button
        onClick={() => {
          // The term and the category survive: 「전체 해제」 undoes the
          // narrowing, not the search. Clearing back to an empty page would make
          // the button a trap nobody presses twice.
          onChange({ q: query.q, categoryId: query.categoryId, sort: query.sort })
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        {messages.clearAll}
      </Button>
    </div>
  )
}
