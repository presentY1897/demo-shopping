import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient, CreateProductRequest } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createCategory, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * Gates A5 (no N+1) and A1 (response time) for the seller console
 * (TASK-0115 완료 기준 A1 · A5).
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids; the only
 * difference from production is that this client says what it ran.
 *
 * A5 is the gate this task's list was designed around. TASK-0035 R1 named the
 * risk in one sentence — "목록에서 Variant 를 전부 로드하면 N+1" — and the
 * failure has no symptom in a functional test: every assertion about the
 * contents stays green while a hundred listings cost a hundred round trips.
 * Counting is the only way to know, so it is counted at five listings and again
 * at a hundred, and the number has to be the same one.
 */

const db = useDatabase()

/** Statements this run has seen, from the client the application is using. */
const statements: string[] = []

const observable = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db.url, max: 5 }),
  log: [{ emit: 'event', level: 'query' }],
})

;(
  observable as unknown as {
    $on: (event: 'query', listener: (payload: { query: string }) => void) => void
  }
).$on('query', (payload) => statements.push(payload.query))

const api = useApiApp({ database: db, authenticate: true, prisma: observable })

afterAll(async () => {
  await observable.$disconnect()
})

let categoryId: number
let seller: TestCaller

beforeEach(async () => {
  const category = await createCategory(db)
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  categoryId = category.id
  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
})

function client(): ApiClient {
  return api.clientAs(seller)
}

/** Runs `work` and reports every statement it caused. */
async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  // The event is emitted from the adapter's callback; a macrotask is enough for
  // the ones already resolved to have arrived.
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...statements]
}

/** Statements that actually touched one of the catalogue's tables. */
function catalogueStatements(seen: readonly string[]): string[] {
  return seen.filter((statement) =>
    [
      '"Product"',
      '"ProductVariant"',
      '"ProductOption"',
      '"ProductOptionValue"',
      '"ProductImage"',
      '"VariantOptionValue"',
    ].some((table) => statement.includes(table)),
  )
}

function request(overrides: Partial<CreateProductRequest> = {}): CreateProductRequest {
  return {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock: 10 },
    ...overrides,
  }
}

const COLOUR_AND_SIZE = [
  { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
  { name: '사이즈', values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }, { value: 'XL' }] },
]

/** `count` listings for this seller, each with one variant, written straight to the tables. */
async function bulkListings(count: number): Promise<void> {
  await db.execute(
    `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "minPrice", "updatedAt")
     SELECT gen_random_uuid(), $1, $2, '대량 ' || n, 'ACTIVE'::"ProductStatus", 10000 + n, now()
       FROM generate_series(1, $3::int) AS n`,
    [seller.sellerId, categoryId, count],
  )
  await db.execute(
    `INSERT INTO "ProductVariant" ("id", "productId", "sellerId", "sku", "price", "stock", "updatedAt")
     SELECT gen_random_uuid(), p."id", p."sellerId", 'BULK-' || replace(p."id"::text, '-', ''), 10000, 5, now()
       FROM "Product" p
      WHERE p."sellerId" = $1
        AND NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id")`,
    [seller.sellerId],
  )
}

describe('the console list is one statement, whatever it returns (A5)', () => {
  it('costs the same for 5 listings and for 100', async () => {
    await bulkListings(5)

    const forFew = await statementsDuring(() => client().getSellerProducts({ limit: 100 }))

    await bulkListings(95)

    const forMany = await statementsDuring(() => client().getSellerProducts({ limit: 100 }))

    // The stock total and the thumbnail come from lateral joins inside the same
    // statement. A query per row would be invisible in every functional test
    // and would make the console page linear in the catalogue.
    expect(catalogueStatements(forFew)).toHaveLength(1)
    expect(catalogueStatements(forMany)).toHaveLength(1)

    // A count that stayed flat because nothing came back would prove nothing.
    const { items } = await client().getSellerProducts({ limit: 100 })

    expect(items).toHaveLength(100)
  })

  it('costs the same again once the filters are on', async () => {
    await bulkListings(60)

    const plain = await statementsDuring(() => client().getSellerProducts({ limit: 100 }))
    const filtered = await statementsDuring(() =>
      client().getSellerProducts({ limit: 100, stock: 'low', status: 'ACTIVE', q: '대량' }),
    )

    // The stock band is compared against the lateral join's own output rather
    // than by discarding rows afterwards, so filtering costs no second pass.
    expect(catalogueStatements(filtered)).toHaveLength(catalogueStatements(plain).length)
  })
})

