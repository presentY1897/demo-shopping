import { z } from 'zod'

import { categoryIdSchema } from './categories.js'
import { PRODUCT_LIST_MAX_LIMIT, priceSchema, productIdSchema } from './products.js'

/**
 * 검색 API 의 계약 (TASK-0039).
 *
 * **The filters are not listed here.** A category's filterable attributes come
 * from `AttributeDefinition`, so the set of legal `attr.*` keys is data, not a
 * type — which is the whole of D-005 ("코드 수정 없이 속성을 추가할 수 있어야
 * 한다") applied to search. `GET /search/filters` tells a screen which keys
 * exist; this schema only says what one looks like.
 */

/** How results may be ordered. */
export const searchSorts = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'sales',
  'rating',
] as const

export type SearchSort = (typeof searchSorts)[number]

export const searchSortSchema = z.enum(searchSorts)

export const SEARCH_QUERY_MAX_LENGTH = 100

export const searchTermSchema = z.string().trim().max(SEARCH_QUERY_MAX_LENGTH)

/**
 * One attribute filter, as it arrives on the query string.
 *
 * `attr.fit=오버사이즈,루즈` — several values on one key mean **any of them**,
 * which is what a facet list with checkboxes produces. Two different keys mean
 * *both*, because narrowing by material and then by fit is one narrowing.
 */
export const attributeFilterSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  z.array(z.string().trim().min(1).max(80)).min(1).max(20),
)

export type AttributeFilter = z.infer<typeof attributeFilterSchema>

export const searchQuerySchema = z.object({
  q: searchTermSchema.optional(),
  categoryId: categoryIdSchema.optional(),
  priceMin: priceSchema.optional(),
  priceMax: priceSchema.optional(),
  /** `true` hides sold-out listings. Absent shows everything. */
  inStock: z.boolean().optional(),
  attributes: attributeFilterSchema.optional(),
  sort: searchSortSchema.optional(),
  limit: z.int().min(1).max(PRODUCT_LIST_MAX_LIMIT).optional(),
  /** Opaque. See `searchCursorSchema` for why it is not an id. */
  cursor: z.string().max(64).optional(),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>

/**
 * One result row.
 *
 * Deliberately smaller than `ProductSummary`: a search result is a card, and a
 * card that carried the whole listing would make the response the size of the
 * catalogue. What is here is what TASK-0040's card draws.
 */
export const searchHitSchema = z.object({
  id: productIdSchema,
  name: z.string(),
  brandName: z.string(),
  categoryId: categoryIdSchema,
  price: priceSchema,
  inStock: z.boolean(),
  thumbnailUrl: z.string().nullable(),
  ratingAvg: z.int().min(0).max(500),
  ratingCount: z.int().min(0),
  salesCount: z.int().min(0),
})

export type SearchHit = z.infer<typeof searchHitSchema>

/**
 * How many results each remaining choice would leave.
 *
 * `{ material: { 면: 12, 린넨: 3 } }` — counted **after** the other filters, so
 * the numbers describe what the next click actually does. A facet counted over
 * the unfiltered catalogue promises results that a click then fails to produce.
 */
export const facetCountsSchema = z.record(z.string(), z.record(z.string(), z.int().min(0)))

export type FacetCounts = z.infer<typeof facetCountsSchema>

export const searchResponseSchema = z.object({
  items: z.array(searchHitSchema),
  facets: facetCountsSchema,
  /** Meilisearch's estimate. Exact for small catalogues, approximate for large. */
  total: z.int().min(0),
  nextCursor: z.string().nullable(),
})

export type SearchResponse = z.infer<typeof searchResponseSchema>

/** One filter a category offers, with the values that exist under it. */
export const searchFilterSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** `SELECT` · `MULTI_SELECT` · `BOOLEAN` · `NUMBER` — how a screen draws it. */
  type: z.string(),
  /** Declared choices. Empty for a type that has none. */
  options: z.array(z.string()),
})

export type SearchFilter = z.infer<typeof searchFilterSchema>

export const searchFiltersResponseSchema = z.object({ filters: z.array(searchFilterSchema) })

export type SearchFiltersResponse = z.infer<typeof searchFiltersResponseSchema>

export const SEARCH_SUGGEST_LIMIT = 8

export const searchSuggestResponseSchema = z.object({
  /** Listing names that begin with what was typed, deduplicated. */
  suggestions: z.array(z.string()),
})

export type SearchSuggestResponse = z.infer<typeof searchSuggestResponseSchema>
