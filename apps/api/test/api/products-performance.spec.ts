import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient, CreateProductRequest } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createCategory, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * Gates A1 (response time), A5 (no N+1) and S3 (the index is used), measured
 * rather than asserted by inspection.
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids; the only
 * difference from production is that this client says what it ran.
 *
 * A5 matters more here than anywhere in the catalogue so far, because a product
 * has three nested collections. "The list is one statement" and "the detail is
 * a fixed number" are both easy to write and easy to lose — one `include` in a
 * loop, one lookup per variant, and a twelve-variant listing costs thirteen
 * round trips while every functional test stays green.
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

/** Statements that actually touched one of this task's tables. */
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

/** `count` listings for this seller, written straight to the tables. */
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

describe('the listing is one statement, whatever it returns (A5)', () => {
  it('costs the same for 5 listings and for 50', async () => {
    await bulkListings(5)

    const forFew = await statementsDuring(() => client().getProducts({ limit: 100 }))

    await bulkListings(45)

    const forMany = await statementsDuring(() => client().getProducts({ limit: 100 }))

    // The counts, the stock total and the thumbnail all come from lateral joins
    // inside the same statement. A query per row would be invisible in every
    // functional test and would make the seller's catalogue page linear.
    expect(catalogueStatements(forFew)).toHaveLength(1)
    expect(catalogueStatements(forMany)).toHaveLength(1)

    const { products } = await client().getProducts({ limit: 100 })

    expect(products).toHaveLength(50)
  })
})

describe('the detail read is a fixed number of statements (A5)', () => {
  it('costs the same for one variant and for twelve', async () => {
    const { product: single } = await client().createProduct(request({ skuPrefix: 'ONE' }))
    const { product: grid } = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'TWELVE' }),
    )

    const forSingle = await statementsDuring(() => client().getProduct(single.id))
    const forGrid = await statementsDuring(() => client().getProduct(grid.id))

    expect(catalogueStatements(forGrid)).toHaveLength(catalogueStatements(forSingle).length)

    // And the bigger read really did come back whole — a count that stayed flat
    // because nothing was returned would prove nothing.
    const { product } = await client().getProduct(grid.id)

    expect(product.variants).toHaveLength(12)
    expect(product.variants.every((variant) => variant.optionValueIds.length === 2)).toBe(true)
  })

  it('costs a fixed number of statements to create twelve variants', async () => {
    const forSingle = await statementsDuring(() =>
      client().createProduct(request({ skuPrefix: 'CS' })),
    )
    const forGrid = await statementsDuring(() =>
      client().createProduct(request({ options: COLOUR_AND_SIZE, skuPrefix: 'CG' })),
    )

    // Twelve variants and their twenty-four mappings go in as two statements,
    // not as thirty-six. The extra ones the grid pays for are the axes and the
    // choices, which a product with no options does not have.
    expect(
      catalogueStatements(forGrid).length - catalogueStatements(forSingle).length,
    ).toBeLessThan(5)
  })
})

