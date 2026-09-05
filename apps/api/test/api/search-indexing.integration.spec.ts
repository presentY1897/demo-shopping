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
import { DOCUMENT_VERSION } from '../../src/search/search-document.js'
import {
  DOCUMENT_VERSION_KEY,
  SearchIndexerService,
} from '../../src/search/search-indexer.service.js'
import { SearchService } from '../../src/search/search.service.js'
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
 * Suggestions through the **service**, not through a raw engine call.
 *
 * TASK-0103's whole mechanism is the step before the engine — classifying what
 * was typed and spreading it into the shape the index holds. A raw query would
 * skip exactly the part being tested.
 */
async function suggest(term: string): Promise<readonly string[]> {
  return api.resolve<SearchService>(SearchService).suggest(term)
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

describe('한글 자모 · 초성 (TASK-0103)', () => {
  /**
   * Against the real engine, because what is being checked is a *match* — and a
   * match is the engine's opinion, not a mapper's. The unit tests cover the
   * spelling; these cover whether the spelling finds anything.
   */
  async function indexed(name: string): Promise<void> {
    await listing({ name })
    await indexer().drain()
    await settled()
  }

  it('finds a listing mid-composition: 코ㅌ → 코트 (F1)', async () => {
    await indexed('오버핏 울 발마칸 코트')

    // 「코ㅌ」는 완성형 `코` 뒤에 호환 자모 `ㅌ` 다. 자모로 펴 두지 않으면 「코트」와
    // 한 글자도 겹치지 않는다.
    expect(await suggest('코ㅌ')).toContain('오버핏 울 발마칸 코트')
  })

  it('finds one by its initials: ㅋㅌ → 코트 (F2)', async () => {
    await indexed('오버핏 울 발마칸 코트')

    expect(await suggest('ㅋㅌ')).toContain('오버핏 울 발마칸 코트')
  })

  it('still finds a fully typed word, unchanged (F3)', async () => {
    await indexed('오버핏 울 발마칸 코트')

    expect(await suggest('코트')).toContain('오버핏 울 발마칸 코트')
    expect(await suggest('발마칸')).toContain('오버핏 울 발마칸 코트')
  })

  it('handles a name with Latin letters in it (F6)', async () => {
    await indexed('나이키 에어맥스 270')

    // 「나이ㅋ」 is a jamo query; the Latin and the digits must survive the
    // spreading rather than being dropped as 「not Hangul」.
    expect(await suggest('나이ㅋ')).toContain('나이키 에어맥스 270')
    expect(await suggest('270')).toContain('나이키 에어맥스 270')
  })

  it('prefers the fully typed match over a chosung one (F5)', async () => {
    // 「코트」 is a word in one and only the initials of the other.
    await indexed('클래식 코트')
    await indexed('카키 트렌치')

    const names = await suggest('코트')

    expect(names[0]).toBe('클래식 코트')
  })

  it('matches initials in the middle of a word too, and ranks the exact one first (4.1)', async () => {
    // 처음에는 「접두어만 맞는다」고 적었다가 이 검사가 반증했다. 세그멘터가 호환
    // 자모를 한 글자씩 쪼개므로 초성 검색은 토큰 나열을 찾는 것이 되고, 낱말
    // 가운데도 맞는다 — 접미사를 색인할 필요가 없었다.
    await indexed('클래식 코트')
    await indexed('울 롱코트')

    const names = await suggest('ㅋㅌ')

    expect(names).toContain('울 롱코트')
    // 정확히 맞은 쪽이 먼저다. 근접도 랭킹이 하는 일이고, R1 이 경계한 「넓어짐」을
    // 감당하는 것이 그것이다.
    expect(names[0]).toBe('클래식 코트')
  })

  it('does not match initials in the wrong order', async () => {
    await indexed('클래식 코트')

    // 「자모를 아무거나 포함」이 아니라는 음성 대조군. 순서가 있다.
    expect(await suggest('ㅌㅋ')).not.toContain('클래식 코트')
  })
})

describe('문서 형식이 바뀌면 스스로 다시 색인한다 (TASK-0042 4.1)', () => {
  /**
   * The failure this guards against is silent and total.
   *
   * A search engine has no schema. An index full of documents written before a
   * field existed answers every query — quickly, and with nothing, because the
   * filter names a field those documents do not have. `/health` stays green, the
   * logs stay quiet, and the catalogue simply looks empty to anybody who clicks
   * a category. Which is how `categoryIds` would have shipped.
   */
  async function version(): Promise<string | null> {
    const held = await api
      .resolve<PrismaService>(PrismaService)
      .appMeta.findUnique({ where: { key: DOCUMENT_VERSION_KEY } })

    return held?.value ?? null
  }

  it('rebuilds and records the shape when nothing has recorded one', async () => {
    await listing({ name: '형식 갱신' })
    await indexer().drain()
    await settled()

    expect(await version()).toBeNull()
    expect(await indexer().ensureCurrentShape()).toBe(true)
    await settled()

    expect(await version()).toBe(String(DOCUMENT_VERSION))
    expect(await search('형식')).toHaveLength(1)
  })

  it('does nothing the second time, so a boot is not a full read', async () => {
    await listing()
    await indexer().ensureCurrentShape()

    expect(await indexer().ensureCurrentShape()).toBe(false)
  })

  it('rebuilds again when the recorded shape is an older one', async () => {
    const prisma = api.resolve<PrismaService>(PrismaService)

    await listing({ name: '옛 형식' })
    await prisma.appMeta.upsert({
      where: { key: DOCUMENT_VERSION_KEY },
      create: { key: DOCUMENT_VERSION_KEY, value: '1' },
      update: { value: '1' },
    })

    expect(await indexer().ensureCurrentShape()).toBe(true)
    await settled()

    expect(await version()).toBe(String(DOCUMENT_VERSION))
    expect(await search('옛')).toHaveLength(1)
  })

  it('leaves an empty catalogue recorded as current', async () => {
    // Nothing stale can be in an index with nothing in it, and recording that
    // keeps a fresh deployment from reading the whole table on every boot.
    expect(await indexer().ensureCurrentShape()).toBe(true)
    expect(await version()).toBe(String(DOCUMENT_VERSION))
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