describe('the stock table is a fixed number of statements (A5)', () => {
  it('costs the same for one combination and for twelve', async () => {
    const { product: single } = await client().createProduct(request({ skuPrefix: 'ONE' }))
    const { product: grid } = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'TWELVE' }),
    )

    const forSingle = await statementsDuring(() => client().getSellerProductVariants(single.id))
    const forGrid = await statementsDuring(() => client().getSellerProductVariants(grid.id))

    // The option label is assembled by a lateral join. Asking per variant would
    // be the same N+1 moved from the list into the combination table, on a
    // listing that may carry two hundred rows.
    expect(catalogueStatements(forGrid)).toHaveLength(catalogueStatements(forSingle).length)

    const { variants } = await client().getSellerProductVariants(grid.id)

    expect(variants).toHaveLength(12)
    expect(variants.every((variant) => variant.optionLabel.includes(' / '))).toBe(true)
  })
})

describe('a bulk status change costs a fixed number per listing (A5)', () => {
  it('grows linearly and no faster', async () => {
    const ids: string[] = []

    for (let index = 0; index < 8; index += 1) {
      const { product } = await client().createProduct(request({ skuPrefix: `B${String(index)}` }))

      ids.push(product.id)
    }

    const forTwo = await statementsDuring(() =>
      client().changeProductStatuses({ productIds: ids.slice(0, 2), status: 'INACTIVE' }),
    )
    const forEight = await statementsDuring(() =>
      client().changeProductStatuses({ productIds: ids, status: 'DRAFT' }),
    )

    // Linear is the honest expectation here — every listing is locked and then
    // settled on its own — but the **marginal** cost has to be a constant, and
    // a small one. Two statements per listing plus one for the answer: a lookup
    // nested inside the loop would raise the slope while every functional test
    // stayed green.
    const slope = (catalogueStatements(forEight).length - catalogueStatements(forTwo).length) / 6

    expect(slope).toBe(2)
    expect(catalogueStatements(forTwo)).toHaveLength(2 * 2 + 1)
    expect(catalogueStatements(forEight)).toHaveLength(2 * 8 + 1)
  })
})

describe('response time (A1)', () => {
  function p95Of(durations: readonly number[]): number {
    const sorted = [...durations].sort((left, right) => left - right)

    return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
  }

  it('answers a page of 100 listings well inside 300ms at p95', async () => {
    await bulkListings(100)

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getSellerProducts({ limit: 100 })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('answers a filtered, searched page well inside 300ms at p95', async () => {
    await bulkListings(100)

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getSellerProducts({ limit: 20, q: '대량', stock: 'low', status: 'ACTIVE' })
      durations.push(performance.now() - started)
    }

    // Worth measuring separately: the name search is an `ILIKE` with a leading
    // wildcard, which no index serves. What keeps it cheap is that it is always
    // bounded to one store's catalogue by the partial index on `sellerId`.
    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('answers a twelve-row stock table well inside 300ms at p95', async () => {
    const { product } = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'PERF' }),
    )

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getSellerProductVariants(product.id)
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('records an adjustment well inside 300ms at p95, row lock included', async () => {
    const { product } = await client().createProduct(request({ skuPrefix: 'ADJ' }))
    const variantId = product.variants[0]?.id ?? ''

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.adjustVariantStock(variantId, { delta: 1, type: 'INBOUND' })
      durations.push(performance.now() - started)
    }

    // The lock, the position read, the level write and the ledger insert, in
    // one transaction — the shape every adjustment pays for.
    expect(p95Of(durations)).toBeLessThan(300)
  })
})