describe('the indexes serve the queries (S3)', () => {
  beforeEach(async () => {
    // Spread over many stores and categories on purpose. With every row on one
    // seller the index would return the whole table and a sequential scan
    // really is the cheaper plan — the assertion would then be about the
    // fixture rather than about the index.
    await db.execute(
      `INSERT INTO "Category" ("id", "parentId", "parentPath", "path", "depth", "name", "slug", "updatedAt")
       SELECT n, NULL, NULL, '/' || n || '/', 1, '대량 ' || n, 'bulk-' || n, now()
         FROM generate_series(5000, 5200) AS n`,
    )
    await db.execute(`SELECT setval(pg_get_serial_sequence('"Category"', 'id'), 5201)`)
    await db.execute(
      `INSERT INTO "User" ("id", "googleSub", "email", "name", "updatedAt")
       SELECT gen_random_uuid(), 'bulk-' || n, 'bulk' || n || '@example.com', '대량', now()
         FROM generate_series(1, 200) AS n`,
    )
    await db.execute(
      `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "status", "updatedAt")
       SELECT gen_random_uuid(), u."id", '브랜드 ' || u."googleSub", 'store-' || u."googleSub",
              'ACTIVE'::"SellerStatus", now()
         FROM "User" u WHERE u."googleSub" LIKE 'bulk-%'`,
    )
    await db.execute(
      `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "minPrice", "updatedAt")
       SELECT gen_random_uuid(), s."id", 5000 + (n % 200), '대량 ' || n,
              'ACTIVE'::"ProductStatus", 10000, now()
         FROM "Seller" s, generate_series(1, 30) AS n
        WHERE s."slug" LIKE 'store-bulk-%'`,
    )
    await db.execute(
      `INSERT INTO "ProductVariant" ("id", "productId", "sellerId", "sku", "price", "stock", "optionSignature", "updatedAt")
       SELECT gen_random_uuid(), p."id", p."sellerId",
              'B' || replace(p."id"::text, '-', ''), 10000, 5, '', now()
         FROM "Product" p`,
    )
    await db.execute(`ANALYZE "Product"`)
    await db.execute(`ANALYZE "ProductVariant"`)
  })

  async function planOf(sql: string, values: readonly unknown[] = []): Promise<string> {
    const rows = await db.query<Record<string, string>>(`EXPLAIN ${sql}`, values)

    return rows.map((row) => Object.values(row).join(' ')).join('\n')
  }

  it('plans an index scan for the seller’s catalogue page', async () => {
    const [store] = await db.query<{ id: string }>(
      `SELECT "id" FROM "Seller" WHERE "slug" LIKE 'store-bulk-%' LIMIT 1`,
    )
    const plan = await planOf(
      `SELECT "id" FROM "Product"
        WHERE "sellerId" = $1 AND "status" = 'ACTIVE'::"ProductStatus" AND "deletedAt" IS NULL`,
      [store?.id],
    )

    // The partial index is what serves this: it leads with `sellerId` and its
    // `WHERE "deletedAt" IS NULL` predicate matches the filter exactly, so a
    // plain `(sellerId, status)` index would be a second copy of the same
    // prefix that no read would ever choose (the lesson of TASK-0030's removed
    // `(categoryId, sortOrder)`).
    expect(plan).toContain('Product_seller_live_idx')
    expect(plan).not.toContain('Seq Scan')
  })

  it('plans an index scan for the category tree’s product count', async () => {
    const plan = await planOf(
      `SELECT count(*) FROM "Product" WHERE "categoryId" = 5100 AND "deletedAt" IS NULL`,
    )

    // The same index serves the count and the storefront's category listing,
    // because `categoryId` is a prefix of `(categoryId, status)`.
    expect(plan).toContain('Product_category_live_idx')
    expect(plan).not.toContain('Seq Scan')
  })

  it('plans an index scan for a product’s live variants', async () => {
    const [row] = await db.query<{ id: string }>(`SELECT "id" FROM "Product" LIMIT 1`)
    const plan = await planOf(
      `SELECT "id" FROM "ProductVariant" WHERE "productId" = $1 AND "deletedAt" IS NULL`,
      [row?.id],
    )

    // No plain `(productId)` index exists: the combination index already leads
    // with it and carries the same predicate.
    expect(plan).toContain('ProductVariant_product_signature_key')
    expect(plan).not.toContain('Seq Scan')
  })

  it('plans an index scan for a SKU lookup within a store', async () => {
    const [variant] = await db.query<{ sellerId: string; sku: string }>(
      `SELECT "sellerId", "sku" FROM "ProductVariant" LIMIT 1`,
    )
    const plan = await planOf(
      `SELECT "id" FROM "ProductVariant"
        WHERE "sellerId" = $1 AND "sku" = $2 AND "deletedAt" IS NULL`,
      [variant?.sellerId, variant?.sku],
    )

    expect(plan).toContain('ProductVariant_seller_sku_key')
    expect(plan).not.toContain('Seq Scan')
  })
})

describe('response time (A1)', () => {
  function p95Of(durations: readonly number[]): number {
    const sorted = [...durations].sort((left, right) => left - right)

    return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
  }

  it('answers a page of listings well inside 300ms at p95', async () => {
    await bulkListings(200)

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getProducts({ limit: 20 })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('answers a twelve-variant detail well inside 300ms at p95', async () => {
    const { product } = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'DETAIL' }),
    )

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getProduct(product.id)
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('creates a twelve-variant listing well inside 300ms at p95, row lock included', async () => {
    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 30; index += 1) {
      const started = performance.now()

      await caller.createProduct(
        request({ options: COLOUR_AND_SIZE, skuPrefix: `P${String(index)}` }),
      )
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})
