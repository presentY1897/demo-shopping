'use client'

/**
 * 검색 화면 (TASK-0041).
 *
 * **The filter panel is one component mounted in one of two places** — a side
 * column from 768px up, a bottom sheet below it — and never both with one hidden
 * by CSS (D-055). Two trees would mean two accessibility trees, and a screen
 * reader would read every filter twice while a sighted visitor saw them once.
 * `useViewportBand` is what makes the branch a mount rather than a `display`.
 *
 * Everything a person can narrow by lives in the URL and nowhere else, so this
 * component holds no filter state at all: it reads `query`, and every control's
 * handler hands `setQuery` a new one. The sheet's own open/closed flag is the
 * single exception, and that is a property of this viewport rather than of the
 * search.
 */

import { matchedApproximately, unmatchedTerms } from '@/lib/search/typo-notice'
import { useSearch } from '@/lib/search/use-search'
import { ProductCard, ProductList } from '@shopping/ui/catalog'
import { Button, Drawer, Select } from '@shopping/ui/components'
import { useDensity } from '@shopping/ui/density'
import { PageContainer, useViewportBand } from '@shopping/ui/layout'
import { searchSorts } from '@shopping/shared'
import { useState } from 'react'

import { FilterChips } from './filter-chips'
import { FilterPanel } from './filter-panel'
import { SearchBox } from './search-box'
import type { SearchMessages, SearchSlotMessages } from '@/messages'

export interface SearchWorkspaceProps {
  readonly messages: SearchMessages
  /** The header's own copy, reused so the page's box says the same words. */
  readonly boxMessages: SearchSlotMessages
}

export function SearchWorkspace({ messages, boxMessages }: SearchWorkspaceProps) {
  const { query, results, filters, filtersLoading, setQuery, loadMore, loadingMore, retry } =
    useSearch()
  const { density } = useDensity()
  const band = useViewportBand()
  const [sheetOpen, setSheetOpen] = useState(false)

  const term = query.q ?? ''
  const searched = term !== '' || query.categoryId !== undefined
  const items = results.status === 'ready' ? results.items : []
  const facets = results.status === 'ready' ? results.facets : {}

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

  const listState =
    results.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : results.status

  return (
    <PageContainer className="flex flex-col gap-4 py-6">
      {/*
        A `div`, not a `header`. A `<header>` that is not inside an `article` or a
        `section` is a `banner` landmark, and this app already has one — the site
        header in `app/layout.tsx`. Two banners is what axe fails the page on, and
        the failure is right: a screen reader's landmark list would offer 「배너」
        twice and neither would be the one with the navigation in it.
      */}
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">
          {term === '' ? messages.title : messages.titleFor.replace('{term}', term)}
        </h1>

        <SearchBox
          className="w-full"
          defaultValue={term}
          messages={boxMessages}
          onSearch={(next) => {
            // The filters survive a re-search from this screen: they are on
            // screen as chips, and dropping what somebody can still see would
            // read as the page losing track rather than as a fresh start.
            setQuery({ ...query, q: next === '' ? undefined : next })
          }}
        />
      </div>

      {!searched ? (
        <section className="flex flex-col gap-1 py-10 text-center">
          <h2 className="text-lg font-semibold">{messages.promptTitle}</h2>
          <p className="text-fg-muted text-sm">{messages.promptBody}</p>
        </section>
      ) : (
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
                {messages.approximateBody.replace(
                  '{terms}',
                  unmatchedTerms(term, items).join(', '),
                )}
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
      )}

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
    </PageContainer>
  )
}
