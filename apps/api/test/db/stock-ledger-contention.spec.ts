import type { PoolClient } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'

import { StockService } from '../../src/stock/stock.service.js'
import { useApiApp } from '../support/api-app.js'
import type { Barrier } from '../support/concurrently.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createStock, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for stock, and the two negative controls that say why the design is
 * shaped this way.
 *
 * **What races.** One variant's `stock`, and three decisions taken from it:
 * whether there is enough, which position the movement takes, and what the
 * balance is afterwards. All three are read from rows, and the ledger's promise
 * — that the current quantity is the sum of its movements — is a statement no
 * CHECK can make, because it needs an aggregate (TASK-0036 4.12).
 *
 * **`ProductVariant_stock_check` does not help here.** Two decrements of one
 * unit from a stock of one, interleaved, both write `0`; `0 >= 0` and the
 * constraint is silent. The damage is not a negative number, it is two units
 * sold from one — visible only by comparing the level against the ledger.
 *
 * **Two controls, because they answer different questions.**
 *
 * - `TestLedgerNaive` (fixture) is the ledger most implementations write: a
 *   global id, an appended row, a `stock` column updated beside it. Without the
 *   row lock it corrupts every single time, and with the lock — same table, same
 *   flow — it does not. That is what the lock buys.
 * - The **shipped** tables, with the lock removed, answer the other half: what
 *   the `(variantId, seq)` primary key adds on top. The corruption becomes a
 *   refusal, which is a better failure and still not an acceptable one.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** Repeat count for every concurrent scenario. */
const ROUNDS = 10

let slugCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

/**
 * A SKU prefix nothing else in this run holds.
 *
 * Spelled out rather than left to `ProductService`'s default, which derives it
 * from the product's UUIDv7 time prefix — two listings by one seller inside the
 * same minute would then generate the same SKU and the second create would 409
 * on `ProductVariant_seller_sku_key`. These specs make listings in a loop.
 */
let skuCounter = 0

function uniqueSkuPrefix(): string {
  skuCounter += 1
  return `SKU${String(process.env.VITEST_POOL_ID ?? '1')}X${String(skuCounter)}`
}

function stock(): StockService {
  return api.resolve<StockService>(StockService)
}

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

/** A listing with one variant, opening at `opening` units. */
async function variantOf(opening: number): Promise<string> {
  const { product } = await api.clientAs(seller).createProduct({
    categoryId,
    name: '오버사이즈 티셔츠',
    skuPrefix: uniqueSkuPrefix(),
    variantDefaults: { price: 19_000, stock: opening },
  })

  return product.variants[0]?.id ?? ''
}

interface Audit {
  readonly stock: number
  readonly sum: number
  readonly entries: number
  readonly maxSeq: number
  readonly lastBalanceAfter: number
  readonly chainBreaks: number
}

async function auditOf(variantId: string): Promise<Audit> {
  return db.one<Audit>(
    `SELECT v."stock",
            COALESCE(l."sum", 0)              AS "sum",
            COALESCE(l."entries", 0)          AS "entries",
            COALESCE(l."maxSeq", 0)           AS "maxSeq",
            COALESCE(l."lastBalanceAfter", 0) AS "lastBalanceAfter",
            COALESCE(l."chainBreaks", 0)      AS "chainBreaks"
       FROM "ProductVariant" v
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS "entries",
                COALESCE(sum(e."quantity"), 0)::int AS "sum",
                max(e."seq")::int AS "maxSeq",
                COALESCE(max(e."balanceAfter") FILTER (WHERE e."seq" = e."lastSeq"), 0)::int
                  AS "lastBalanceAfter",
                count(*) FILTER (WHERE e."balanceAfter" <> e."expected")::int AS "chainBreaks"
           FROM (SELECT s."seq", s."quantity", s."balanceAfter",
                        COALESCE(lag(s."balanceAfter") OVER (ORDER BY s."seq"), 0) + s."quantity"
                          AS "expected",
                        max(s."seq") OVER () AS "lastSeq"
                   FROM "StockLedger" s WHERE s."variantId" = v."id") e
       ) l ON TRUE
      WHERE v."id" = $1`,
    [variantId],
  )
}

