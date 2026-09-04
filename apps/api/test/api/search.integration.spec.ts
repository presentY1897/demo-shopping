/**
 * 검색 API — against a real Postgres and a real Meilisearch (TASK-0039 6.1).
 *
 * Every criterion here is about what the *engine* does with what this API sends
 * it: does a typo still find the coat (F2), do two categories offer different
 * filters (F4), do the facet counts match the results they promise (F5). A
 * double would answer whatever this code expected, which is the one answer a
 * test must not accept.
 */

import type { ApiClient, SearchResponse } from '@shopping/shared'
import {
  searchFiltersResponseSchema,
  searchResponseSchema,
  searchSuggestResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SearchIndex } from '../../src/search/search-index.js'
import { SEARCH_INDEX } from '../../src/search/search-index.js'
import { SearchIndexerService } from '../../src/search/search-indexer.service.js'
import { SearchOutboxService } from '../../src/search/search-outbox.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createAttributeDefinition,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import {
  searchHostForTests,
  searchIndexForTests,
  searchKeyForTests,
} from '../support/search-host.js'

const db = useDatabase()
const api = useApiApp({
  database: db,
  config: {
    search: {
      host: searchHostForTests(),
      masterKey: searchKeyForTests(),
      timeoutMs: 5_000,
      productsIndex: searchIndexForTests(),
    },
  },
})

function client(): ApiClient {
  return api.client
}

function indexer(): SearchIndexerService {
  return api.resolve<SearchIndexerService>(SearchIndexerService)
}

async function settled(): Promise<void> {
  const key = searchKeyForTests()
  const response = await fetch(
    `${searchHostForTests().replace(/\/+$/, '')}/tasks?statuses=enqueued,processing&limit=1`,
    { headers: key === '' ? {} : { authorization: `Bearer ${key}` } },
  )
  const body = (await response.json()) as { results?: readonly unknown[] }

  if ((body.results ?? []).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 120))

    return settled()
  }
}

function search(query: string): Promise<SearchResponse> {
  return client().request({ path: `/search${query}`, schema: searchResponseSchema })
}

/**
 * Two categories with different filters, and five listings across them.
 *
 * Rebuilt for **every** test, not once: the harness truncates the database
 * between tests (`support/database.ts`), and a fixture built in `beforeAll`
 * therefore survives only in Meilisearch. That produced a spec where everything
 * reading the index passed and everything reading a table saw an empty
 * catalogue — which reads as the filters being broken rather than as the rows
 * being gone.
 */
let coats: number
let shoes: number

beforeEach(async () => {
  // The index is not truncated with the database, so last test's documents would
  // still be there — and every count in this file is a count.
  await api.resolve<SearchIndex>(SEARCH_INDEX).clear()
  await settled()

  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const coatCategory = await createCategory(db, { name: '코트' })
  const shoeCategory = await createCategory(db, { name: '신발' })

  coats = coatCategory.id
  shoes = shoeCategory.id

  await createAttributeDefinition(db, {
    categoryId: coats,
    key: 'fit',
    type: 'SELECT',
    options: ['오버사이즈', '슬림'],
    isFilterable: true,
  })
  await createAttributeDefinition(db, {
    categoryId: shoes,
    key: 'width',
    type: 'SELECT',
    options: ['좁음', '보통'],
    isFilterable: true,
  })

  const outbox = api.resolve<SearchOutboxService>(SearchOutboxService)
  const prisma = api.resolve<PrismaService>(PrismaService)

  const listings = [
    {
      name: '오버핏 싱글 코트',
      categoryId: coats,
      attributes: { fit: '오버사이즈' },
      price: 189_900,
      stock: 5,
    },
    {
      name: '슬림 더블 코트',
      categoryId: coats,
      attributes: { fit: '슬림' },
      price: 259_900,
      stock: 3,
    },
    {
      name: '경량 발마칸 코트',
      categoryId: coats,
      attributes: { fit: '오버사이즈' },
      price: 99_900,
      stock: 0,
    },
    {
      name: '레트로 러너',
      categoryId: shoes,
      attributes: { width: '보통' },
      price: 79_900,
      stock: 8,
    },
    {
      name: '첼시 부츠',
      categoryId: shoes,
      attributes: { width: '좁음' },
      price: 149_900,
      stock: 2,
    },
  ]

  for (const listing of listings) {
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId: listing.categoryId,
      name: listing.name,
      status: 'ACTIVE',
      minPrice: listing.price,
      attributes: listing.attributes,
    })

    await createProductVariant(db, {
      productId: product.id,
      sellerId: seller.id,
      price: listing.price,
      stock: listing.stock,
      isActive: listing.stock > 0,
    })
    await outbox.publish(prisma, product.id, 'UPSERT')
  }

  await indexer().configure()
  await indexer().drain()
  await settled()
})

