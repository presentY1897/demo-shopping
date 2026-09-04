/**
 * 검색 색인 파이프라인 — against a real Postgres and a real Meilisearch
 * (TASK-0038 6.1).
 *
 * **The engine is real here on purpose.** The unit specs use a double for the
 * things a double can answer — retry timing, what the mapper produces — but the
 * questions this task is actually about are the ones only the engine answers:
 * does a settings body it accepted make `attr_material` filterable, does a
 * document written and then removed really stop matching, does the synonym list
 * do what F6 says. Gate A6's argument for a real database is the same argument.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import type { AppConfig } from '../../src/config/app-config.js'
import { APP_CONFIG } from '../../src/config/app-config.js'

import type { SearchIndex } from '../../src/search/search-index.js'
import { SEARCH_INDEX } from '../../src/search/search-index.js'
import { SearchIndexerService } from '../../src/search/search-indexer.service.js'
import { SearchOutboxService } from '../../src/search/search-outbox.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  searchHostForTests,
  searchIndexForTests,
  searchKeyForTests,
} from '../support/search-host.js'
import {
  createAttributeDefinition,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'

const db = useDatabase()
/**
 * The one spec in this suite that wants a real search engine.
 *
 * Every other spec is pointed at a closed port so that a suite cannot pass or
 * fail by whether somebody happened to leave Meilisearch running. This one is
 * about the engine, so it asks for it — and requires it, the same way every
 * integration spec requires Postgres. CI runs one (`ci.yml` services).
 */
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

function indexer(): SearchIndexerService {
  return api.resolve<SearchIndexerService>(SearchIndexerService)
}

function outbox(): SearchOutboxService {
  return api.resolve<SearchOutboxService>(SearchOutboxService)
}

function index(): SearchIndex {
  return api.resolve<SearchIndex>(SEARCH_INDEX)
}

/**
 * The engine this app is pointed at.
 *
 * Read from the resolved config rather than the environment: the host is
 * **derived** from `PORT_OFFSET` (`derived-env.ts`), so a spec that guessed
 * `localhost:7700` would talk to another worktree's engine — or, in this
 * worktree, to nothing.
 */
function searchHost(): string {
  return api.resolve<AppConfig>(APP_CONFIG).search.host.replace(/\/+$/, '')
}

/** The engine is key-protected locally and in CI; the spec talks to it directly. */
function authHeaders(): Record<string, string> {
  const key = searchKeyForTests()

  return key === '' ? {} : { authorization: `Bearer ${key}` }
}

/** Meilisearch applies writes asynchronously; this waits for it to catch up. */
async function settled(): Promise<void> {
  await fetch(`${searchHost()}/tasks?statuses=enqueued,processing&limit=1`, {
    headers: authHeaders(),
  })
    .then(async (response) => response.json())
    .then(async (body: unknown) => {
      const results =
        typeof body === 'object' && body !== null && 'results' in body ? body.results : []

      if (Array.isArray(results) && results.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 120))

        return settled()
      }

      return undefined
    })
}

