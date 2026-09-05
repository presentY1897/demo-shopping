import type { SearchFilter, SearchHit } from '@shopping/shared'
import {
  searchFiltersResponseSchema,
  searchResponseSchema,
  searchSuggestResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths } from '../paths'
import { answering } from './refusal'
import { categoryLineageIds, SEARCH_CATALOGUE, searchFilters } from './search-catalogue'

/**
 * 검색 (TASK-0039 의 엔드포인트를 TASK-0041 의 화면이 보는 모양대로).
 *
 * **Stateful enough to be filtered, and no more.** The screen's questions are
 * about *what a filter does*: does choosing 오버사이즈 narrow the list, do the
 * facet counts match what the click produces, does a value with no results come
 * back as zero so the panel can grey it out. A frozen page of hits answers none
 * of those, and a screen tested against one would pass while its filters did
 * nothing.
 *
 * What is **not** reproduced is relevance. Meilisearch's ranking is not
 * something a double can imitate honestly, so `q` here is a substring match and
 * the specs assert on what was filtered rather than on what came first.
 */

/**
 * A stand-in for the engine's typo tolerance — **not a copy of it**.
 *
 * Meilisearch corrects within a word by edit distance, and TASK-0039 measured
 * what that actually does to Korean: 「레트루」 finds 레트로, while 「코투」 finds
 * 코트 at no setting at all, because tolerance counts characters and a Hangul
 * syllable is one character carrying three letters. Reproducing that faithfully
 * is not something a double can do honestly.
 *
 * What it *can* do is produce the one case the screen has to handle: **results
 * came back and the typed word appears in none of them**. That is what F6 is
 * about — 「오타를 내도 결과가 나오고, 무엇으로 찾았는지 알려 준다」 — and one
 * substitution over a sliding window is enough to produce it.
 *
 * Tried only when the literal match found nothing, so every other spec still
 * sees exact matching and cannot be surprised by a near miss.
 */
function withinOneEdit(name: string, term: string): boolean {
  for (let start = 0; start + term.length <= name.length; start += 1) {
    let differences = 0

    for (let index = 0; index < term.length; index += 1) {
      if (name[start + index] !== term[index]) differences += 1
    }

    if (differences <= 1) return true
  }

  return false
}

/** Values that match, `AND` across keys and `OR` within one. */
function matchesAttributes(hit: SearchHit, chosen: Readonly<Record<string, string[]>>): boolean {
  return Object.entries(chosen).every(([key, values]) => {
    const held = SEARCH_CATALOGUE.find((entry) => entry.hit.id === hit.id)?.attributes[key]

    return held !== undefined && values.includes(held)
  })
}

/** Counts each remaining choice **after** the other filters — see the schema. */
function facetsFor(
  hits: readonly SearchHit[],
  filters: readonly SearchFilter[],
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {}

  for (const filter of filters) {
    const perValue: Record<string, number> = {}

    // Every declared option appears, including the ones at zero. A panel that
    // only saw the non-zero values could not grey anything out (F5).
    for (const option of filter.options) perValue[option] = 0

    for (const hit of hits) {
      const value = SEARCH_CATALOGUE.find((entry) => entry.hit.id === hit.id)?.attributes[
        filter.key
      ]

      if (value !== undefined) perValue[value] = (perValue[value] ?? 0) + 1
    }

    counts[filter.key] = perValue
  }

  return counts
}

export const searchHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.search, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') ?? ''
      const categoryId = url.searchParams.get('categoryId')
      const sort = url.searchParams.get('sort') ?? 'relevance'
      const limit = Number(url.searchParams.get('limit') ?? '20')
      const offset = Number(
        url.searchParams.get('cursor') === null
          ? 0
          : Buffer.from(url.searchParams.get('cursor') ?? '', 'base64url').toString('utf8'),
      )
      const chosen: Record<string, string[]> = {}

      for (const [key, value] of url.searchParams.entries()) {
        if (key.startsWith('attr.')) chosen[key.slice(5)] = value.split(',')
      }

      const filters = categoryId === null ? [] : searchFilters(Number(categoryId))
      const literal = (hit: SearchHit): boolean =>
        q === '' || hit.name.includes(q) || hit.brandName.includes(q)
      const everything = SEARCH_CATALOGUE.map((entry) => entry.hit)
      const exact = everything.filter(literal)
      const found =
        exact.length > 0 || q.length < 2
          ? exact
          : everything.filter(
              (hit) => withinOneEdit(hit.name, q) || withinOneEdit(hit.brandName, q),
            )

      const matched = found
        // Membership in the lineage, not equality — see `categoryLineageIds`.
        .filter(
          (hit) =>
            categoryId === null || categoryLineageIds(hit.categoryId).includes(Number(categoryId)),
        )
        .filter((hit) => url.searchParams.get('inStock') !== 'true' || hit.inStock)
        .filter((hit) => matchesAttributes(hit, chosen))

      const sorted = [...matched].sort((a, b) => {
        if (sort === 'price_asc') return a.price - b.price
        if (sort === 'price_desc') return b.price - a.price
        if (sort === 'sales') return b.salesCount - a.salesCount
        if (sort === 'rating') return b.ratingAvg - a.ratingAvg

        return 0
      })
      const page = sorted.slice(offset, offset + limit)
      const consumed = offset + limit

      return HttpResponse.json(
        defineFixture(searchResponseSchema, {
          items: page,
          facets: facetsFor(matched, filters),
          total: sorted.length,
          nextCursor:
            consumed < sorted.length
              ? Buffer.from(String(consumed), 'utf8').toString('base64url')
              : null,
        }),
      )
    }),
  ),

  http.get(mockPaths.searchFilters, ({ request }) =>
    answering(() => {
      const categoryId = Number(new URL(request.url).searchParams.get('categoryId') ?? '0')

      return HttpResponse.json(
        defineFixture(searchFiltersResponseSchema, { filters: [...searchFilters(categoryId)] }),
      )
    }),
  ),

  http.get(mockPaths.searchSuggest, ({ request }) =>
    answering(() => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      const names =
        q.trim() === ''
          ? []
          : [
              ...new Set(
                SEARCH_CATALOGUE.map((entry) => entry.hit.name).filter((name) => name.includes(q)),
              ),
            ].slice(0, 8)

      return HttpResponse.json(defineFixture(searchSuggestResponseSchema, { suggestions: names }))
    }),
  ),
]