function statusOf(reason: unknown): number {
  return typeof reason === 'object' && reason !== null && 'getStatus' in reason
    ? (reason as { getStatus: () => number }).getStatus()
    : 0
}

describe('A7 — 동시 재고 변경', () => {
  it('F4 — lets exactly one of ten simultaneous sales take the last unit', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(1)
      const results = await concurrently(10, () =>
        stock().adjust({ variantId, type: 'SALE', quantity: -1 }),
      )

      const audit = await auditOf(variantId)

      // `expect.soft` so that a broken implementation reports how many of the
      // observations it fails rather than stopping at the first round — the
      // number that says whether the lock is doing anything (TASK-0036 7.3).
      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results).map(statusOf)).toEqual(Array.from({ length: 9 }, () => 409))
      // The four statements. L1 is the one an unlocked implementation breaks.
      expect.soft(audit.stock).toBe(0)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.chainBreaks).toBe(0)
      expect.soft(audit.lastBalanceAfter).toBe(audit.stock)
      expect.soft(audit.maxSeq).toBe(audit.entries)
      // The opening movement plus exactly one sale.
      expect.soft(audit.entries).toBe(2)
    }
  })

  it('F4b — settles a receipt and three sales at once on the arithmetic', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(10)
      const results = await concurrently(4, (index) =>
        index === 0
          ? stock().adjust({ variantId, type: 'INBOUND', quantity: 5 })
          : stock().adjust({ variantId, type: 'SALE', quantity: -1 }),
      )

      const audit = await auditOf(variantId)

      expect.soft(rejected(results)).toEqual([])
      expect.soft(audit.stock).toBe(12)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.lastBalanceAfter).toBe(audit.stock)
      // Opening plus four movements, at positions 1..5 with no gap — which is
      // what says every one of them passed through the lock.
      expect.soft(audit.entries).toBe(5)
      expect.soft(audit.maxSeq).toBe(5)
      expect.soft(audit.chainBreaks).toBe(0)
    }
  })

  it('F4b — never oversells when more sales arrive than there is stock', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(4)
      const results = await concurrently(9, () =>
        stock().adjust({ variantId, type: 'SALE', quantity: -1 }),
      )

      const audit = await auditOf(variantId)

      expect.soft(fulfilled(results)).toHaveLength(4)
      expect.soft(rejected(results)).toHaveLength(5)
      expect.soft(audit.stock).toBe(0)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.entries).toBe(5)
    }
  })
})

describe('F4c — 다른 Variant 는 경합하지 않는다', () => {
  /** The backend serving one connection, so its wait state can be watched. */
  async function backendPidOf(connection: PoolClient): Promise<number> {
    const { rows } = await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')

    return rows[0]?.pid ?? 0
  }

  /** Waits until `pid` is actually blocked on a lock, or gives up. */
  async function blocked(pid: number): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await db.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE "pid" = $1 AND "wait_event_type" = 'Lock'`,
        [pid],
      )

      if ((row?.waiting ?? 0) > 0) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return false
  }

  it('serves a movement on another variant while one variant is held', async () => {
    const held = await variantOf(10)
    const other = await variantOf(10)

    await db.withConnection(async (holder) => {
      await holder.query('BEGIN')
      await holder.query('SELECT "id" FROM "ProductVariant" WHERE "id" = $1 FOR UPDATE', [held])

      // Nothing to wait for: a different row, a different lock. If the service
      // serialised on anything wider than the variant — a table lock, an
      // advisory lock on the catalogue — this would sit here until the holder
      // committed and the transaction timed out.
      const entry = await stock().adjust({ variantId: other, type: 'SALE', quantity: -1 })

      expect(entry).toMatchObject({ seq: 2, balanceAfter: 9 })

      await holder.query('COMMIT')
    })
  })

  it('does wait for the same variant, and finishes when it is released', async () => {
    const held = await variantOf(10)

    await db.withConnection(async (holder) => {
      await holder.query('BEGIN')
      await holder.query('SELECT "id" FROM "ProductVariant" WHERE "id" = $1 FOR UPDATE', [held])

      const pending = stock().adjust({ variantId: held, type: 'SALE', quantity: -1 })
      // The other half of the claim above: the lock really is taken, so this is
      // a queue and not an absence of one.
      const waited = await waitedForLock(holder)

      expect(waited).toBe(true)

      await holder.query('COMMIT')
      await expect(pending).resolves.toMatchObject({ seq: 2, balanceAfter: 9 })
    })
  })

  /** Whether some backend other than `holder` is blocked on a lock. */
  async function waitedForLock(holder: PoolClient): Promise<boolean> {
    const holderPid = await backendPidOf(holder)

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await db.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE "pid" <> $1 AND "wait_event_type" = 'Lock' AND "datname" = current_database()`,
        [holderPid],
      )

      if ((row?.waiting ?? 0) > 0) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return blocked(holderPid)
  }
})

