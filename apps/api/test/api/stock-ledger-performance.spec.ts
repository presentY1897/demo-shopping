import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { StockService } from '../../src/stock/stock.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createCategory, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * Gates A1 (response time), A5 (no N+1) and S3 (the index is used) for the
 * ledger, measured rather than asserted by inspection.
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids.
 *
 * R2 is the reason this file exists. A ledger is the table that grows fastest
 * in a shop — every sale is a row — so "the history page is a fixed number of
 * statements" and "the opening balances of a hundred combinations are one" are
 * both easy to write and easy to lose.
 */

const db = useDatabase()

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
let skuCounter = 0

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

function stock(): StockService {
  return api.resolve<StockService>(StockService)
}

function uniqueSkuPrefix(): string {
  skuCounter += 1
  return `PERF${String(process.env.VITEST_POOL_ID ?? '1')}X${String(skuCounter)}`
}

async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...statements]
}

/** Statements that actually touched the ledger. */
function ledgerStatements(seen: readonly string[]): string[] {
  return seen.filter((statement) => statement.includes('"StockLedger"'))
}

async function variantOf(opening: number): Promise<string> {
  const { product } = await client().createProduct({
    categoryId,
    name: '오버사이즈 티셔츠',
    skuPrefix: uniqueSkuPrefix(),
    variantDefaults: { price: 19_000, stock: opening },
  })

  return product.variants[0]?.id ?? ''
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

describe('원장 쓰기는 조합 수에 비례하지 않는다 (A5)', () => {
  it('opens one variant and twelve with the same number of ledger statements', async () => {
    const forSingle = await statementsDuring(() =>
      client().createProduct({
        categoryId,
        name: '단품',
        skuPrefix: uniqueSkuPrefix(),
        variantDefaults: { price: 19_000, stock: 5 },
      }),
    )
    const forGrid = await statementsDuring(() =>
      client().createProduct({
        categoryId,
        name: '조합',
        skuPrefix: uniqueSkuPrefix(),
        options: [
          { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
          {
            name: '사이즈',
            values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }, { value: 'XL' }],
          },
        ],
        variantDefaults: { price: 19_000, stock: 5 },
      }),
    )

    // One INSERT for every opening movement, whatever the number of variants —
    // and the levels they produce go in as one UPDATE beside it. A movement per
    // variant would make product creation linear in the option grid, which is
    // invisible in every functional test.
    expect(ledgerStatements(forSingle)).toHaveLength(1)
    expect(ledgerStatements(forGrid)).toHaveLength(1)
  })

  it('costs a fixed number of statements to read a long history', async () => {
    const variantId = await variantOf(1)

    for (let index = 0; index < 40; index += 1) {
      await stock().adjust({ variantId, type: 'INBOUND', quantity: 1 })
    }

    const shortVariantId = await variantOf(1)
    const forShort = await statementsDuring(() =>
      client().getVariantLedger(shortVariantId, { limit: 20 }),
    )
    const forLong = await statementsDuring(() =>
      client().getVariantLedger(variantId, { limit: 20 }),
    )

    // The page and the totals, and nothing per row. `nextCursor` comes from
    // reading one extra row rather than from a count.
    expect(ledgerStatements(forLong)).toHaveLength(ledgerStatements(forShort).length)
    expect(ledgerStatements(forLong).length).toBeLessThanOrEqual(2)
  })
})