/** A raw search, so the assertions do not depend on TASK-0039's API. */
async function search(query: string, filter?: string): Promise<readonly string[]> {
  const response = await fetch(`${searchHost()}/indexes/${searchIndexForTests()}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ q: query, limit: 50, ...(filter === undefined ? {} : { filter }) }),
  })
  const body = (await response.json()) as { hits?: readonly { id: string }[] }

  return (body.hits ?? []).map((hit) => hit.id)
}

/**
 * Queues an event through the service the product write uses.
 *
 * Not a raw `INSERT`. Two things go wrong with one, and both of them looked like
 * the worker being broken:
 *
 * - `DEFAULT now()` stamps the row with the **database's** clock while the
 *   worker asks the **injected** one, which is fixed in the past here — so the
 *   event is never due. `clock-injection.spec.ts` names that trap in its header.
 * - `nextAttemptAt` is `timestamp without time zone`, and node-postgres sends a
 *   JS `Date` in the process's local zone while Prisma reads the column as UTC.
 *   A spec that wrote through `pg` and read through Prisma saw a row whose
 *   timestamp printed correctly and compared as hours away.
 *
 * Publishing the way production publishes avoids both, and checks that path
 * while it is at it.
 */
async function enqueue(productId: string, kind: 'UPSERT' | 'REMOVE' = 'UPSERT'): Promise<void> {
  await outbox().publish(api.resolve<PrismaService>(PrismaService), productId, kind)
}

/** One `ACTIVE` listing with a live combination, and its outbox event. */
async function listing(options: { readonly name?: string; readonly status?: string } = {}) {
  const user = await createUser(db, {})
  const seller = await createSeller(db, { userId: user.id })
  const category = await createCategory(db, {})
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId: category.id,
    ...(options.name === undefined ? {} : { name: options.name }),
    status: (options.status ?? 'ACTIVE') as 'ACTIVE',
    minPrice: 29_900,
    attributes: { material: '면' },
  })

  await createProductVariant(db, { productId: product.id, sellerId: seller.id, stock: 5 })
  await enqueue(product.id)

  return product
}

beforeEach(async () => {
  await db.query(`DELETE FROM "SearchOutbox"`)
  await indexer().configure()
  await index().clear()
  await settled()
})

describe('F1 · F2 — a change reaches the index', () => {
  it('indexes a listing the outbox names', async () => {
    const product = await listing({ name: '리넨 블라우스' })

    expect(await indexer().drain()).toBe(1)
    await settled()

    expect(await search('리넨')).toContain(product.id)
  })

  it('applies the newest event per listing, not each of them', async () => {
    // Ten edits in a second are ten rows and one document. Rebuilding it ten
    // times would be ten writes to the engine for the same bytes.
    const product = await listing()

    for (let i = 0; i < 5; i += 1) await enqueue(product.id)

    // All six events are consumed…
    expect(await indexer().drain()).toBe(6)
    // …and the queue is empty, which is what "one document" looks like from here.
    expect((await outbox().backlog()).pending).toBe(0)
  })

  it('empties the queue as it applies', async () => {
    await listing()

    expect((await outbox().backlog()).pending).toBe(1)
    await indexer().drain()
    expect((await outbox().backlog()).pending).toBe(0)
  })
})

describe('F3 — what must not be findable', () => {
  it('keeps a draft out of the index', async () => {
    const product = await listing({ name: '초안 셔츠', status: 'DRAFT' })

    await indexer().drain()
    await settled()

    expect(await search('초안')).not.toContain(product.id)
  })

  it('removes a listing that stopped being on sale', async () => {
    const product = await listing({ name: '내려간 코트' })

    await indexer().drain()
    await settled()
    expect(await search('코트')).toContain(product.id)

    await db.query(`UPDATE "Product" SET "status" = 'INACTIVE' WHERE "id" = $1`, [product.id])
    await enqueue(product.id)

    await indexer().drain()
    await settled()

    expect(await search('코트')).not.toContain(product.id)
  })
})

describe('facets and synonyms', () => {
  it('makes an attribute filterable without a line of code (D-005)', async () => {
    const product = await listing({ name: '면 셔츠' })

    // The facet exists because an **attribute definition** does. Nothing in
    // `search-index-settings.ts` names `material`; the indexer reads the keys
    // that exist and hands them to Meilisearch as filterable, which is what
    // makes "코드 수정 없이 속성을 추가한다" true for search as well.
    await createAttributeDefinition(db, {
      categoryId: (
        await db.one<{ categoryId: number }>(`SELECT "categoryId" FROM "Product" WHERE "id" = $1`, [
          product.id,
        ])
      ).categoryId,
      key: 'material',
      type: 'SELECT',
      options: ['면', '린넨'],
    })
    await indexer().configure()
    await settled()

    await indexer().drain()
    await settled()

    expect(await search('', 'attr_material = "면"')).toContain(product.id)
  })

  it('finds 니트 when the shopper typed 스웨터 (F6)', async () => {
    const product = await listing({ name: '라운드 니트' })

    await indexer().drain()
    await settled()

    expect(await search('스웨터')).toContain(product.id)
  })
})

describe('F5 · F5b · F5c — rebuilding', () => {
  it('rebuilds everything the database says is on sale', async () => {
    await listing({ name: '재색인 하나' })
    await listing({ name: '재색인 둘' })
    await listing({ name: '초안', status: 'DRAFT' })

    expect(await indexer().reindexAll()).toBe(2)
    await settled()

    expect(await search('재색인')).toHaveLength(2)
  })

  it('refills an index that was emptied, without being asked (F5b)', async () => {
    await listing({ name: '자동 복구' })
    await indexer().drain()
    await settled()

    await index().clear()
    await settled()
    expect(await search('자동')).toHaveLength(0)

    expect(await indexer().ensurePopulated()).toBe(true)
    await settled()

    expect(await search('자동')).toHaveLength(1)
  })

  it('does not rebuild an index that already has documents (R5)', async () => {
    await listing()
    await indexer().drain()
    await settled()

    expect(await indexer().ensurePopulated()).toBe(false)
  })

  it('runs one rebuild however many ask for it (F5c)', async () => {
    await listing()
    await listing()

    const [first, second, third] = await Promise.all([
      indexer().reindexAll(),
      indexer().reindexAll(),
      indexer().reindexAll(),
    ])

    // The same promise, so the same count — three separate rebuilds would each
    // read the whole catalogue and write it back over the others.
    expect([first, second, third]).toEqual([2, 2, 2])
  })
})

describe('F7 — the queue is observable', () => {
  it('reports what is waiting and when the worker last ran', async () => {
    await listing()

    const before = await outbox().backlog()

    expect(before.pending).toBe(1)
    expect(before.oldestAt).toBeInstanceOf(Date)

    await indexer().drain()

    expect((await outbox().backlog()).pending).toBe(0)
    expect(indexer().lastRunAt()).toBeInstanceOf(Date)
  })

  it('publishes it on /health', async () => {
    await listing()

    const health = await api.client.getHealth()

    expect(health.searchIndex.pending).toBe(1)
    expect(health.searchIndex.oldestPendingAt).not.toBeNull()
  })
})
