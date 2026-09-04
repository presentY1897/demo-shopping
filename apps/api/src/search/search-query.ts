import type { SearchQuery, SearchSort } from '@shopping/shared'
import { PRODUCT_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { ATTRIBUTE_FACET_PREFIX } from './search-document.js'

/**
 * A search request, turned into what Meilisearch is asked (TASK-0039 5장 1).
 *
 * Pure: query in, request body out. That is deliberate — the filter string is
 * the one place a user's words reach the engine's syntax, and a mistake there is
 * either a query that fails or, worse, one that quietly matches the wrong rows.
 * Q5 puts it in the 순수 로직 row for that reason.
 */

/** How each sort is expressed. `relevance` is the engine's own ranking. */
const SORTS: Readonly<Record<SearchSort, readonly string[]>> = {
  relevance: [],
  newest: ['createdAt:desc'],
  price_asc: ['price:asc'],
  price_desc: ['price:desc'],
  sales: ['salesCount:desc'],
  rating: ['ratingAvg:desc'],
}

/**
 * Escapes a value for Meilisearch's filter syntax.
 *
 * Values come from a shopper clicking a facet, so they are catalogue words — but
 * a quote or a backslash in an attribute value would otherwise end the string
 * early and change what the filter means. Quoting and escaping is the whole
 * defence, and it is applied to **every** value rather than to the ones that
 * look dangerous.
 */
export function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * The filter expression, or `null` when nothing is filtered.
 *
 * `AND` between different keys and `OR` within one: choosing 면 **and** 린넨
 * under 소재 means "either of these", and then adding a fit means "and also".
 * That is what a facet list with checkboxes produces, and getting it backwards
 * makes every second click return nothing.
 */
export function filterExpression(query: SearchQuery): string | null {
  const clauses: string[] = []

  if (query.categoryId !== undefined) clauses.push(`categoryId = ${String(query.categoryId)}`)
  if (query.priceMin !== undefined) clauses.push(`price >= ${String(query.priceMin)}`)
  if (query.priceMax !== undefined) clauses.push(`price <= ${String(query.priceMax)}`)
  if (query.inStock === true) clauses.push('inStock = true')

  for (const [key, values] of Object.entries(query.attributes ?? {})) {
    const field = `${ATTRIBUTE_FACET_PREFIX}${key}`
    const any = values.map((value) => `${field} = ${quote(value)}`).join(' OR ')

    clauses.push(values.length === 1 ? any : `(${any})`)
  }

  return clauses.length === 0 ? null : clauses.join(' AND ')
}

/**
 * The cursor, which wraps an **offset**.
 *
 * Every other list in this API pages by keyset, and this one cannot: a keyset
 * cursor names a position in an ordering the database can resume from, and
 * `relevance` is an ordering the search engine computes per query. Meilisearch
 * pages by offset, so that is what the cursor carries — encoded rather than
 * exposed, so that the day it can be a real key nothing has to change but this
 * file.
 *
 * `null` for a malformed cursor rather than an error: a stale link is a first
 * page, not a failure.
 */
export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0

  const decoded = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10)

  return Number.isInteger(decoded) && decoded >= 0 ? decoded : 0
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

export interface SearchRequest {
  readonly q: string
  readonly filter: string | null
  readonly sort: readonly string[]
  readonly offset: number
  readonly limit: number
  readonly facets: readonly string[]
}

/**
 * The engine request for one search.
 *
 * `limit + 1` is **not** asked for. Meilisearch answers an estimated total, so
 * whether another page exists is arithmetic on that rather than a peek at one
 * extra row — and asking for an extra row would change the facet counts.
 */
export function toSearchRequest(query: SearchQuery, facets: readonly string[]): SearchRequest {
  return {
    q: query.q ?? '',
    filter: filterExpression(query),
    sort: SORTS[query.sort ?? 'relevance'],
    offset: decodeCursor(query.cursor),
    limit: query.limit ?? PRODUCT_LIST_DEFAULT_LIMIT,
    facets,
  }
}

/** The cursor for the next page, or `null` when this was the last one. */
export function nextCursorFor(request: SearchRequest, total: number): string | null {
  const consumed = request.offset + request.limit

  return consumed < total ? encodeCursor(consumed) : null
}
