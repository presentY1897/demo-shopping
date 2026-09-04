'use client'

import type {
  ApiFailure,
  ProductStatus,
  SellerProductListItem,
  SellerStockFilter,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { changeProductStatuses, duplicateProduct, fetchSellerProducts } from './console-api'

/**
 * One page of this store's listings, the filter over it, and the two writes.
 *
 * **Nothing is awaited during the server render.** The load runs in an effect,
 * so the heading, the filter bar and the skeleton are produced and sent while
 * the API may still be waking. That is also what gives the screen its four
 * states rather than two (P5 · U1).
 *
 * **Paging is `useCursorPagination`'s and the cursor is the query.** A keyset
 * list has exactly one thing to remember — which cursors it has visited — and
 * that is remembered in `packages/ui` where it is unit tested as input to
 * output. This hook reads `pagination.cursor` back out and asks for that page.
 *
 * **Selection is per page, and it is cleared by anything that moves the page**
 * (R3). A checkbox that survived a filter change would send ids the seller can
 * no longer see, and "5개 선택됨" beside a list of twelve different rows is a
 * count nobody can check.
 */

export type SellerProductsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly SellerProductListItem[]
      readonly nextCursor: string | null
    }

/** What the filter bar holds. `null` is 전체 in every one of them. */
export interface SellerProductFilters {
  readonly status: ProductStatus | null
  readonly categoryId: number | null
  readonly stock: SellerStockFilter | null
  readonly q: string
}

export const EMPTY_FILTERS: SellerProductFilters = {
  status: null,
  categoryId: null,
  stock: null,
  q: '',
}

/**
 * What a write answers with.
 *
 * A result rather than a thrown error: the caller is a dialog that has to keep
 * rendering either way, and the failure has to reach the screen as an
 * `ApiFailure` so the catalog decides the sentence (TASK-0117).
 */
export type SellerProductWrite<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ApiFailure }

export interface SellerProductsController {
  readonly state: SellerProductsState
  readonly filters: SellerProductFilters
  readonly setFilters: (filters: SellerProductFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
  /** Ids checked on the page that is on screen — never on a page that is not. */
  readonly selected: ReadonlySet<string>
  readonly toggle: (id: string) => void
  readonly toggleAll: () => void
  readonly clearSelection: () => void
  readonly setStatus: (status: ProductStatus) => Promise<SellerProductWrite<number>>
  readonly duplicate: (
    item: SellerProductListItem,
  ) => Promise<SellerProductWrite<{ readonly id: string; readonly name: string }>>
}

export function useSellerProducts(): SellerProductsController {
  const [state, setState] = useState<SellerProductsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<SellerProductFilters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [reloadToken, setReloadToken] = useState(0)

  /** A re-read that must not take the screen back to its skeleton. */
  const silent = useRef(false)

  const paging = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = paging

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const page = await fetchSellerProducts(
          {
            ...(filters.status === null ? {} : { status: filters.status }),
            ...(filters.categoryId === null ? {} : { categoryId: filters.categoryId }),
            ...(filters.stock === null ? {} : { stock: filters.stock }),
            ...(filters.q.trim() === '' ? {} : { q: filters.q.trim() }),
            ...(cursor === null ? {} : { cursor }),
          },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, reloadToken])

  /**
   * Changing the filter goes back to the first page and drops the selection.
   *
   * A cursor names a position *within one ordering and one filter*; carrying it
   * across a change would ask the API to continue a list that no longer exists.
   */
  const setFilters = useCallback(
    (next: SellerProductFilters) => {
      setFiltersState(next)
      setSelected(new Set())
      reset()
    },
    [reset],
  )

  /**
   * Paging is the other thing that replaces every row on screen.
   *
   * Wrapped here rather than cleared in an effect on `cursor`: an effect would
   * run *after* the new page renders, so for one paint the count would describe
   * rows that are no longer there — and React 19's lint says as much.
   */
  const pagination = useMemo<CursorPagination>(
    () => ({
      ...paging,
      goNext: () => {
        setSelected(new Set())
        paging.goNext()
      },
      goPrevious: () => {
        setSelected(new Set())
        paging.goPrevious()
      },
    }),
    [paging],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const toggle = useCallback((id: string) => {
    setSelected((held) => {
      const next = new Set(held)

      if (!next.delete(id)) next.add(id)

      return next
    })
  }, [])

  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state])
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
  }, [allSelected, items])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
  }, [])

  const setStatus = useCallback(
    async (status: ProductStatus): Promise<SellerProductWrite<number>> => {
      const productIds = [...selected]

      try {
        const answer = await changeProductStatuses({ productIds, status })

        // Re-read rather than patch the rows: a changed listing usually *leaves*
        // the page when a status filter is on, and the next page's contents
        // depend on this page's last id. The re-read is silent, so the table does
        // not blink back to a skeleton after every click.
        silent.current = true
        setSelected(new Set())
        setReloadToken((token) => token + 1)

        return { ok: true, value: answer.items.length }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [selected],
  )

  const duplicate = useCallback(
    async (
      item: SellerProductListItem,
    ): Promise<SellerProductWrite<{ readonly id: string; readonly name: string }>> => {
      try {
        const answer = await duplicateProduct(item.id)

        silent.current = true
        setReloadToken((token) => token + 1)

        return { ok: true, value: { id: answer.product.id, name: answer.product.name } }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [],
  )

  const isFiltered = useMemo(
    () =>
      filters.status !== null ||
      filters.categoryId !== null ||
      filters.stock !== null ||
      filters.q.trim() !== '',
    [filters],
  )

  return {
    state,
    filters,
    setFilters,
    isFiltered,
    pagination,
    reload,
    selected,
    toggle,
    toggleAll,
    clearSelection,
    setStatus,
    duplicate,
  }
}
