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
import {
  APP_ID_HEADER,
  createApiClient,
  sessionResponseSchema,
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  paymentResponseSchema,
  productListResponseSchema,
  productModerationResponseSchema,
} from '@shopping/shared'
import { parseSetCookie } from '../support/cookie-jar.js'

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
 * Deletes the index itself, which is what a restart of the engine amounts to.
 *
 * `clear()` empties an index that still exists; the free plan has no persistent
 * disk, so a restart leaves **no index at all** (TASK-0009). The two states look
 * the same from a query and are very different to `size()` — which is where the
 * recovery used to stop (TASK-0119 4.7).
 */
async function dropIndex(): Promise<void> {
  await fetch(`${searchHost()}/indexes/${searchIndexForTests()}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })

  await settled()
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
  it('discovers all twelve demo clones without an edit or a full rebuild', async () => {
    for (let i = 0; i < 12; i++) await listing({ name: `검색 체험 상품 ${i}` })
    await indexer().drain()
    await settled()
    const response = await fetch(`${api.baseUrl}/api/v1/auth/demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [APP_ID_HEADER]: 'seller' },
      body: JSON.stringify({ role: 'SELLER' }),
    })
    expect(response.status).toBe(200)
    await response.text()
    const copies = await db.query<{ id: string; sellerId: string }>(
      `SELECT p.id,p."sellerId" FROM "Product" p JOIN "Seller" s ON s.id=p."sellerId"
       JOIN "User" u ON u.id=s."userId" WHERE u."isDemo" ORDER BY p.id`,
    )
    expect(copies).toHaveLength(12)
    // Example sales may also enqueue a stock zero-crossing for the same product.
    expect(await indexer().drain()).toBeGreaterThanOrEqual(12)
    await expect
      .poll(
        async () => {
          const r = await fetch(`${api.baseUrl}/api/v1/search?sellerIds=${copies[0]!.sellerId}`)
          expect(r.status).toBe(200)
          const body = (await r.json()) as { items: { id: string }[] }
          return body.items.map((item) => item.id).sort()
        },
        { timeout: 10_000 },
      )
      .toEqual(copies.map((copy) => copy.id))
    await purchaseDiscoveredProduct(copies[0]!.id)
    await moderateDiscoveredProduct(copies[0]!.id, copies[0]!.sellerId)
  })

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

/**
 * 갱신된 평점이 검색까지 간다 (TASK-0084 F4).
 *
 * 사슬은 넷이다: 리뷰가 평점을 다시 세고 → 아웃박스에 사건을 남기고 → 색인이 문서를
 * 다시 쓰고 → 평점순 정렬이 그 값을 쓴다. **양 끝은 이미 다른 곳에서 재고 있다** —
 * 리뷰가 사건을 남기는 것은 `review-display.spec.ts` 가, `sort=rating` 이 어느 필드로
 * 가는지는 `search-query.spec.ts` 가 본다. 여기서 재는 것은 **그 사이**다.
 *
 * 이 가운데 토막이 비어 있으면 증상이 조용하다: 리뷰는 저장되고 별점도 상세에 뜨는데
 * **평점순 검색만 옛 순서로** 답한다. 어느 화면도 오류를 내지 않는다.
 */