/**
 * The control that shows what the row lock prevents.
 *
 * The ledger most implementations write — a global id, an appended row, a
 * `stock` column beside it — run twice against the same fixture table: once
 * without a lock and once with one. The interleaving is arranged by a barrier
 * rather than hoped for, so the failure is a fact and not a coincidence
 * (TASK-0032's control failed 8 of 10 in CI when its interleaving was a hope).
 */
describe('음성 대조군 ① — 자리 없는 원장, 잠금 없음', () => {
  let variant = ''

  beforeEach(async () => {
    const row = await createStock(db, { stock: 1 })

    variant = row.variant
  })

  /** Read, decide, write, append. No lock anywhere. */
  async function sellNaively(gate: Barrier): Promise<boolean> {
    return db.withConnection(async (client) => {
      await client.query('BEGIN')

      const { rows } = await client.query<{ stock: number }>(
        'SELECT "stock" FROM "TestStock" WHERE "variant" = $1',
        [variant],
      )
      const seen = rows[0]?.stock ?? 0

      // Read-then-write: the value below is stale by the time it is used.
      await gate.arrive()

      if (seen < 1) {
        await client.query('ROLLBACK')
        return false
      }

      await client.query('UPDATE "TestStock" SET "stock" = $2 WHERE "variant" = $1', [
        variant,
        seen - 1,
      ])
      await client.query(
        'INSERT INTO "TestLedgerNaive" ("variant", "quantity", "balanceAfter") VALUES ($1, -1, $2)',
        [variant, seen - 1],
      )
      await client.query('COMMIT')
      return true
    })
  }

  /** The same flow with the row locked first — the only difference. */
  async function sellSafely(): Promise<boolean> {
    return db.withConnection(async (client) => {
      await client.query('BEGIN')

      const { rows } = await client.query<{ stock: number }>(
        'SELECT "stock" FROM "TestStock" WHERE "variant" = $1 FOR UPDATE',
        [variant],
      )
      const seen = rows[0]?.stock ?? 0

      if (seen < 1) {
        await client.query('ROLLBACK')
        return false
      }

      await client.query('UPDATE "TestStock" SET "stock" = $2 WHERE "variant" = $1', [
        variant,
        seen - 1,
      ])
      await client.query(
        'INSERT INTO "TestLedgerNaive" ("variant", "quantity", "balanceAfter") VALUES ($1, -1, $2)',
        [variant, seen - 1],
      )
      await client.query('COMMIT')
      return true
    })
  }

  async function ledgerOf(): Promise<{ stock: number; sum: number; entries: number }> {
    return db.one(
      `SELECT s."stock",
              COALESCE(sum(l."quantity"), 0)::int AS "sum",
              count(l.*)::int                     AS "entries"
         FROM "TestStock" s
         LEFT JOIN "TestLedgerNaive" l ON l."variant" = s."variant"
        WHERE s."variant" = $1
        GROUP BY s."stock"`,
      [variant],
    )
  }

  it('records two sales of one unit and leaves the stock disagreeing with them', async () => {
    let corrupted = 0
    let oversold = 0

    for (let round = 0; round < ROUNDS; round += 1) {
      await db.execute('TRUNCATE "TestStock", "TestLedgerNaive" RESTART IDENTITY')

      const row = await createStock(db, { stock: 1 })

      variant = row.variant

      const gate = barrier(2)

      await concurrently(2, () => sellNaively(gate))

      const state = await ledgerOf()

      // The damage is not a negative number — `stock` is 0, which no constraint
      // objects to. It is that the ledger says two units left and the level says
      // one did, so "재고가 왜 줄었나" now has two incompatible answers.
      if (state.stock !== 1 + state.sum) corrupted += 1
      if (state.entries === 2) oversold += 1
    }

    expect(corrupted).toBe(ROUNDS)
    expect(oversold).toBe(ROUNDS)
  })

  it('is the same fixture the locked flow gets right, every time', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await db.execute('TRUNCATE "TestStock", "TestLedgerNaive" RESTART IDENTITY')

      const row = await createStock(db, { stock: 1 })

      variant = row.variant

      const results = await concurrently(2, () => sellSafely())
      const state = await ledgerOf()

      // One difference — `FOR UPDATE` — and the assertion the block above fails
      // ten times out of ten now holds ten times out of ten.
      expect.soft(fulfilled(results).filter(Boolean)).toHaveLength(1)
      expect.soft(state.stock).toBe(1 + state.sum)
      expect.soft(state.entries).toBe(1)
    }
  })
})

