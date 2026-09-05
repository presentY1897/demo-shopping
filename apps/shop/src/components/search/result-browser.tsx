'use client'

/**
 * 필터 · 정렬 · 결과 — 검색 화면과 카테고리 화면이 **같은 것**을 쓴다.
 *
 * TASK-0042 F3 asks that a category page filter exactly as the search page does.
 * The cheapest way to fail that is two components that look alike: they drift on
 * the first fix that only lands in one of them, and the drift is invisible until
 * somebody compares the two screens side by side. So there is one component, and
 * the only difference between the screens is what they hand it — a controller
 * whose category comes from the query string, or one whose category comes from
 * the path.
 *
 * **The panel is mounted in one of two places, never both** (D-055): a side
 * column from 768px up, a bottom sheet below it. Two trees with one hidden by
 * CSS would give a screen reader every filter twice.
 */

import { ProductCard, ProductList } from '@shopping/ui/catalog'
import { Button, Drawer, Select } from '@shopping/ui/components'
import { useDensity } from '@shopping/ui/density'
import { useViewportBand } from '@shopping/ui/layout'
import { searchSorts } from '@shopping/shared'
import { useState } from 'react'

import type { SearchController } from '@/lib/search/use-search'
import { matchedApproximately, unmatchedTerms } from '@/lib/search/typo-notice'
import type { SearchMessages } from '@/messages'

import { FilterChips } from './filter-chips'
import { FilterPanel } from './filter-panel'

export interface ResultBrowserProps {
  readonly controller: SearchController
  readonly messages: SearchMessages
}

export function ResultBrowser({ controller, messages }: ResultBrowserProps) {
  const { query, results, filters, filtersLoading, setQuery, loadMore, loadingMore, retry } =
    controller
  const { density } = useDensity()
  const band = useViewportBand()
  const [sheetOpen, setSheetOpen] = useState(false)

  const term = query.q ?? ''
  const items = results.status === 'ready' ? results.items : []
  const facets = results.status === 'ready' ? results.facets : {}
  const listState =
    results.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : results.status

  const panel = (
    <FilterPanel
      facets={facets}
      filters={filters}
      loading={filtersLoading}
      messages={messages.filters}
      onChange={setQuery}
      query={query}
    />
  )

  return (
    <>
      <div className="flex gap-6">
        {band === 'base' ? null : (
          <aside aria-label={messages.filters.title} className="w-64 shrink-0">
            <h2 className="text-fg mb-2 text-base font-semibold">{messages.filters.title}</h2>
            {panel}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-fg-muted text-sm" role="status">
              {results.status === 'ready'
                ? messages.totalLabel.replace('{count}', results.total.toLocaleString('ko-KR'))
                : ''}
            </p>

            <div className="flex items-center gap-2">
              {band === 'base' ? (
                <Button
                  onClick={() => {
                    setSheetOpen(true)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {messages.filters.openLabel}
                </Button>
              ) : null}

              <Select
                aria-label={messages.sort.label}
                onValueChange={(value) => {
                  setQuery({
                    ...query,
                    sort: searchSorts.find((sort) => sort === value) ?? 'relevance',
                  })
                }}
                options={searchSorts.map((sort) => ({
                  value: sort,
                  label: messages.sort.names[sort],
                }))}
                size="sm"
                value={query.sort ?? 'relevance'}
              />
            </div>
          </div>

          <FilterChips
            filters={filters}
            messages={messages.filters}
            onChange={setQuery}
            query={query}
          />

          {matchedApproximately(term, items) ? (
            <p className="border-border bg-surface-muted text-fg rounded-md border p-3 text-sm">
              <strong className="font-semibold">{messages.approximateTitle}</strong>{' '}
              {messages.approximateBody.replace('{terms}', unmatchedTerms(term, items).join(', '))}
            </p>
          ) : null}

          <ProductList
            density={density}
            hasMore={results.status === 'ready' && results.nextCursor !== null}
            labels={messages.list}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            onRetry={retry}
            state={listState}
          >
            {items.map((hit) => (
              <li key={hit.id}>
                <ProductCard
                  density={density}
                  href={`/products/${hit.id}`}
                  labels={messages.card}
                  product={{
                    id: hit.id,
                    name: hit.name,
                    brandName: hit.brandName,
                    price: hit.price,
                    imageUrl: hit.thumbnailUrl,
                    ratingAvg: hit.ratingAvg,
                    ratingCount: hit.ratingCount,
                    salesCount: hit.salesCount,
                    inStock: hit.inStock,
                  }}
                />
              </li>
            ))}
          </ProductList>
        </div>
      </div>

      {band === 'base' ? (
        <Drawer
          closeLabel={messages.filters.closeLabel}
          footer={
            <Button
              fullWidth
              onClick={() => {
                setSheetOpen(false)
              }}
              type="button"
            >
              {messages.filters.applyLabel}
            </Button>
          }
          onOpenChange={setSheetOpen}
          open={sheetOpen}
          side="bottom"
          title={messages.filters.title}
        >
          {panel}
        </Drawer>
      ) : null}
    </>
  )
}
