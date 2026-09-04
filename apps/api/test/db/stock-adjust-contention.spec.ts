import type { ApiClient, CreateProductRequest, StockAdjustResponse } from '@shopping/shared'
import type { PoolClient } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'

import { PrismaService } from '../../src/prisma/prisma.service.js'
import { StockService } from '../../src/stock/stock.service.js'
import { useApiApp } from '../support/api-app.js'
import { concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for the console's adjustment endpoint, and the control that says why
 * the request carries a **delta** (TASK-0115 완료 기준 F3).
 *
 * **What is new here.** TASK-0036 proved that `StockService` survives
 * concurrent movements, with two controls of its own. What this task added is a
 * **second caller** of that service — a person at a desk, arriving over HTTP,
 * while the order pipeline moves the same variant. So what is measured below is
 * the endpoint: real requests, through the real application, against the real
 * database, competing with movements recorded the way an order will record them.
 *
 * **Five at a time and not ten.** The harness sizes the pool at five on purpose
 * (`test/support/app-config.ts`), so five simultaneous requests is the largest
 * number where every one of them is actually in flight rather than queued
 * outside the database. A larger number would look like a stronger test and
 * measure less.
 *
 * **The interesting control is not about the lock.** TASK-0036 already showed
 * what happens when the row lock is removed. The failure *this* task could
 * introduce is a different one, and no lock prevents it: had the endpoint taken
 * an absolute level instead of a delta, a sale landing between the seller's
 * read and their save would be **erased** — and the ledger would stay perfectly
 * consistent while it happened, so reconciliation would report nothing.
 *
 * That control is sequenced with `await` rather than arranged with a `barrier`,
 * deliberately. `docs/HANDOFF.md` 5 names this exact shape: when the later
 * transaction *erases* the earlier one's effect, a barrier only guarantees that
 * both read before either writes — whichever commits second wins, and on the
 * runs where the absolute write commits first the control goes quietly green.
 * The damage here comes from the staleness of the number a **person** read, not
 * from an interleaving inside PostgreSQL, so the honest way to reproduce it is
 * to let the sale land in between and then look at what the save did with it.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** Repeat count for every scenario. A race that fails once in ten is not fixed. */
const ROUNDS = 10

let slugCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

function stock(): StockService {
  return api.resolve<StockService>(StockService)
}

function prisma(): PrismaService {
  return api.resolve<PrismaService>(PrismaService)
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

function sellerApi(): ApiClient {
  return api.clientAs(seller)
}

/** A listing with one variant, opening at `opening` units. */
async function listingOf(
  opening: number,
): Promise<{ readonly productId: string; readonly variantId: string }> {
  const request: CreateProductRequest = {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock: opening },
  }
  const { product } = await sellerApi().createProduct(request)

  return { productId: product.id, variantId: product.variants[0]?.id ?? '' }
}

async function variantOf(opening: number): Promise<string> {
  return (await listingOf(opening)).variantId
}

interface Audit {
  readonly stock: number
  readonly sum: number
  readonly entries: number
  readonly maxSeq: number
  readonly lastBalanceAfter: number
  readonly chainBreaks: number
  readonly negatives: number
}

/**
 * The four statements of `docs/design/erd.md` 3, plus a count of movements that
 * left the stock below zero.
 *
 * The same query shape TASK-0036's contention spec uses, because the properties
 * being checked are that task's — what changes is who caused the movements.
 */
async function auditOf(variantId: string): Promise<Audit> {
  return db.one<Audit>(
    `SELECT v."stock",
            COALESCE(l."sum", 0)              AS "sum",
            COALESCE(l."entries", 0)          AS "entries",
            COALESCE(l."maxSeq", 0)           AS "maxSeq",
            COALESCE(l."lastBalanceAfter", 0) AS "lastBalanceAfter",
            COALESCE(l."chainBreaks", 0)      AS "chainBreaks",
            COALESCE(l."negatives", 0)        AS "negatives"
       FROM "ProductVariant" v
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS "entries",
                COALESCE(sum(e."quantity"), 0)::int AS "sum",
                max(e."seq")::int AS "maxSeq",
                COALESCE(max(e."balanceAfter") FILTER (WHERE e."seq" = e."lastSeq"), 0)::int
                  AS "lastBalanceAfter",
                count(*) FILTER (WHERE e."balanceAfter" <> e."expected")::int AS "chainBreaks",
                count(*) FILTER (WHERE e."balanceAfter" < 0)::int AS "negatives"
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

/** The stock the console is showing its reader right now. */
async function displayedStock(productId: string, variantId: string): Promise<number> {
  const { variants } = await sellerApi().getSellerProductVariants(productId)

  return variants.find((variant) => variant.id === variantId)?.stock ?? -1
}

describe('A7 — 콘솔 조정과 판매가 동시에 일어난다', () => {
  it('F3 — settles one receipt and three sales on the arithmetic, every round', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(10)
      // One console request and three movements recorded the way an order will
      // record them — the two callers of the ledger this task put beside each
      // other.
      const results = await concurrently<number>(4, async (index) => {
        if (index === 0) {
          const answer = await sellerApi().adjustVariantStock(variantId, {
            delta: 5,
            type: 'INBOUND',
          })

          return answer.balanceAfter
        }

        return (await stock().adjust({ variantId, type: 'SALE', quantity: -1 })).balanceAfter
      })

      const audit = await auditOf(variantId)

      // `expect.soft` so a broken implementation reports how many of the
      // observations it fails rather than stopping at the first round.
      expect.soft(rejected(results)).toEqual([])
      expect.soft(audit.stock).toBe(12)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.lastBalanceAfter).toBe(audit.stock)
      // The opening movement plus four, at positions 1..5 with no gap — which
      // is what says every one of them passed through the row lock.
      expect.soft(audit.entries).toBe(5)
      expect.soft(audit.maxSeq).toBe(5)
      expect.soft(audit.chainBreaks).toBe(0)
      expect.soft(audit.negatives).toBe(0)
    }
  })

  it('lets exactly one of five simultaneous requests take the last unit', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(1)
      const results = await concurrently(5, () =>
        sellerApi().adjustVariantStock(variantId, { delta: -1, type: 'ADJUST', reason: '실사' }),
      )

      const audit = await auditOf(variantId)

      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results)).toHaveLength(4)
      expect.soft(audit.stock).toBe(0)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.entries).toBe(2)
      expect.soft(audit.negatives).toBe(0)
    }
  })

  it('never deducts more than there is, however many requests arrive', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const variantId = await variantOf(3)
      const results = await concurrently(5, () =>
        sellerApi().adjustVariantStock(variantId, { delta: -1, type: 'ADJUST', reason: '실사' }),
      )

      const audit = await auditOf(variantId)

      expect.soft(fulfilled(results)).toHaveLength(3)
      expect.soft(rejected(results)).toHaveLength(2)
      expect.soft(audit.stock).toBe(0)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.negatives).toBe(0)
    }
  })
})

describe('요청이 실제로 Variant 행 잠금을 지난다', () => {
  /** The backend serving one connection, so its wait state can be watched. */
  async function backendPidOf(connection: PoolClient): Promise<number> {
    const { rows } = await connection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')

    return rows[0]?.pid ?? 0
  }

  /**
   * Waits until some backend other than `holderPid` is blocked on a lock.
   *
   * `test/support/concurrently.ts`'s `awaitBlocked` wants the **waiting**
   * backend's own pid, which is knowable when the waiter is a connection the
   * spec opened. Here it is not: the request is served from Prisma's pool
   * inside the application and the spec has no handle on the connection it
   * borrowed. So the same observation is made from the other side — the
   * database is asked whether anybody is queuing on a lock in this database —
   * which is the form TASK-0036's own contention spec settled on, for the same
   * reason.
   */
  async function someoneBlocked(holderPid: number): Promise<boolean> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [row] = await db.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE "pid" <> $1 AND "wait_event_type" = 'Lock' AND "datname" = current_database()`,
        [holderPid],
      )

      if ((row?.waiting ?? 0) > 0) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return false
  }

  it('waits for a held variant and finishes when it is released', async () => {
    const variantId = await variantOf(10)

    await db.withConnection(async (holder) => {
      await holder.query('BEGIN')
      await holder.query('SELECT "id" FROM "ProductVariant" WHERE "id" = $1 FOR UPDATE', [
        variantId,
      ])

      // Caught where it is created. Left bare it becomes an unhandled rejection
      // during the turn between issuing it and awaiting it, and that only ever
      // shows up under CI timing (`docs/HANDOFF.md` 5).
      const pending = sellerApi()
        .adjustVariantStock(variantId, { delta: 5, type: 'INBOUND' })
        .then(
          (answer): StockAdjustResponse | Error => answer,
          (reason: unknown) => (reason instanceof Error ? reason : new Error(String(reason))),
        )

      const queued = await someoneBlocked(await backendPidOf(holder))

      // Without this the assertion below would pass on a run where the request
      // had already finished before the lock was ever contended.
      expect(queued).toBe(true)

      await holder.query('COMMIT')
      await expect(pending).resolves.toMatchObject({ seq: 2, balanceAfter: 15 })
    })
  })
})

