import type { SearchQuery, SearchSort } from '@shopping/shared'
import { searchSorts } from '@shopping/shared'

/**
 * The URL **is** the state (TASK-0041 4장 「URL 동기화」).
 *
 * Not a copy of it. A screen that held filters in `useState` and pushed them to
 * the URL afterwards has two answers to "what is filtered", and they disagree
 * the moment somebody presses Back — which is exactly the case F4 checks. So
 * these two functions are the whole of the state layer: the query string is
 * read into a `SearchQuery` on every render, and a change is a new query string.
 *
 * Pure, so the parsing can be tested without a router — and the parsing is where
 * a malformed link has to become a sensible page rather than a crash.
 */

const ATTRIBUTE_PREFIX = 'attr.'

function positiveInt(value: string | null): number | undefined {
  if (value === null) return undefined

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function nonNegativeInt(value: string | null): number | undefined {
  if (value === null) return undefined

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function sortOf(value: string | null): SearchSort | undefined {
  return value !== null && (searchSorts as readonly string[]).includes(value)
    ? (value as SearchSort)
    : undefined
}

/**
 * A query string as a query.
 *
 * Anything unreadable is **dropped**, never thrown on: a shared link with a
 * mangled price is still a link somebody clicked, and the right answer is the
 * search without that filter rather than an error page.
 */
export function readSearchParams(params: URLSearchParams): SearchQuery {
  const attributes: Record<string, string[]> = {}

  for (const [key, value] of params.entries()) {
    if (!key.startsWith(ATTRIBUTE_PREFIX)) continue

    const name = key.slice(ATTRIBUTE_PREFIX.length)
    const values = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')

    if (name !== '' && values.length > 0) attributes[name] = values
  }

  const q = params.get('q')?.trim() ?? ''
  const sellerId = params.get('sellerId')

  return {
    ...(q === '' ? {} : { q }),
    ...(positiveInt(params.get('categoryId')) === undefined
      ? {}
      : { categoryId: positiveInt(params.get('categoryId')) }),
    ...(sellerId === null || sellerId === '' ? {} : { sellerId }),
    ...(nonNegativeInt(params.get('priceMin')) === undefined
      ? {}
      : { priceMin: nonNegativeInt(params.get('priceMin')) }),
    ...(nonNegativeInt(params.get('priceMax')) === undefined
      ? {}
      : { priceMax: nonNegativeInt(params.get('priceMax')) }),
    ...(params.get('inStock') === 'true' ? { inStock: true } : {}),
    ...(sortOf(params.get('sort')) === undefined ? {} : { sort: sortOf(params.get('sort')) }),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  }
}

/**
 * A query as a query string.
 *
 * Keys are written in a fixed order so that the same filters always produce the
 * same URL — otherwise a link shared twice is two links, and the browser's
 * history fills with entries that differ only in spelling.
 */
export function writeSearchParams(query: SearchQuery): string {
  const params = new URLSearchParams()

  if (query.q !== undefined && query.q !== '') params.set('q', query.q)
  if (query.categoryId !== undefined) params.set('categoryId', String(query.categoryId))
  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  if (query.priceMin !== undefined) params.set('priceMin', String(query.priceMin))
  if (query.priceMax !== undefined) params.set('priceMax', String(query.priceMax))
  if (query.inStock === true) params.set('inStock', 'true')
  if (query.sort !== undefined && query.sort !== 'relevance') params.set('sort', query.sort)

  for (const key of Object.keys(query.attributes ?? {}).sort()) {
    const values = query.attributes?.[key] ?? []

    if (values.length > 0) params.set(`${ATTRIBUTE_PREFIX}${key}`, [...values].sort().join(','))
  }

  return params.toString()
}

/** Adds or removes one attribute value, leaving everything else alone. */
export function toggleAttribute(query: SearchQuery, key: string, value: string): SearchQuery {
  const current = query.attributes?.[key] ?? []
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value]
  const attributes = { ...query.attributes }

  if (next.length === 0) delete attributes[key]
  else attributes[key] = next

  return { ...query, attributes: Object.keys(attributes).length === 0 ? undefined : attributes }
}

/** Every filter currently applied, as chips a screen can render and remove. */
export interface AppliedFilter {
  readonly kind: 'attribute' | 'price' | 'inStock' | 'category'
  readonly key: string
  readonly value: string
  readonly label: string
}

export function appliedFilters(
  query: SearchQuery,
  labels: {
    readonly price: string
    readonly inStock: string
    readonly attribute: (key: string) => string
  },
): readonly AppliedFilter[] {
  const chips: AppliedFilter[] = []

  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    chips.push({
      kind: 'price',
      key: 'price',
      value: '',
      label: labels.price
        .replace('{min}', (query.priceMin ?? 0).toLocaleString('ko-KR'))
        .replace(
          '{max}',
          query.priceMax === undefined ? '' : query.priceMax.toLocaleString('ko-KR'),
        ),
    })
  }

  if (query.inStock === true) {
    chips.push({ kind: 'inStock', key: 'inStock', value: '', label: labels.inStock })
  }

  for (const key of Object.keys(query.attributes ?? {}).sort()) {
    for (const value of query.attributes?.[key] ?? []) {
      chips.push({
        kind: 'attribute',
        key,
        value,
        label: `${labels.attribute(key)}: ${value}`,
      })
    }
  }

  return chips
}

/** Removes one chip. */
export function removeFilter(query: SearchQuery, chip: AppliedFilter): SearchQuery {
  if (chip.kind === 'attribute') return toggleAttribute(query, chip.key, chip.value)
  if (chip.kind === 'inStock') return { ...query, inStock: undefined }

  return { ...query, priceMin: undefined, priceMax: undefined }
}
