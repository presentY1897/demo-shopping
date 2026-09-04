'use client'

import type { ReactNode } from 'react'

import { DataList } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { ErrorState } from '../components/error-state'
import { Skeleton } from '../components/skeleton'
import { useInfiniteScroll } from '../components/use-infinite-scroll'
import type { DensityLevel } from '../density/density'
import { DENSITY_GRID_COLUMNS } from '../density/density'
import { ProductGrid } from './product-grid'

/**
 * 목록의 네 가지 상태와 무한 스크롤 (TASK-0040 F5 · F7).
 *
 * **The skeleton has the shape of the grid it replaces.** A spinner over an
 * empty page moves everything down when the rows arrive; a skeleton laid out in
 * the same columns does not, which is most of what CLS measures (F4).
 *
 * **Infinite scroll is a sentinel, and it is not the only way down.** The hook
 * answers `supported: false` where `IntersectionObserver` is absent, and the
 * caller then renders its own 「더 보기」 — a list that could only be advanced by
 * an observer would be a list that ends for anyone without one.
 */
export interface ProductListLabels {
  readonly loading: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly errorTitle: string
  readonly retry: string
  readonly loadMore: string
  readonly gridLabel: string
}

export interface ProductListProps {
  readonly state: 'loading' | 'empty' | 'error' | 'ready'
  readonly density: DensityLevel
  readonly labels: ProductListLabels
  readonly children: ReactNode
  readonly hasMore?: boolean
  readonly loadingMore?: boolean
  readonly onLoadMore?: () => void
  readonly onRetry?: () => void
  readonly errorDescription?: ReactNode
}

export function ProductList({
  state,
  density,
  labels,
  children,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRetry,
  errorDescription,
}: ProductListProps) {
  // Destructured: read as `scroll.supported` the compiler's lint takes the whole
  // object for a ref holder — the hook also returns a `…Ref` — and refuses the
  // access during render. Two plain values say what they are.
  const { sentinelRef, supported } = useInfiniteScroll({
    hasMore,
    loading: loadingMore,
    onLoadMore: onLoadMore ?? (() => undefined),
    disabled: onLoadMore === undefined,
  })

  return (
    <DataList
      empty={<EmptyState description={labels.emptyDescription} title={labels.emptyTitle} />}
      error={
        <ErrorState
          description={errorDescription}
          onRetry={onRetry ?? (() => undefined)}
          retryLabel={labels.retry}
          title={labels.errorTitle}
        />
      }
      loading={<ProductListSkeleton density={density} label={labels.loading} />}
      state={state}
    >
      <ProductGrid density={density} label={labels.gridLabel}>
        {children}
      </ProductGrid>

      {onLoadMore === undefined || !hasMore ? null : (
        <>
          <div aria-hidden="true" ref={sentinelRef} />
          {supported ? null : (
            <button
              className="border-border text-fg mx-auto rounded-sm border px-4 py-2 text-sm"
              disabled={loadingMore}
              onClick={onLoadMore}
              type="button"
            >
              {labels.loadMore}
            </button>
          )}
        </>
      )}
    </DataList>
  )
}

/**
 * A grid of grey cards in the shape the real ones will take.
 *
 * As many placeholders as the widest viewport shows at this density: fewer would
 * leave the fold half empty while it loads, and more would push the footer down
 * and then pull it back up.
 */
export function ProductListSkeleton({
  density,
  label,
}: {
  readonly density: DensityLevel
  readonly label: string
}) {
  const columns = DENSITY_GRID_COLUMNS[density]

  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      <ProductGrid className="pointer-events-none" density={density} label={label}>
        {Array.from({ length: columns.xl * 2 }, (_unused, index) => (
          <li key={index}>
            <Skeleton className="aspect-[4/5]" shape="block" />
          </li>
        ))}
      </ProductGrid>
    </>
  )
}