/**
 * The control: an absolute level erases what sold, and nothing reports it.
 *
 * `StockService.setLevel` is the safest possible absolute write — it computes
 * the difference **under the variant's row lock** and records it as an
 * `ADJUST`, so the ledger's four statements all still hold afterwards. That is
 * exactly what makes it the right control: the corruption survives every check
 * this repository has, because it is not an inconsistency. It is the seller's
 * intention applied to a number that stopped being true while they were looking
 * at it.
 */
describe('음성 대조군 — 절대값 입력은 그 사이 팔린 것을 지운다', () => {
  it('loses the sale, with a ledger that still reconciles', async () => {
    let erased = 0
    let consistent = 0

    for (let round = 0; round < ROUNDS; round += 1) {
      const { productId, variantId } = await listingOf(12)
      // What the console showed the seller before they typed anything.
      const seen = await displayedStock(productId, variantId)
      const sold = await stock().adjust({ variantId, type: 'SALE', quantity: -3 })

      expect.soft(seen).toBe(12)
      expect.soft(sold.balanceAfter).toBe(9)

      // "재고를 17로" — the request this endpoint deliberately does not accept,
      // written here through the safest absolute path there is.
      await prisma().$transaction((tx) =>
        stock().setLevel(tx, { variantId, level: seen + 5, actorId: seller.userId }),
      )

      const audit = await auditOf(variantId)

      // 17, not 14. The three that sold have been paid for and shipped, and the
      // stock now says they are still on the shelf.
      if (audit.stock === 17) erased += 1
      if (audit.sum === audit.stock && audit.chainBreaks === 0) consistent += 1
    }

    expect(erased).toBe(ROUNDS)
    // The half that makes it dangerous: reconciliation is silent about it.
    expect(consistent).toBe(ROUNDS)
  })

  it('is the same sequence the delta endpoint gets right, every time', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { productId, variantId } = await listingOf(12)
      const seen = await displayedStock(productId, variantId)
      const sold = await stock().adjust({ variantId, type: 'SALE', quantity: -3 })

      expect.soft(seen).toBe(12)
      expect.soft(sold.balanceAfter).toBe(9)

      // "+5 입고" — the same intention, stated as a movement. One difference
      // from the block above, and the assertion it fails ten times out of ten
      // now holds ten times out of ten.
      await sellerApi().adjustVariantStock(variantId, { delta: 5, type: 'INBOUND' })

      const audit = await auditOf(variantId)

      expect.soft(audit.stock).toBe(14)
      expect.soft(audit.sum).toBe(audit.stock)
      expect.soft(audit.chainBreaks).toBe(0)
    }
  })
})
