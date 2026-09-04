import type { ApiClient, CreateProductRequest } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for SKU issuance (TASK-0113 6.2).
 *
 * **Why this task has an A7 at all.** The plan said it did not: no balance is
 * decremented and no stock is reserved, so the concurrency that matters belongs
 * to TASK-0036 and TASK-0115. That reading missed the row A7 actually names —
 * 순서·멱등 — and the bug this task fixes lives in it. The old default SKU
 * prefix was the top 32 bits of a UUIDv7 millisecond, so **every listing one
 * seller created inside the same 65 seconds asked for the same SKU**, and the
 * second was refused by `ProductVariant_seller_sku_key`. Two requests arriving
 * together are that situation at its sharpest.
 *
 * **Why a barrier is enough here, and `awaitBlocked` is not needed.** The trap
 * `docs/HANDOFF.md` 5 records is a race whose later transaction *erases* the
 * earlier one's effect — there a barrier only pins "both read before either
 * wrote", and the write phases can still run one after another while the spec
 * stays green for the wrong reason. This race has the opposite shape: two
 * inserts contend for one unique index, PostgreSQL serialises them itself, and
 * the loser gets a duplicate-key error rather than quietly winning. There is no
 * interleaving to arrange beyond starting them together.
 *
 * **What keeps it from being vacuous.** Two products created a minute apart
 * would pass the "different SKUs" assertion under the *old* rule too. So every
 * round also asserts that the two ids share their leading eight hex characters
 * — that is, that the pair really did land inside one 65-second window, which
 * is the only window where the old rule was wrong. And the control below runs
 * the old rule's effect directly, by naming one prefix explicitly for both.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let slugCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

/** Repeat count for every concurrent scenario. */
const ROUNDS = 10

let categoryId: number
let seller: TestCaller

beforeEach(async () => {
  const { category } = await api.clientAs(callers.operator).createCategory({
    parentId: null,
    name: '의류',
    slug: uniqueSlug('clothing'),
  })

  categoryId = category.id

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
})

function client(): ApiClient {
  return api.clientAs(seller)
}

function listing(overrides: Partial<CreateProductRequest> = {}): CreateProductRequest {
  return {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock: 10 },
    ...overrides,
  }
}

function statusOf(reason: unknown): number {
  return reason instanceof ApiClientError ? (reason.status ?? 0) : 0
}

function codeOf(reason: unknown): string {
  return reason instanceof ApiClientError ? (reason.body?.error.code ?? '') : ''
}

/** The eight hex characters the old rule used, and only those. */
function oldPrefix(productId: string): string {
  return productId.replaceAll('-', '').slice(0, 8)
}

describe('A7 — 한 판매자가 동시에 상품 둘을 등록한다', () => {
  it('issues both listings SKUs of their own', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const gate = barrier(2)
      const results = await concurrently(2, async (index) => {
        await gate.arrive()

        return client().createProduct(listing({ name: `동시 ${String(index)}` }))
      })

      const products = fulfilled(results).map((result) => result.product)

      // Both succeed. Under the old rule exactly one of them did.
      expect.soft(products).toHaveLength(2)
      expect.soft(rejected(results)).toHaveLength(0)

      const [first, second] = products

      // The assertion that stops this from passing for the wrong reason: the
      // two ids agree on the eight characters the old prefix was made of, so
      // the pair is inside the one window where that rule collided.
      expect.soft(oldPrefix(first?.id ?? 'a')).toBe(oldPrefix(second?.id ?? 'b'))
      expect.soft(first?.variants[0]?.sku).not.toBe(second?.variants[0]?.sku)
    }
  })

  it('still refuses two listings that ask for the same prefix by name', async () => {
    // The negative control, and it is the old rule's behaviour exactly: name one
    // prefix for both and the two first variants want the same SKU. Exactly one
    // gets it, the other is told why, and no listing is left half-written.
    for (let round = 0; round < ROUNDS; round += 1) {
      const gate = barrier(2)
      const results = await concurrently(2, async () => {
        await gate.arrive()

        return client().createProduct(listing({ skuPrefix: `SAME${String(round)}` }))
      })

      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results).map(statusOf)).toEqual([409])
      expect.soft(rejected(results).map(codeOf)).toEqual(['PRODUCT_SKU_TAKEN'])

      const [row] = await db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM "ProductVariant"
          WHERE "sellerId" = $1 AND "sku" = $2 AND "deletedAt" IS NULL`,
        [seller.sellerId, `SAME${String(round)}-1`],
      )

      // One live SKU, decided by the index rather than by a check-then-insert
      // that both callers would have passed.
      expect.soft(row?.total).toBe(1)
    }
  })
})

describe('A7 — 같은 상품을 동시에 발행한다', () => {
  it('lets one publish win and tells the other to reload', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { product } = await client().createProduct(
        listing({ skuPrefix: `PUB${String(round)}` }),
      )
      const gate = barrier(2)
      const results = await concurrently(2, async () => {
        await gate.arrive()

        return client().publishProduct(product.id, { version: product.version })
      })

      // Publishing routes through `update`, so it inherits the product row lock
      // and the optimistic version — this is what proves the new endpoint did
      // not open a path around either.
      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results).map(codeOf)).toEqual(['PRODUCT_VERSION_CONFLICT'])

      const [row] = await db.query<{ status: string; version: number }>(
        `SELECT "status"::text AS status, "version" FROM "Product" WHERE "id" = $1`,
        [product.id],
      )

      expect.soft(row?.status).toBe('ACTIVE')
      // Two accepted publishes would show up here as +2, with one of the
      // callers never told that anything happened.
      expect.soft(row?.version).toBe(1)
    }
  })
})
