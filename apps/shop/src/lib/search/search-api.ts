import type {
  SearchFiltersResponse,
  SearchQuery,
  SearchResponse,
  SearchSuggestResponse,
} from '@shopping/shared'
import {
  searchFiltersResponseSchema,
  searchResponseSchema,
  searchSuggestResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

import { writeSearchParams } from './search-params'

/**
 * TASK-0039 의 세 엔드포인트를 화면이 부르는 자리.
 *
 * `ApiClient` has no search methods — TASK-0039 built the server half and its
 * own integration spec reaches the routes through `request({ path, schema })`.
 * This module is that seam used the same way, and the property a method would
 * have given still holds: **the paths and the schemas appear once here**, and
 * every response type is `@shopping/shared`'s. Nothing in `apps/shop` says what
 * a search result looks like (gate C1).
 */

export const SEARCH_PAGE_SIZE = 24

/**
 * The request's query string, which is the URL's **plus paging**.
 *
 * The two are deliberately not the same string. A cursor in the address bar
 * would make a shared link point at page three of a search the recipient never
 * ran, and `limit` is a property of this screen rather than of the search — so
 * {@link writeSearchParams} writes what a person may share and this adds what
 * the request additionally needs.
 */
function requestSearch(query: SearchQuery, cursor: string | null): string {
  const params = new URLSearchParams(writeSearchParams(query))

  params.set('limit', String(query.limit ?? SEARCH_PAGE_SIZE))
  if (cursor !== null) params.set('cursor', cursor)

  return `?${params.toString()}`
}

/** One page of results, with the facet counts for the filters as they stand. */
export function fetchSearch(
  query: SearchQuery,
  options: { readonly cursor?: string | null; readonly signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const { cursor = null, ...rest } = options

  return getApiClient().request({
    path: `/search${requestSearch(query, cursor)}`,
    schema: searchResponseSchema,
    ...rest,
  })
}

/**
 * Which filters this category offers.
 *
 * A separate call from the search itself on purpose: the *set* of filters
 * changes only with the category, while the counts change with every click. One
 * combined response would re-send the whole schema on each narrowing, and a
 * panel that rebuilt itself from it would lose the section a person had open.
 */
export function fetchSearchFilters(
  categoryId: number | undefined,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SearchFiltersResponse> {
  const search = categoryId === undefined ? '' : `?categoryId=${String(categoryId)}`

  return getApiClient().request({
    path: `/search/filters${search}`,
    schema: searchFiltersResponseSchema,
    ...options,
  })
}

/** Listing names beginning with what has been typed so far. */
export function fetchSearchSuggestions(
  term: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SearchSuggestResponse> {
  return getApiClient().request({
    path: `/search/suggest?q=${encodeURIComponent(term)}`,
    schema: searchSuggestResponseSchema,
    ...options,
  })
}
