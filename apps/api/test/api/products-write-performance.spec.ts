import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient, CreateProductRequest, Product } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createCategory, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * Gates A1 and A5 for the two writes this task added (TASK-0113).
 *
 * `products-performance.spec.ts` already measures the list, the detail read and
 * the twelve-variant create that TASK-0032 built. What is new here is
 * publishing, and it is worth measuring separately because it does more than it
 * looks like it does: it takes the product row lock, reloads the category's
 * attribute definitions, validates the whole bag against them, replans the
 * variants and re-derives `minPrice`. A p95 taken on `create` says nothing about
 * that path.
 *
 * The statements are counted at the source — a **real** `PrismaClient` against
 * the same worker database with query logging on. Nothing is mocked (gate A6).
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

function gallery(count: number): { url: string }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    url: `https://images.unsplash.com/photo-${String(index)}.jpg`,
  }))
}

async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...statements]
}

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

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

describe('the detail read stays a fixed number of statements with a gallery (A5)', () => {
  it('costs the same for one image and for ten', async () => {
    const { product: small } = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'IMG1', images: gallery(1) }),
    )
    const { product: large } = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'IMG10', images: gallery(10) }),
    )

    const few = await statementsDuring(() => client().getProduct(small.id))
    const many = await statementsDuring(() => client().getProduct(large.id))

    // The gallery is a nested collection like the variants are, so it is the
    // second place an `include` in a loop would hide.
    expect(catalogueStatements(many)).toHaveLength(catalogueStatements(few).length)
  })
})

describe('publishing costs a fixed number of statements (A5)', () => {
  it('costs the same for one variant and for twelve', async () => {
    const single = await client().createProduct(request({ skuPrefix: 'PS1' }))
    const dozen = await client().createProduct(
      request({ options: COLOUR_AND_SIZE, skuPrefix: 'PS12' }),
    )

    const one = await statementsDuring(() =>
      client().publishProduct(single.product.id, { version: single.product.version }),
    )
    const twelve = await statementsDuring(() =>
      client().publishProduct(dozen.product.id, { version: dozen.product.version }),
    )

    // Publishing replans the variants, and a plan that asked the database per
    // combination would show up here as twelve extra statements while every
    // functional test stayed green.
    expect(catalogueStatements(twelve)).toHaveLength(catalogueStatements(one).length)
  })
})

describe('response time (A1)', () => {
  it('saves a twelve-variant listing with a gallery well inside 300ms at p95', async () => {
    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 30; index += 1) {
      const started = performance.now()

      await caller.createProduct(
        request({
          options: COLOUR_AND_SIZE,
          images: gallery(5),
          skuPrefix: `W${String(index)}`,
        }),
      )
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('publishes a twelve-variant listing well inside 300ms at p95', async () => {
    const products: Product[] = []
    const caller = client()

    for (let index = 0; index < 30; index += 1) {
      const { product } = await caller.createProduct(
        request({ options: COLOUR_AND_SIZE, skuPrefix: `PB${String(index)}` }),
      )

      products.push(product)
    }

    const durations: number[] = []

    for (const product of products) {
      const started = performance.now()

      await caller.publishProduct(product.id, { version: product.version })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})
