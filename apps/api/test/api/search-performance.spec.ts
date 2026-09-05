/**
 * 검색 응답 시간 (TASK-0039 6.2 — A1 을 **p95 200ms** 로 강화).
 *
 * The task raises the gate for this endpoint on the grounds that 검색은 체감이
 * 직결된다, and that is measured here against the real engine with a catalogue
 * the size of a page of results — not against a double, which would time this
 * process rather than the search.
 */

import type { ApiClient } from '@shopping/shared'
import { searchResponseSchema, searchSuggestResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { PrismaService } from '../../src/prisma/prisma.service.js'
import type { SearchIndex } from '../../src/search/search-index.js'
import { SEARCH_INDEX } from '../../src/search/search-index.js'
import { SearchIndexerService } from '../../src/search/search-indexer.service.js'
import { SearchOutboxService } from '../../src/search/search-outbox.service.js'
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

/** How many listings the catalogue holds while it is timed. */
const CATALOGUE = 120

/** How many requests one percentile is taken over. */
const SAMPLES = 30

const BUDGET_MS = 200

function client(): ApiClient {
  return api.client
}

async function settled(): Promise<void> {
  const key = searchKeyForTests()
  const response = await fetch(
    `${searchHostForTests().replace(/\/+$/, '')}/tasks?statuses=enqueued,processing&limit=1`,
    { headers: key === '' ? {} : { authorization: `Bearer ${key}` } },
  )
  const body = (await response.json()) as { results?: readonly unknown[] }

  if ((body.results ?? []).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100))

    return settled()
  }
}

/** The p95 of `samples` runs, in milliseconds. */
async function p95(work: () => Promise<unknown>): Promise<number> {
  const timings: number[] = []

  for (let index = 0; index < SAMPLES; index += 1) {
    const startedAt = performance.now()

    await work()
    timings.push(performance.now() - startedAt)
  }

  timings.sort((a, b) => a - b)

  return timings[Math.floor(timings.length * 0.95)] ?? 0
}

let categoryId: number

beforeEach(async () => {
  await api.resolve<SearchIndex>(SEARCH_INDEX).clear()

  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const category = await createCategory(db, { name: '아우터' })

  categoryId = category.id

  await createAttributeDefinition(db, {
    categoryId,
    key: 'fit',
    type: 'SELECT',
    options: ['오버사이즈', '슬림'],
    isFilterable: true,
  })

  const outbox = api.resolve<SearchOutboxService>(SearchOutboxService)
  const prisma = api.resolve<PrismaService>(PrismaService)

  for (let index = 0; index < CATALOGUE; index += 1) {
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId,
      name: `데일리 코튼 코트 ${String(index).padStart(3, '0')}`,
      status: 'ACTIVE',
      minPrice: 19_900 + index * 1_000,
      attributes: { fit: index % 2 === 0 ? '오버사이즈' : '슬림' },
    })

    await createProductVariant(db, {
      productId: product.id,
      sellerId: seller.id,
      price: 19_900 + index * 1_000,
      stock: index % 7 === 0 ? 0 : 10,
    })
    await outbox.publish(prisma, product.id, 'UPSERT')
  }

  await api.resolve<SearchIndexerService>(SearchIndexerService).configure()
  await api.resolve<SearchIndexerService>(SearchIndexerService).drain()
  await settled()
})

describe('A1 — p95 200ms', () => {
  it('answers a keyword search inside the budget', async () => {
    const measured = await p95(() =>
      client().request({ path: '/search?q=코트&limit=20', schema: searchResponseSchema }),
    )

    expect(measured).toBeLessThan(BUDGET_MS)
  })

  it('answers a filtered, faceted, sorted search inside the budget', async () => {
    // The shape a category page actually sends: a filter, a sort and the facet
    // counts beside them. Timing the bare keyword query alone would measure the
    // easy case.
    const measured = await p95(() =>
      client().request({
        path: `/search?categoryId=${String(categoryId)}&attr.fit=오버사이즈&sort=price_asc&limit=20`,
        schema: searchResponseSchema,
      }),
    )

    expect(measured).toBeLessThan(BUDGET_MS)
  })

  /**
   * 자모·초성 자동완성도 같은 예산 안이어야 한다 (TASK-0103 F7).
   *
   * The whole feature is a thing that happens **while somebody is typing**, so it
   * is the one path where a hundred milliseconds is felt directly. Two extra
   * fields per document could have cost something; this is where that would show.
   */
  it.each([
    ['완성형', '코트'],
    ['조합 중', '코ㅌ'],
    ['초성', 'ㅋㅌ'],
  ])('answers a %s autocomplete inside the budget', async (_kind, term) => {
    const measured = await p95(() =>
      client().request({
        path: `/search/suggest?q=${encodeURIComponent(term)}`,
        schema: searchSuggestResponseSchema,
      }),
    )

    expect(measured).toBeLessThan(BUDGET_MS)
  })
})
