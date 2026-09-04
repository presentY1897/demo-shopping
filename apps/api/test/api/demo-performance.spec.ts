import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { APP_ID_HEADER, DEMO_ISSUE_LIMIT } from '@shopping/shared'
import { afterAll, describe, expect, it } from 'vitest'

import { DEMO_PRODUCT_COUNT } from '../../src/demo/demo-catalog-clone.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'

/**
 * Gates A1 (response time) and A5 (no N+1) for demo issuing.
 *
 * A1 matters here more than on a read path: the requirement a visitor feels is
 * F1 — five seconds from picking a persona to being signed in — and the seller
 * persona copies a whole catalogue inside its transaction. R2 of the task
 * anticipated this being the slow part.
 *
 * A5 is the reason the copy reads flat. A nested `include` would fetch images,
 * options, values and variants **per product**, so twelve listings would cost
 * around fifty round trips instead of six — and every functional test would stay
 * green while the issue got slower with every product added to the catalogue.
 * The assertion is therefore that the source read does not grow with the number
 * of products copied.
 *
 * The statements are counted at the source: a **real** `PrismaClient` against
 * the same worker database, differing from production only in that it says what
 * it ran (A6 forbids mocking it).
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

const api = useApiApp({ database: db, prisma: observable })

afterAll(async () => {
  await observable.$disconnect()
})

function issue(role: string, app: string, ip: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [APP_ID_HEADER]: app, 'x-forwarded-for': ip },
    body: JSON.stringify({ role }),
  })
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

/**
 * `count` live listings of real stores, one image and one variant each.
 *
 * `tag` keeps two calls in one test apart: every follow-up insert selects only
 * the rows this call created, so adding a second batch never rewrites the first.
 */
async function bulkCatalogue(count: number, tag: string): Promise<void> {
  await db.execute(
    `INSERT INTO "Category" ("id", "parentId", "parentPath", "path", "depth",
                            "name", "slug", "sortOrder", "isActive", "updatedAt")
     VALUES (1, NULL, NULL, '/1/', 1, '데모', 'demo-perf', 0, TRUE, now())
     ON CONFLICT DO NOTHING`,
  )
  await db.execute(
    `INSERT INTO "User" ("id", "googleSub", "email", "name", "updatedAt")
     SELECT gen_random_uuid(), $1 || '-' || n, $1 || n || '@example.com', '대량', now()
       FROM generate_series(1, $2::int) AS n`,
    [tag, count],
  )
  await db.execute(
    `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "status", "statusChangedAt", "updatedAt")
     SELECT gen_random_uuid(), u."id", '브랜드 ' || u."googleSub", 'store-' || u."googleSub",
            'ACTIVE', now(), now()
       FROM "User" u WHERE u."googleSub" LIKE $1 || '-%'`,
    [tag],
  )
  await db.execute(
    `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "attributes",
                           "minPrice", "updatedAt")
     SELECT gen_random_uuid(), s."id", 1, '성능 상품 ' || s."slug", 'ACTIVE', '{}'::jsonb,
            12000, now()
       FROM "Seller" s WHERE s."slug" LIKE 'store-' || $1 || '-%'`,
    [tag],
  )
  await db.execute(
    `INSERT INTO "ProductImage" ("id", "productId", "url", "sortOrder")
     SELECT gen_random_uuid(), p."id", 'https://cdn.test.invalid/' || p."id" || '.png', 0
       FROM "Product" p
       JOIN "Seller" s ON s."id" = p."sellerId"
      WHERE s."slug" LIKE 'store-' || $1 || '-%'`,
    [tag],
  )
  await db.execute(
    `INSERT INTO "ProductVariant" ("id", "productId", "sellerId", "sku", "price", "stock",
                                  "isActive", "optionSignature", "updatedAt")
     SELECT gen_random_uuid(), p."id", p."sellerId", 'PERF-' || left(p."id"::text, 8),
            12000, 9, TRUE, '', now()
       FROM "Product" p
       JOIN "Seller" s ON s."id" = p."sellerId"
      WHERE s."slug" LIKE 'store-' || $1 || '-%'`,
    [tag],
  )
}

/** Statements a piece of work caused that touched a catalogue table. */
async function catalogueStatementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  await new Promise((resolve) => setTimeout(resolve, 20))

  return statements.filter((statement) =>
    ['"Product"', '"ProductImage"', '"ProductOption"', '"ProductVariant"'].some((table) =>
      statement.includes(table),
    ),
  )
}

describe('발급의 응답 시간', () => {
  it('구매자 발급이 300ms 안에 끝난다 (A1)', async () => {
    const durations: number[] = []

    // Fresh addresses, so the rate limit never becomes the thing being measured.
    for (let sample = 0; sample < 20; sample += 1) {
      const started = performance.now()
      const response = await issue('BUYER', 'shop', `192.0.2.${String(sample + 1)}`)

      durations.push(performance.now() - started)
      expect(response.status).toBe(200)
      await response.text()
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('열두 개를 복제하는 판매자 발급도 300ms 안에 끝난다 (A1 · R2)', async () => {
    await bulkCatalogue(DEMO_PRODUCT_COUNT * 2, 'perf')

    const durations: number[] = []

    for (let sample = 0; sample < DEMO_ISSUE_LIMIT; sample += 1) {
      const started = performance.now()
      const response = await issue('SELLER', 'seller', `198.18.0.${String(sample + 1)}`)

      durations.push(performance.now() - started)
      expect(response.status).toBe(200)
      await response.text()
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})

describe('복제의 쿼리 수', () => {
  it('원본이 늘어도 읽기 쿼리 수가 늘지 않는다 (A5)', async () => {
    await bulkCatalogue(2, 'few')

    const few = await catalogueStatementsDuring(async () => {
      await (await issue('SELLER', 'seller', '198.18.1.1')).text()
    })

    await bulkCatalogue(DEMO_PRODUCT_COUNT * 3, 'many')

    const many = await catalogueStatementsDuring(async () => {
      await (await issue('SELLER', 'seller', '198.18.1.2')).text()
    })

    const selectsOf = (seen: readonly string[]): number =>
      seen.filter((statement) => statement.trimStart().toUpperCase().startsWith('SELECT')).length

    // Six reads whether there are two originals or twelve: the sources are read
    // one statement per table and grouped in memory.
    expect(selectsOf(few)).toBe(selectsOf(many))
    expect(selectsOf(many)).toBeLessThanOrEqual(8)
  })
})
