import type { ApiClient, Product } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import type { PoolClient } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for product writes, and the negative control that says why it is
 * needed.
 *
 * **What races here is not what races elsewhere.** No balance is being
 * decremented and no stock is being reserved — those arrive in TASK-0036 and
 * TASK-0048. What races is `Product.minPrice`, and it races because a product
 * write is not one statement: it rewrites variants and then **derives** the
 * cache from them (TASK-0032 4.6). Two transactions doing that at once each
 * compute the minimum from a snapshot containing only their own change.
 *
 * PostgreSQL's READ COMMITTED is what makes it more than a theoretical
 * ordering problem. When two commands update the same row, the second waits and
 * then re-evaluates its `WHERE` against the new row version — but the
 * **subquery in its `SET` clause keeps the snapshot it started with**. So the
 * losing writer does not simply overwrite with a stale value it could have
 * refreshed; it writes a minimum computed from a catalogue that no longer
 * exists, and no constraint objects, because "is this the real minimum" needs
 * an aggregate and a CHECK may not contain one (product-constraints.spec.ts
 * pins that down from the other side).
 *
 * `ProductService` takes `SELECT … FOR UPDATE` on the product **before** it
 * reads the version, which turns the pair into a queue; the optimistic
 * `version` then turns the queue into an answer the loser can act on. The
 * negative control below is the same flow with no product lock at all, run
 * against the same real tables.
 *
 * **Measured, not assumed.** Deleting `FOR UPDATE` from `ProductService` fails
 * 30 of this file's 40 soft assertions — and it is worth knowing *which* 30.
 * The cache assertion survives, because the `UPDATE "Product"` the service
 * issues a few lines later happens to take the same row lock; what collapses is
 * the optimistic lock, which by then has already been compared against a
 * version read from an unlocked snapshot. Both edits are accepted, neither
 * caller is told, and `version` rises by one for two saves. That is why the
 * lock is taken explicitly and **first**: a lock acquired incidentally,
 * halfway, protects the write and not the decision.
 *
 * The raw control shows the other half — what happens when nothing locks the
 * product at all, which is the shape any future write that only refreshes the
 * cache would have (a stock adjustment, a price import).
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/**
 * A slug nothing else in this run holds.
 *
 * A counter rather than a timestamp: `Date.now()` is banned in this package
 * (the clock is a port, `src/common/clock.ts`), and two categories created in
 * the same millisecond would collide anyway.
 */
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

/** A listing with two variants at the same price — the fixture a race needs. */
async function twoVariants(prefix: string): Promise<Product> {
  const { product } = await client().createProduct({
    categoryId,
    name: '오버사이즈 티셔츠',
    skuPrefix: prefix,
    options: [{ name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] }],
    variantDefaults: { price: 20_000, stock: 10 },
  })

  return product
}

/** The state a reader would see: the cache, and what it should have been. */
async function cacheOf(productId: string): Promise<{
  minPrice: number | null
  realMinimum: number | null
  version: number
}> {
  const row = await db.one<{
    minPrice: number | null
    realMinimum: number | null
    version: number
  }>(
    `SELECT p."minPrice", p."version",
            (SELECT min(v."price") FROM "ProductVariant" v
              WHERE v."productId" = p."id" AND v."deletedAt" IS NULL AND v."isActive") AS "realMinimum"
       FROM "Product" p WHERE p."id" = $1`,
    [productId],
  )

  return row
}

function statusOf(reason: unknown): number {
  return reason instanceof ApiClientError ? (reason.status ?? 0) : 0
}