/**
 * The control on the **shipped** tables, with the lock removed.
 *
 * Same flow as `StockService.apply` — read the level and the last position,
 * decide, write the level, append the movement — minus `SELECT … FOR UPDATE`.
 * What comes out is not the corruption above: `(variantId, seq)` is the primary
 * key and both callers computed the same position, so the loser collides with
 * it instead.
 *
 * That is worth knowing precisely. The key turns a silent lost update into a
 * refusal — a better failure, and still the wrong one: the caller is told a
 * database key was violated rather than that the stock ran out, and on a busy
 * variant every concurrent movement becomes a coin toss between the two. The
 * lock is what makes the answer honest, which is the same conclusion TASK-0032
 * reached from the other side (its cache survived the missing lock; its
 * conflict reporting did not).
 */
describe('음성 대조군 ② — 실제 테이블, 잠금만 제거', () => {
  /** `StockService.apply` with the lock taken out, and nothing else changed. */
  async function sellUnlocked(
    variantId: string,
    gate: Barrier,
  ): Promise<'recorded' | 'refused' | 'collided'> {
    return db.withConnection(async (client) => {
      await client.query('BEGIN')
      try {
        const { rows } = await client.query<{ stock: number; lastSeq: number }>(
          `SELECT v."stock",
                  COALESCE((SELECT max(l."seq") FROM "StockLedger" l
                             WHERE l."variantId" = v."id"), 0)::int AS "lastSeq"
             FROM "ProductVariant" v WHERE v."id" = $1`,
          [variantId],
        )
        const state = rows[0] ?? { stock: 0, lastSeq: 0 }
        const balance = state.stock - 1

        // Every caller reads before any caller writes. Without this the overlap
        // is a hope rather than a fact, and a run in which the two never met
        // would report "no corruption" for the wrong reason (TASK-0032 9장).
        await gate.arrive()

        if (balance < 0) {
          await client.query('ROLLBACK')
          return 'refused'
        }

        await client.query('UPDATE "ProductVariant" SET "stock" = $2 WHERE "id" = $1', [
          variantId,
          balance,
        ])
        await client.query(
          `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter")
           VALUES ($1, $2, 'SALE', -1, $3)`,
          [variantId, state.lastSeq + 1, balance],
        )
        await client.query('COMMIT')
        return 'recorded'
      } catch {
        await client.query('ROLLBACK')
        return 'collided'
      }
    })
  }

  it('collides on the position instead of overselling', async () => {
    let recorded = 0
    let collided = 0
    let sound = 0

    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(1)
      const gate = barrier(2)
      const results = fulfilled(await concurrently(2, () => sellUnlocked(variantId, gate)))

      recorded += results.filter((result) => result === 'recorded').length
      collided += results.filter((result) => result === 'collided').length

      const audit = await auditOf(variantId)

      if (audit.sum === audit.stock && audit.maxSeq === audit.entries) sound += 1
    }

    // Exactly one movement per round is recorded and the other is thrown out by
    // the primary key — never two, which is what an unguarded ledger allows
    // (control ① above).
    expect(recorded).toBe(ROUNDS)
    expect(collided).toBe(ROUNDS)
    // The ledger still explains the stock: the design absorbed the missing lock.
    expect(sound).toBe(ROUNDS)
  })
})