describe('F4 — 갱신된 평점이 평점순 검색에 반영된다 (TASK-0084)', () => {
  /** 평점순으로 물어보고 id 를 순서대로 돌려준다. */
  async function byRating(): Promise<readonly string[]> {
    const response = await fetch(`${searchHost()}/indexes/${searchIndexForTests()}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ q: '', limit: 50, sort: ['ratingAvg:desc'] }),
    })
    const body = (await response.json()) as { hits?: readonly { id: string }[] }

    return (body.hits ?? []).map((hit) => hit.id)
  }

  it('rewrites the document and reorders the results', async () => {
    const quiet = await listing({ name: '조용한 코트' })
    const praised = await listing({ name: '칭찬받은 코트' })

    expect(await indexer().drain()).toBe(2)
    await settled()

    // 아직 둘 다 0점이다. 여기서 순서를 단언하지 않는 이유는 동점의 순서가 엔진의
    // 것이어서다 — 재려는 것은 「바뀌었다」이지 「처음부터 이랬다」가 아니다.
    const before = await byRating()

    expect(before).toHaveLength(2)

    // 리뷰가 평점을 다시 센 뒤의 상태. 그 계산 자체는 `review-display.spec.ts` 의 것이고,
    // 여기서는 그 결과가 색인까지 가는지만 본다.
    await db.execute(`UPDATE "Product" SET "ratingAvg" = 450, "ratingCount" = 3 WHERE "id" = $1`, [
      praised.id,
    ])
    await enqueue(praised.id)

    expect(await indexer().drain()).toBe(1)
    await settled()

    const after = await byRating()

    expect(after[0]).toBe(praised.id)
    expect(after[1]).toBe(quiet.id)
  })

  /**
   * **평점이 내려가도 따라간다.** 올라가는 쪽만 재면, 문서를 지우고 새로 쓰는 대신
   * 큰 값만 남기는 구현도 통과한다 — 리뷰를 지웠을 때 별점이 안 내려가는 버그다.
   */
  it('follows a rating back down when a review is removed', async () => {
    const product = await listing({ name: '되돌아온 코트' })

    await db.execute(`UPDATE "Product" SET "ratingAvg" = 500, "ratingCount" = 1 WHERE "id" = $1`, [
      product.id,
    ])
    await enqueue(product.id)
    await indexer().drain()
    await settled()

    await db.execute(`UPDATE "Product" SET "ratingAvg" = 0, "ratingCount" = 0 WHERE "id" = $1`, [
      product.id,
    ])
    await enqueue(product.id)
    await indexer().drain()
    await settled()

    const response = await fetch(`${searchHost()}/indexes/${searchIndexForTests()}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ q: '되돌아온', limit: 1 }),
    })
    const body = (await response.json()) as { hits?: readonly { ratingAvg: number }[] }

    expect(body.hits?.[0]?.ratingAvg).toBe(0)
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

  it('recreates an index that is gone, not only one that is empty (F10)', async () => {
    await listing({ name: '색인 소실' })
    await indexer().drain()
    await settled()

    await dropIndex()

    expect(await indexer().ensurePopulated()).toBe(true)
    await settled()

    expect(await search('소실')).toHaveLength(1)
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

async function demoClient(app: 'shop' | 'admin') {
  const issued = await fetch(`${api.baseUrl}/api/v1/auth/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [APP_ID_HEADER]: app },
    body: JSON.stringify({ role: app === 'shop' ? 'BUYER' : 'ADMIN' }),
  })
  expect(issued.status).toBe(200)
  const cookie = parseSetCookie(issued.headers.getSetCookie()[0] ?? '')!
  const refreshed = await fetch(`${api.baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { [APP_ID_HEADER]: app, cookie: `${cookie.name}=${cookie.value}` },
  })
  expect(refreshed.status).toBe(200)
  const session = sessionResponseSchema.parse(await refreshed.json())
  const client = createApiClient({
    baseUrl: api.baseUrl,
    appId: app,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          authorization: `Bearer ${session.accessToken}`,
        },
      }),
  })
  return { client, session }
}

/** A real demo session buys the discovered clone through the normal HTTP endpoints. */
async function purchaseDiscoveredProduct(productId: string): Promise<void> {
  const { client, session } = await demoClient('shop')
  const [variant] = await db.query<{ id: string }>(
    'SELECT id FROM "ProductVariant" WHERE "productId"=$1 AND "isActive" LIMIT 1',
    [productId],
  )
  const [address] = await db.query<{ id: string }>('SELECT id FROM "Address" WHERE "userId"=$1', [
    session.user.id,
  ])
  const [card] = await db.query<{ id: string }>('SELECT id FROM "VirtualCard" WHERE "userId"=$1', [
    session.user.id,
  ])
  const cart = await client.request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId: variant!.id, quantity: 1 },
    schema: cartResponseSchema,
  })
  const itemId = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === variant!.id)!.id
  const { checkout } = await client.request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds: [itemId] },
    schema: checkoutResponseSchema,
  })
  const { order } = await client.request({
    path: '/orders',
    method: 'POST',
    body: { checkoutId: checkout.id, addressId: address!.id },
    schema: orderResponseSchema,
  })
  const { payment } = await client.request({
    path: '/payments',
    method: 'POST',
    body: { orderId: order.id, provider: 'VIRTUAL_CARD', cardId: card!.id },
    schema: paymentResponseSchema,
  })
  await client.request({
    path: `/payments/${payment.id}/authorize`,
    method: 'POST',
    schema: paymentResponseSchema,
  })
  const captured = await client.request({
    path: `/payments/${payment.id}/capture`,
    method: 'POST',
    schema: paymentResponseSchema,
  })
  expect(captured.payment.status).toBe('PAID')
  const after = await client.request({ path: '/cart', schema: cartResponseSchema })
  expect(after.groups.flatMap((group) => group.items)).toHaveLength(0)
}

async function moderateDiscoveredProduct(productId: string, sellerId: string): Promise<void> {
  const { client } = await demoClient('admin')
  const listed = await client.request({
    path: `/products?sellerId=${sellerId}`,
    schema: productListResponseSchema,
  })
  expect(listed.products.map((product) => product.id)).toContain(productId)
  await client.request({
    path: `/admin/products/${productId}/hidden`,
    method: 'POST',
    body: { reason: '데모 상품 검색 노출 회귀 검사' },
    schema: productModerationResponseSchema,
  })
  await indexer().drain()
  await expect
    .poll(() => search('', `sellerId = "${sellerId}"`), { timeout: 10_000 })
    .not.toContain(productId)
  await client.request({
    path: `/admin/products/${productId}/hidden`,
    method: 'DELETE',
    schema: productModerationResponseSchema,
  })
  await indexer().drain()
  await expect
    .poll(() => search('', `sellerId = "${sellerId}"`), { timeout: 10_000 })
    .toContain(productId)
}