describe('F1 · F2 — finding things', () => {
  it('finds a listing by a word in its name', async () => {
    const answer = await search('?q=코트')

    expect(answer.items.map((item) => item.name)).toContain('오버핏 싱글 코트')
    expect(answer.total).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['레트루', '레트로 러너'],
    ['러니', '레트로 러너'],
    ['발마간', '경량 발마칸 코트'],
  ])('forgives a typo: %s (F2)', async (typed, expected) => {
    // Typo tolerance is the reason D-013 chose Meilisearch over Postgres FTS. If
    // this stops passing, that decision needs revisiting.
    //
    // **The first two only pass because of the lowered threshold** — at
    // Meilisearch's default they answer nothing, because it counts word length
    // in characters and Korean packs a syllable into one
    // (`search-index-settings.ts`). They are the negative control for that
    // setting as much as they are the check for F2.
    const answer = await search(`?q=${typed}`)

    expect(answer.items.map((item) => item.name)).toContain(expected)
  })

  it('does not forgive every typo, and the task’s own example is one', async () => {
    // 「코투」 → 코트 finds nothing at any threshold that was tried. Asserted so
    // that the limit is a recorded fact rather than a surprise for whoever reads
    // F2 and expects it to work — and so that a future engine or tokenizer
    // change shows up here as a failing test rather than as nothing at all.
    expect((await search('?q=코투')).items).toEqual([])
  })

  it('browses when nothing was typed', async () => {
    const answer = await search('?limit=100')

    expect(answer.items.length).toBeGreaterThanOrEqual(5)
  })
})

describe('F3 — autocomplete', () => {
  it('completes a prefix', async () => {
    const answer = await client().request({
      path: '/search/suggest?q=오버',
      schema: searchSuggestResponseSchema,
    })

    expect(answer.suggestions.join(' ')).toContain('오버핏')
  })

  it('answers nothing for an empty term rather than everything', async () => {
    const answer = await client().request({
      path: '/search/suggest?q=',
      schema: searchSuggestResponseSchema,
    })

    expect(answer.suggestions).toEqual([])
  })
})

describe('F4 — the filters are the catalogue’s', () => {
  it('offers different filters for different categories', async () => {
    const forCoats = await client().request({
      path: `/search/filters?categoryId=${String(coats)}`,
      schema: searchFiltersResponseSchema,
    })
    const forShoes = await client().request({
      path: `/search/filters?categoryId=${String(shoes)}`,
      schema: searchFiltersResponseSchema,
    })

    // Nobody wrote 'fit' or 'width' into this API. An operator turning the
    // switch on in the admin console is what put them here (D-005).
    expect(forCoats.filters.map((filter) => filter.key)).toEqual(['fit'])
    expect(forShoes.filters.map((filter) => filter.key)).toEqual(['width'])
  })

  it('carries the choices a screen has to draw', async () => {
    const answer = await client().request({
      path: `/search/filters?categoryId=${String(coats)}`,
      schema: searchFiltersResponseSchema,
    })

    expect(answer.filters[0]).toMatchObject({ type: 'SELECT', options: ['오버사이즈', '슬림'] })
  })
})