describe('A7 — 동시 상품 수정', () => {
  it('lets exactly one of two concurrent edits win, and leaves the cache true', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const product = await twoVariants(`R${String(round)}`)

      // Two people editing one listing at the same time, each cutting the price
      // of a different colour. Nothing about the two edits conflicts as data —
      // they touch different variant rows — which is precisely why the cache
      // they share is where the damage would land.
      const results = await concurrently(2, (index) =>
        client().updateProduct(product.id, {
          version: product.version,
          variants: [
            {
              optionValues: [index === 0 ? '블랙' : '화이트'],
              price: index === 0 ? 10_000 : 5_000,
            },
          ],
        }),
      )

      const cache = await cacheOf(product.id)

      // `expect.soft` so that a broken implementation reports how many of the
      // forty observations it fails rather than stopping at the first round —
      // the number that says whether the lock is doing anything (TASK-0032 7.3).
      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results).map(statusOf)).toEqual([409])
      // The two the lock is really for: the cache agrees with the catalogue,
      // and exactly one edit was applied.
      expect.soft(cache.minPrice).toBe(cache.realMinimum)
      expect.soft(cache.version).toBe(1)
    }
  })

  it('lets the loser retry and end up with a true cache', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const product = await twoVariants(`Q${String(round)}`)

      await concurrently(2, (index) =>
        client().updateProduct(product.id, {
          version: product.version,
          variants: [
            {
              optionValues: [index === 0 ? '블랙' : '화이트'],
              price: index === 0 ? 10_000 : 5_000,
            },
          ],
        }),
      )

      // A 409 is not a dead end: reloading and reapplying is what the code tells
      // the caller to do, and it has to actually work.
      const { product: reloaded } = await client().getProduct(product.id)

      await client().updateProduct(product.id, {
        version: reloaded.version,
        variants: [{ optionValues: ['화이트'], price: 5_000 }],
      })

      const cache = await cacheOf(product.id)

      expect.soft(cache.minPrice).toBe(5_000)
      expect.soft(cache.realMinimum).toBe(5_000)
    }
  })

  it('lets exactly one of two concurrent creates hold a SKU', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const results = await concurrently(2, () =>
        client().createProduct({
          categoryId,
          name: '동시 등록',
          skuPrefix: `DUP${String(round)}`,
          variantDefaults: { price: 19_000 },
        }),
      )

      // This one the database wins on its own — `ProductVariant_seller_sku_key`
      // is a unique index, and check-then-insert is not involved. It is here to
      // separate the two kinds of rule: what an index can hold, and what only
      // the lock above can.
      expect(fulfilled(results)).toHaveLength(1)
      expect(rejected(results).map(statusOf)).toEqual([409])

      const [row] = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "ProductVariant"
          WHERE "sellerId" = $1 AND "sku" = $2 AND "deletedAt" IS NULL`,
        [seller.sellerId, `DUP${String(round)}-1`],
      )

      expect(row?.count).toBe(1)
    }
  })

  it('never lets a concurrent reader see two variants of one combination', async () => {
    const product = await twoVariants('READ')

    // Six readers against three writers. The invariant is not "the reader sees
    // the newest price" — it is that no read ever resolves one buyer selection
    // to two rows, which is what a duplicated combination would look like from
    // the outside.
    const results = await concurrently(9, async (index) => {
      if (index < 3) {
        return client()
          .updateProduct(product.id, {
            version: product.version,
            variants: [{ optionValues: ['블랙'], price: 9_000 + index }],
          })
          .then(
            () => null,
            () => null,
          )
      }

      const { product: read } = await client().getProduct(product.id)
      const signatures = read.variants.map((variant) =>
        [...variant.optionValueIds].sort().join('/'),
      )

      expect(new Set(signatures).size).toBe(signatures.length)
      return null
    })

    expect(rejected(results)).toEqual([])
  })
})

/**
 * The negative control: the same flow with the row lock removed.
 *
 * Written as raw SQL on two connections rather than by editing the service,
 * and against the **real** tables — unlike TASK-0028, which needed a
 * constraint-free fixture table because its shipped table could not be
 * corrupted. Here there is no constraint to remove: "minPrice is the real
 * minimum" is an aggregate over other rows, which a CHECK cannot state, so the
 * damage reproduces on the table that ships.
 *
 * The interleaving is not left to chance. Each step below is awaited in order,
 * which pins the exact sequence a lock-free implementation permits.
 */
describe('A7 — 음성 대조군 (락 없는 구현)', () => {
  /** Reads the version the way an optimistic-only implementation would. */
  async function readVersion(connection: PoolClient, productId: string): Promise<number> {
    const { rows } = await connection.query<{ version: number }>(
      'SELECT "version" FROM "Product" WHERE "id" = $1 AND "deletedAt" IS NULL',
      [productId],
    )

    return rows[0]?.version ?? 0
  }

  /** The cache refresh, exactly as the service writes it — minus the lock. */
  function refresh(connection: PoolClient, productId: string, version: number): Promise<unknown> {
    return connection.query(
      `UPDATE "Product" p
          SET "minPrice" = (SELECT min(v."price") FROM "ProductVariant" v
                             WHERE v."productId" = p."id"
                               AND v."deletedAt" IS NULL
                               AND v."isActive"),
              "version"  = $2
        WHERE p."id" = $1`,
      [productId, version],
    )
  }

  it('commits two edits, loses one of them, and leaves a price nobody can buy at', async () => {
    let corrupted = 0
    let lostUpdates = 0

    for (let round = 0; round < ROUNDS; round += 1) {
      const product = await twoVariants(`N${String(round)}`)
      const [black, white] = product.variants

      await db.withConnection(async (first) => {
        await db.withConnection(async (second) => {
          await first.query('BEGIN')
          await second.query('BEGIN')

          // Both read the same version and both believe they may proceed —
          // which is exactly what an optimistic lock alone promises.
          const seenByFirst = await readVersion(first, product.id)
          const seenBySecond = await readVersion(second, product.id)

          expect(seenByFirst).toBe(seenBySecond)

          await first.query('UPDATE "ProductVariant" SET "price" = 10000 WHERE "id" = $1', [
            black?.id,
          ])
          await second.query('UPDATE "ProductVariant" SET "price" = 5000 WHERE "id" = $1', [
            white?.id,
          ])

          // The second transaction refreshes first and takes the row lock.
          await refresh(second, product.id, seenBySecond + 1)

          // The first now starts its own refresh. It blocks on that row lock —
          // and the snapshot its subquery will use is taken **here**, before
          // the second commits.
          const blocked = refresh(first, product.id, seenByFirst + 1)

          await second.query('COMMIT')
          await blocked
          await first.query('COMMIT')
        })
      })

      const cache = await cacheOf(product.id)

      // Both prices really are in the table…
      expect(cache.realMinimum).toBe(5_000)
      // …but the cache says otherwise, and the version says only one edit ever
      // happened. Nothing failed, nothing was refused, and no constraint was
      // violated: the storefront simply advertises 10,000원 for a product whose
      // cheapest variant costs 5,000원, and the seller who cut that price sees
      // their `version` handed to somebody else.
      if (cache.minPrice !== cache.realMinimum) corrupted += 1
      if (cache.version === 1) lostUpdates += 1
    }

    expect(corrupted).toBe(ROUNDS)
    expect(lostUpdates).toBe(ROUNDS)
  })

  it('is the same fixture the locked implementation gets right', async () => {
    // The control and the real path differ in one thing. Run the service
    // against the identical fixture and the cache agrees with the catalogue
    // every time — the assertion the block above fails ten times out of ten.
    for (let round = 0; round < ROUNDS; round += 1) {
      const product = await twoVariants(`S${String(round)}`)

      await concurrently(2, (index) =>
        client()
          .updateProduct(product.id, {
            version: product.version,
            variants: [
              {
                optionValues: [index === 0 ? '블랙' : '화이트'],
                price: index === 0 ? 10_000 : 5_000,
              },
            ],
          })
          .then(
            () => null,
            () => null,
          ),
      )

      const cache = await cacheOf(product.id)

      expect.soft(cache.minPrice).toBe(cache.realMinimum)
    }
  })
})