describe('인덱스가 조회를 받아 준다 (S3)', () => {
  beforeEach(async () => {
    // Spread over many variants on purpose. With every row on one variant the
    // index would return the whole table and a sequential scan really is the
    // cheaper plan — the assertion would then be about the fixture.
    await db.execute(
      `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "minPrice", "updatedAt")
       SELECT gen_random_uuid(), $1, $2, '대량 ' || n, 'ACTIVE'::"ProductStatus", 10000, now()
         FROM generate_series(1, 200) AS n`,
      [seller.sellerId, categoryId],
    )
    await db.execute(
      `INSERT INTO "ProductVariant" ("id", "productId", "sellerId", "sku", "price", "stock", "updatedAt")
       SELECT gen_random_uuid(), p."id", p."sellerId",
              'B' || replace(p."id"::text, '-', ''), 10000, 50, now()
         FROM "Product" p
        WHERE NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id")`,
    )
    await db.execute(
      `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter")
       SELECT v."id", n, 'INBOUND'::"StockLedgerType", 1, n
         FROM "ProductVariant" v, generate_series(1, 50) AS n`,
    )
    await db.execute(`ANALYZE "StockLedger"`)
  })

  async function planOf(sql: string, values: readonly unknown[] = []): Promise<string> {
    const rows = await db.query<Record<string, string>>(`EXPLAIN ${sql}`, values)

    return rows.map((row) => Object.values(row).join(' ')).join('\n')
  }

  it("plans an index scan for a variant's newest movements", async () => {
    const [row] = await db.query<{ id: string }>(`SELECT "id" FROM "ProductVariant" LIMIT 1`)
    const plan = await planOf(
      `SELECT * FROM "StockLedger" WHERE "variantId" = $1 ORDER BY "seq" DESC LIMIT 20`,
      [row?.id],
    )

    // The primary key is the read index. `seq` is monotonic in time within a
    // variant, so it orders chronologically as well — which is why no
    // `(variantId, createdAt)` index exists (TASK-0036 R2).
    expect(plan).toContain('StockLedger_pkey')
    expect(plan).not.toContain('Seq Scan')
    expect(plan).not.toContain('Sort')
  })

  it('plans an index scan for the next page', async () => {
    const [row] = await db.query<{ id: string }>(`SELECT "id" FROM "ProductVariant" LIMIT 1`)
    const plan = await planOf(
      `SELECT * FROM "StockLedger" WHERE "variantId" = $1 AND "seq" < 30 ORDER BY "seq" DESC LIMIT 20`,
      [row?.id],
    )

    expect(plan).toContain('StockLedger_pkey')
    expect(plan).not.toContain('Seq Scan')
  })
})

describe('응답 시간 (A1)', () => {
  it('answers a page of history well inside 300ms at p95', async () => {
    const variantId = await variantOf(1)

    for (let index = 0; index < 60; index += 1) {
      await stock().adjust({ variantId, type: 'INBOUND', quantity: 1 })
    }

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getVariantLedger(variantId, { limit: 20 })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('records a movement well inside 300ms at p95, row lock included', async () => {
    const variantId = await variantOf(500)
    const durations: number[] = []

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await stock().adjust({ variantId, type: 'SALE', quantity: -1 })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('reconciles a thousand variants well inside 300ms', async () => {
    // The batch M15 will run. It is a full pass by nature, so the number that
    // matters is whether it stays a single statement with a window function
    // rather than a query per variant.
    await db.execute(
      `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "minPrice", "updatedAt")
       SELECT gen_random_uuid(), $1, $2, '대량 ' || n, 'ACTIVE'::"ProductStatus", 10000, now()
         FROM generate_series(1, 1000) AS n`,
      [seller.sellerId, categoryId],
    )
    await db.execute(
      `INSERT INTO "ProductVariant" ("id", "productId", "sellerId", "sku", "price", "stock", "updatedAt")
       SELECT gen_random_uuid(), p."id", p."sellerId",
              'R' || replace(p."id"::text, '-', ''), 10000, 3, now()
         FROM "Product" p
        WHERE NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id")`,
    )
    await db.execute(
      `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter")
       SELECT v."id", n, 'INBOUND'::"StockLedgerType", 1, n
         FROM "ProductVariant" v, generate_series(1, 3) AS n`,
    )

    const started = performance.now()
    const discrepancies = await stock().reconcile()
    const elapsed = performance.now() - started

    expect(discrepancies).toEqual([])
    expect(elapsed).toBeLessThan(300)
  })
})
