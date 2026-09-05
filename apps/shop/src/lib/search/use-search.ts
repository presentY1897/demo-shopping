'use client'

import type { ApiFailure, SearchFilter, SearchHit, SearchQuery } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchSearch, fetchSearchFilters } from './search-api'
import { readSearchParams, writeSearchParams } from './search-params'

/**
 * 검색 화면의 상태 — 인데, 상태를 들고 있지 않다 (TASK-0041 4장 「URL 동기화」).
 *
 * The query is read from the address bar on every render and a change is a
 * navigation. That is what makes F4 structural rather than something to
 * remember: a refresh re-reads the same URL, a shared link starts the same
 * search, and Back is the browser's own — there is no second copy of the filters
 * that could disagree with the one in the URL.
 *
 * `push` rather than `replace`, because Back must undo a filter. Each click is a
 * deliberate, discrete narrowing, and the visitor who applied three filters and
 * wants the second one back expects the browser's own button to do it.
 *
 * **Results are the only thing kept in React state**, and they are keyed by the
 * query string that produced them: pages accumulate while the cursor advances
 * and are dropped the moment the query changes, because a cursor names a
 * position inside one filter set and cannot be carried across a change.
 */

export type SearchResultsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly SearchHit[]
      readonly facets: Readonly<Record<string, Readonly<Record<string, number>>>>
      readonly total: number
      readonly nextCursor: string | null
    }

export interface SearchController {
  /** What the address bar says, parsed. The single source of the filters. */
  readonly query: SearchQuery
  readonly results: SearchResultsState
  /** The category's filter definitions. Empty until they arrive, and when there is no category. */
  readonly filters: readonly SearchFilter[]
  readonly filtersLoading: boolean
  /** Replaces the whole query, which is a navigation. */
  readonly setQuery: (query: SearchQuery) => void
  readonly loadMore: () => void
  readonly loadingMore: boolean
  readonly retry: () => void
}

/**
 * Parts of the query the **route** decides, not the address bar.
 *
 * The category page is `/search` with one filter held down (TASK-0042 4장), and
 * the difference is where that filter lives: in the path, not the query string.
 * Pinning it here keeps `/categories/코트?attr.fit=슬림` honest — the address
 * says the category once, in the segment, and every other filter behaves exactly
 * as it does on the search screen because it *is* the same code.
 */
export type PinnedQuery = Pick<SearchQuery, 'categoryId'>

export function useSearch(pinned: PinnedQuery = {}): SearchController {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // The string, not the object: `useSearchParams` hands back a fresh instance on
  // every render and an effect keyed on it would re-fetch forever.
  const search = params.toString()
  const pinnedCategory = pinned.categoryId
  const query = useMemo(
    () => ({
      ...readSearchParams(new URLSearchParams(search)),
      ...(pinnedCategory === undefined ? {} : { categoryId: pinnedCategory }),
    }),
    [search, pinnedCategory],
  )
  const canonical = useMemo(() => writeSearchParams(query), [query])

  const [results, setResults] = useState<SearchResultsState>({ status: 'loading' })
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [filters, setFilters] = useState<readonly SearchFilter[]>([])
  const [filtersLoading, setFiltersLoading] = useState(false)

  const { categoryId } = query

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setFiltersLoading(true)

      try {
        const answer = await fetchSearchFilters(categoryId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setFilters(answer.filters)
      } catch {
        // A panel that cannot be built is a panel that is not shown. The results
        // are the page; losing the filter definitions must not lose them too.
        if (!controller.signal.aborted) setFilters([])
      } finally {
        if (!controller.signal.aborted) setFiltersLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [categoryId])

  /**
   * Paging resets when the query does.
   *
   * Written as a plain derivation rather than an effect that clears state: an
   * effect runs *after* the render that already used the stale cursor, which is
   * one request against the wrong filters every time somebody clicks a facet.
   */
  const [pagedFor, setPagedFor] = useState(canonical)

  if (pagedFor !== canonical) {
    setPagedFor(canonical)
    setCursor(null)
  }

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (cursor === null) setResults({ status: 'loading' })
      else setLoadingMore(true)

      try {
        const page = await fetchSearch(readSearchParams(new URLSearchParams(canonical)), {
          cursor,
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        setResults((held) => ({
          status: 'ready',
          // Appending only when this was a "more" request: a first page must
          // replace, or a narrowed search would show the rows it just excluded.
          items:
            cursor !== null && held.status === 'ready'
              ? [...held.items, ...page.items]
              : page.items,
          facets: page.facets,
          total: page.total,
          nextCursor: page.nextCursor,
        }))
      } catch (error) {
        if (controller.signal.aborted) return

        setResults({ status: 'error', failure: apiFailure(error) })
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [canonical, cursor, reloadToken])

  const setQuery = useCallback(
    (next: SearchQuery) => {
      // The pinned part is dropped before writing: it is already in the path, and
      // writing it as well would put the category in the address twice — where
      // the two could then disagree after an edit.
      const written = writeSearchParams(
        pinnedCategory === undefined ? next : { ...next, categoryId: undefined },
      )

      router.push(written === '' ? pathname : `${pathname}?${written}`)
    },
    [pathname, pinnedCategory, router],
  )

  const nextCursor = results.status === 'ready' ? results.nextCursor : null

  const loadMore = useCallback(() => {
    // Read from a derived value rather than from inside a `setResults` updater:
    // an updater must be pure, and React may call it twice.
    if (nextCursor !== null) setCursor(nextCursor)
  }, [nextCursor])

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return {
    query,
    results,
    filters,
    filtersLoading,
    setQuery,
    loadMore,
    loadingMore,
    retry,
  }
}