describe('F5 · F6 — facets and combined filters', () => {
  it('counts each value, and the count is what clicking it gives', async () => {
    const answer = await search(`?categoryId=${String(coats)}`)
    const counts = answer.facets.fit ?? {}

    expect(counts['오버사이즈']).toBe(2)

    const clicked = await search(`?categoryId=${String(coats)}&attr.fit=오버사이즈`)

    // The promise a facet makes: this number is how many you get.
    expect(clicked.items).toHaveLength(counts['오버사이즈'] ?? 0)
  })

  it('narrows by category, price and attribute at once (F6)', async () => {
    const answer = await search(
      `?categoryId=${String(coats)}&priceMin=100000&priceMax=200000&attr.fit=오버사이즈`,
    )

    expect(answer.items.map((item) => item.name)).toEqual(['오버핏 싱글 코트'])
  })

  it('treats two values of one attribute as "either"', async () => {
    const answer = await search(`?categoryId=${String(coats)}&attr.fit=오버사이즈,슬림`)

    expect(answer.items).toHaveLength(3)
  })

  it('hides sold-out listings only when asked', async () => {
    const all = await search(`?categoryId=${String(coats)}`)
    const available = await search(`?categoryId=${String(coats)}&inStock=true`)

    expect(all.items).toHaveLength(3)
    expect(available.items).toHaveLength(2)
  })
})

describe('F7 — sorting', () => {
  it('orders by price both ways', async () => {
    const cheap = await search(`?categoryId=${String(coats)}&sort=price_asc`)
    const dear = await search(`?categoryId=${String(coats)}&sort=price_desc`)

    expect(cheap.items.map((item) => item.price)).toEqual([99_900, 189_900, 259_900])
    expect(dear.items.map((item) => item.price)).toEqual([259_900, 189_900, 99_900])
  })

  it('accepts every sort the contract declares', async () => {
    for (const sort of ['relevance', 'newest', 'sales', 'rating'] as const) {
      const answer = await search(`?categoryId=${String(coats)}&sort=${sort}`)

      expect(answer.items, sort).toHaveLength(3)
    }
  })
})

describe('F8 — paging', () => {
  it('walks the results with no duplicate and no gap', async () => {
    const seen: string[] = []
    let cursor: string | null = null

    for (let page = 0; page < 10; page += 1) {
      const answer: SearchResponse = await search(
        `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      )

      seen.push(...answer.items.map((item) => item.id))
      cursor = answer.nextCursor
      if (cursor === null) break
    }

    expect(seen.length).toBeGreaterThanOrEqual(5)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('treats a nonsense cursor as the first page', async () => {
    const first = await search('?limit=2')
    const nonsense = await search('?limit=2&cursor=!!!')

    expect(nonsense.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id))
  })
})

describe('the search log', () => {
  it('records the term and how many it found', async () => {
    await search('?q=코트')

    const [row] = await db.query<{ term: string; resultCount: number }>(
      `SELECT "term", "resultCount" FROM "SearchLog" WHERE "term" = '코트' ORDER BY "id" DESC LIMIT 1`,
    )

    expect(row?.resultCount).toBeGreaterThan(0)
  })

  it('records a term that found nothing, which is the useful row', async () => {
    await search('?q=존재하지않는물건')

    const [row] = await db.query<{ resultCount: number }>(
      `SELECT "resultCount" FROM "SearchLog" WHERE "term" = '존재하지않는물건' ORDER BY "id" DESC LIMIT 1`,
    )

    expect(row?.resultCount).toBe(0)
  })

  it('does not record a browse', async () => {
    const before = await db.query(`SELECT 1 FROM "SearchLog"`)

    await search('?limit=1')

    expect(await db.query(`SELECT 1 FROM "SearchLog"`)).toHaveLength(before.length)
  })
})
