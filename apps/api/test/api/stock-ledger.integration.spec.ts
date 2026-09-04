import { randomUUID } from 'node:crypto'

import type { ApiClient, StockLedgerType } from '@shopping/shared'
import { ApiClientError, stockLedgerResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { StockDiscrepancy } from '../../src/stock/stock.service.js'
import { StockService } from '../../src/stock/stock.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * The stock ledger end to end, against this worker's real database.
 *
 * The service is resolved from the running application rather than constructed
 * here: recording a movement has no endpoint of its own yet — the console route
 * that calls it belongs to TASK-0115 — and the thing under test is the service
 * plus the database, not a controller (QUALITY-GATES Q5, "엔드포인트 없이
 * 서비스만 만드는 TASK 가 어떤 커버리지 기준도 받지 않는다").
 *
 * The read path does go over HTTP, through `createApiClient`, so gate C3 holds
 * structurally: a renamed or missing field fails as `malformed_response`
 * whether or not an assertion mentions it.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

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

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
  }
}

/** The status a service refusal reached, and the fields it named. */
async function refusal(work: Promise<unknown>): Promise<{
  status: number
  fields: readonly string[]
}> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (error === null || typeof error !== 'object' || !('getStatus' in error)) {
    throw new Error(`거부를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const exception = error as { getStatus: () => number; getResponse: () => unknown }
  const payload = exception.getResponse()
  const message =
    typeof payload === 'object' && payload !== null && 'message' in payload ? payload.message : []

  return {
    status: exception.getStatus(),
    fields: (Array.isArray(message) ? message : [])
      .filter(
        (entry): entry is { field: string } =>
          typeof entry === 'object' && entry !== null && 'field' in entry,
      )
      .map((entry) => entry.field),
  }
}

let categoryId: number
let seller: TestCaller
let rival: TestCaller

beforeEach(async () => {
  const { category } = await api.clientAs(callers.operator).createCategory({
    parentId: null,
    name: '의류',
    slug: uniqueSlug('clothing'),
  })

  categoryId = category.id
  seller = await storefront()
  rival = await storefront()
})

async function storefront(): Promise<TestCaller> {
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  return { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
}

function client(caller: TestCaller = seller): ApiClient {
  return api.clientAs(caller)
}

/** A listing with one variant, opening at `stock` units. */
async function variantOf(opening: number, caller: TestCaller = seller): Promise<string> {
  const { product } = await client(caller).createProduct({
    categoryId,
    name: '오버사이즈 티셔츠',
    skuPrefix: uniqueSkuPrefix(),
    variantDefaults: { price: 19_000, stock: opening },
  })

  return product.variants[0]?.id ?? ''
}

/** The current stock, read straight from the table. */
async function stockOf(variantId: string): Promise<number> {
  const row = await db.one<{ stock: number }>(
    `SELECT "stock" FROM "ProductVariant" WHERE "id" = $1`,
    [variantId],
  )

  return row.stock
}

/** The four statements of TASK-0036 4.1, evaluated for one variant. */
async function auditOf(variantId: string): Promise<{
  stock: number
  sum: number
  entries: number
  maxSeq: number
  lastBalanceAfter: number
  chainBreaks: number
}> {
  return db.one(
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

/** Asserts L1 to L4 hold for one variant. */
async function expectSound(variantId: string): Promise<void> {
  const audit = await auditOf(variantId)

  expect(audit.sum).toBe(audit.stock) // L1
  expect(audit.chainBreaks).toBe(0) // L2
  expect(audit.lastBalanceAfter).toBe(audit.stock) // L3
  expect(audit.maxSeq).toBe(audit.entries) // L4
}

describe('F1 — 기록', () => {
  it('records an inbound movement and moves the stock to its balance', async () => {
    const variantId = await variantOf(0)

    const entry = await stock().adjust({
      variantId,
      type: 'INBOUND',
      quantity: 5,
      actorId: seller.userId,
    })

    expect(entry).toMatchObject({ seq: 1, type: 'INBOUND', quantity: 5, balanceAfter: 5 })
    expect(entry.actorId).toBe(seller.userId)
    expect(await stockOf(variantId)).toBe(5)
    await expectSound(variantId)
  })

  it('numbers each movement one past the last, with the balance it produced', async () => {
    const variantId = await variantOf(10)

    await stock().adjust({ variantId, type: 'SALE', quantity: -3 })
    const third = await stock().adjust({ variantId, type: 'RETURN_IN', quantity: 1 })

    // Position 1 is the opening balance the listing was created with.
    expect(third).toMatchObject({ seq: 3, balanceAfter: 8 })
    expect(await stockOf(variantId)).toBe(8)
  })

  it('refuses a movement whose sign disagrees with its type', async () => {
    const variantId = await variantOf(10)

    expect(await refusal(stock().adjust({ variantId, type: 'SALE', quantity: 2 }))).toEqual({
      status: 400,
      fields: ['quantity'],
    })
  })

  it('refuses an adjustment with no reason', async () => {
    const variantId = await variantOf(10)

    expect(await refusal(stock().adjust({ variantId, type: 'ADJUST', quantity: 2 }))).toEqual({
      status: 400,
      fields: ['reason'],
    })
  })

  it('answers 404 for a variant that does not exist', async () => {
    const outcome = await refusal(
      stock().adjust({ variantId: randomUUID(), type: 'INBOUND', quantity: 1 }),
    )

    expect(outcome.status).toBe(404)
  })
})

describe('F2 — 정합성', () => {
  it('keeps the ledger explaining the stock across twenty arbitrary movements', async () => {
    const variantId = await variantOf(50)
    // Deterministic rather than random: a spec that fails on some seeds and not
    // others reports the seed, not the bug.
    const script: readonly (readonly [StockLedgerType, number])[] = [
      ['SALE', -3],
      ['INBOUND', 12],
      ['SALE', -7],
      ['RETURN_IN', 2],
      ['ADJUST', -4],
      ['RESERVE_CONFIRM', -1],
      ['CANCEL', 5],
      ['SALE', -9],
      ['INBOUND', 30],
      ['ADJUST', 6],
      ['SALE', -11],
      ['RETURN_IN', 1],
      ['SALE', -2],
      ['CANCEL', 2],
      ['INBOUND', 8],
      ['ADJUST', -5],
      ['SALE', -13],
      ['RESERVE_CONFIRM', -4],
      ['RETURN_IN', 3],
      ['INBOUND', 1],
    ]

    let expected = 50

    for (const [type, quantity] of script) {
      const entry = await stock().adjust({
        variantId,
        type,
        quantity,
        ...(type === 'ADJUST' ? { reason: '실사 조정' } : {}),
      })

      expected += quantity
      expect(entry.balanceAfter).toBe(expected)
    }

    const audit = await auditOf(variantId)

    expect(audit.stock).toBe(expected)
    expect(audit.entries).toBe(script.length + 1)
    await expectSound(variantId)
    expect(await stock().reconcile()).toEqual([])
  })
})

describe('F3 — 음수 방지', () => {
  it('refuses a movement that would take the stock below zero', async () => {
    const variantId = await variantOf(3)

    expect(await refusal(stock().adjust({ variantId, type: 'SALE', quantity: -4 }))).toEqual({
      status: 409,
      fields: ['quantity'],
    })
  })

  it('leaves both the stock and the ledger untouched', async () => {
    const variantId = await variantOf(3)

    await refusal(stock().adjust({ variantId, type: 'SALE', quantity: -4 }))

    const audit = await auditOf(variantId)

    expect(audit.stock).toBe(3)
    // Only the opening movement. A refused movement leaves no row, so the
    // positions stay contiguous and the next real one takes seq 2.
    expect(audit.entries).toBe(1)
    await expectSound(variantId)
  })

  it('lets the stock reach exactly zero', async () => {
    const variantId = await variantOf(3)

    const entry = await stock().adjust({ variantId, type: 'SALE', quantity: -3 })

    expect(entry.balanceAfter).toBe(0)
    await expectSound(variantId)
  })
})

describe('F6 — 트랜잭션', () => {
  it('rolls the stock back when the ledger write fails', async () => {
    const variantId = await variantOf(10)

    // The stock is written before the ledger row, so a refused row has to take
    // the level with it. An actor who does not exist makes the INSERT fail on
    // its foreign key — a failure the service does not anticipate, which is the
    // point: the transaction is what guarantees this, not a catch block.
    const error: unknown = await stock()
      .adjust({ variantId, type: 'SALE', quantity: -4, actorId: randomUUID() })
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect(error).not.toBeNull()
    expect(await stockOf(variantId)).toBe(10)

    const audit = await auditOf(variantId)

    expect(audit.entries).toBe(1)
    await expectSound(variantId)
  })
})

describe('F7 — 멱등', () => {
  it('refuses the same movement recorded twice', async () => {
    const variantId = await variantOf(10)
    const refId = randomUUID()

    await stock().adjust({
      variantId,
      type: 'SALE',
      quantity: -2,
      refType: 'ORDER_ITEM',
      refId,
    })

    expect(
      await refusal(
        stock().adjust({ variantId, type: 'SALE', quantity: -2, refType: 'ORDER_ITEM', refId }),
      ),
    ).toEqual({ status: 409, fields: ['refId'] })
  })

  it('leaves the stock where the first recording left it', async () => {
    const variantId = await variantOf(10)
    const refId = randomUUID()
    const movement = {
      variantId,
      type: 'SALE' as const,
      quantity: -2,
      refType: 'ORDER_ITEM' as const,
      refId,
    }

    await stock().adjust(movement)
    await refusal(stock().adjust(movement))

    expect(await stockOf(variantId)).toBe(8)
    await expectSound(variantId)
  })

  it('still admits a different movement for the same reference', async () => {
    const variantId = await variantOf(10)
    const refId = randomUUID()

    await stock().adjust({ variantId, type: 'SALE', quantity: -2, refType: 'ORDER_ITEM', refId })
    await stock().adjust({ variantId, type: 'CANCEL', quantity: 2, refType: 'ORDER_ITEM', refId })

    expect(await stockOf(variantId)).toBe(10)
    await expectSound(variantId)
  })

  it('refuses half a reference before it reaches the database', async () => {
    const variantId = await variantOf(10)

    expect(
      await refusal(
        stock().adjust({ variantId, type: 'SALE', quantity: -1, refType: 'ORDER_ITEM' }),
      ),
    ).toEqual({ status: 400, fields: ['refId'] })
  })
})

describe('F9 — 재고를 움직이는 모든 경로가 원장을 지난다', () => {
  it('records the opening balance a listing is created with', async () => {
    const variantId = await variantOf(7)

    const { entries, variant } = await client().getVariantLedger(variantId)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ seq: 1, type: 'INBOUND', quantity: 7, balanceAfter: 7 })
    expect(variant.stock).toBe(7)
    expect(variant.ledgerBalance).toBe(7)
  })

  it('writes no movement for a variant that opens at zero', async () => {
    // A movement of nothing is not a movement; an empty ledger with stock 0 is
    // consistent, which `expectSound` checks.
    const variantId = await variantOf(0)

    expect((await client().getVariantLedger(variantId)).entries).toEqual([])
    await expectSound(variantId)
  })

  it('records the opening balance of a variant an added choice created', async () => {
    const { product } = await client().createProduct({
      categoryId,
      name: '티셔츠',
      skuPrefix: uniqueSkuPrefix(),
      options: [{ name: '색상', values: [{ value: '블랙' }] }],
      variantDefaults: { price: 19_000, stock: 4 },
    })

    const { product: updated } = await client().updateProduct(product.id, {
      version: product.version,
      options: [{ name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] }],
      variantDefaults: { price: 19_000, stock: 6 },
    })

    for (const variant of updated.variants) await expectSound(variant.id)

    const fresh = updated.variants.find((variant) => variant.stock === 6)

    expect(fresh).toBeDefined()
    expect((await client().getVariantLedger(fresh?.id ?? '')).entries[0]).toMatchObject({
      type: 'INBOUND',
      quantity: 6,
    })
  })

  it('turns an absolute level in the editor into the movement that reaches it', async () => {
    const { product } = await client().createProduct({
      categoryId,
      name: '티셔츠',
      skuPrefix: uniqueSkuPrefix(),
      variantDefaults: { price: 19_000, stock: 10 },
    })
    const variantId = product.variants[0]?.id ?? ''

    // Three sold between the seller loading the form and saving it.
    await stock().adjust({ variantId, type: 'SALE', quantity: -3 })

    await client().updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: [], stock: 20 }],
    })

    const { entries, variant } = await client().getVariantLedger(variantId)

    expect(variant.stock).toBe(20)
    // The sale is still in the history — the absolute value became `+13`, not a
    // row that pretends the three were never sold.
    expect(entries.map((entry) => entry.quantity)).toEqual([13, -3, 10])
    expect(entries[0]).toMatchObject({ type: 'ADJUST', reason: '판매자 재고 수정' })
    await expectSound(variantId)
  })

  it('writes nothing when the editor saves the level it already had', async () => {
    const { product } = await client().createProduct({
      categoryId,
      name: '티셔츠',
      skuPrefix: uniqueSkuPrefix(),
      variantDefaults: { price: 19_000, stock: 10 },
    })
    const variantId = product.variants[0]?.id ?? ''

    await client().updateProduct(product.id, {
      version: product.version,
      variants: [{ optionValues: [], stock: 10, price: 21_000 }],
    })

    expect((await client().getVariantLedger(variantId)).entries).toHaveLength(1)
  })

  it('leaves every variant of a twelve-combination listing sound', async () => {
    const { product } = await client().createProduct({
      categoryId,
      name: '티셔츠',
      skuPrefix: uniqueSkuPrefix(),
      options: [
        { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }, { value: '그레이' }] },
        {
          name: '사이즈',
          values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }, { value: 'XL' }],
        },
      ],
      variantDefaults: { price: 19_000, stock: 3 },
    })

    expect(product.variants).toHaveLength(12)
    for (const variant of product.variants) await expectSound(variant.id)
    expect(await stock().reconcile()).toEqual([])
  })
})

describe('F10 — 대사가 손상을 찾아낸다', () => {
  /** The reconciliation entry for one variant, if it has one. */
  async function faultsOf(variantId: string): Promise<StockDiscrepancy | undefined> {
    return (await stock().reconcile()).find((row) => row.variantId === variantId)
  }

  it('finds nothing while every movement went through the service', async () => {
    const variantId = await variantOf(10)

    await stock().adjust({ variantId, type: 'SALE', quantity: -4 })

    expect(await stock().reconcile()).toEqual([])
  })

  it('names the variant and the statement a bypassed update broke (L1 · L3)', async () => {
    const variantId = await variantOf(10)

    // The write R1 is about: somebody reaching for the column directly.
    await db.execute(`UPDATE "ProductVariant" SET "stock" = 4 WHERE "id" = $1`, [variantId])

    expect(await faultsOf(variantId)).toEqual({
      variantId,
      stock: 4,
      ledgerBalance: 10,
      faults: ['sum_mismatch', 'endpoint_mismatch'],
    })
  })

  it('finds a balance that does not follow from the previous one (L2)', async () => {
    const variantId = await variantOf(10)

    await db.execute(
      `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter")
       VALUES ($1, 2, 'INBOUND', 5, 99)`,
      [variantId],
    )
    await db.execute(`UPDATE "ProductVariant" SET "stock" = 99 WHERE "id" = $1`, [variantId])

    expect((await faultsOf(variantId))?.faults).toEqual(['sum_mismatch', 'chain_break'])
  })

  it('finds a position that was never handed out under the lock (L4)', async () => {
    const variantId = await variantOf(10)

    await db.execute(
      `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter")
       VALUES ($1, 5, 'INBOUND', 5, 15)`,
      [variantId],
    )
    await db.execute(`UPDATE "ProductVariant" SET "stock" = 15 WHERE "id" = $1`, [variantId])

    expect((await faultsOf(variantId))?.faults).toEqual(['seq_gap'])
  })
})

describe('GET /api/v1/variants/:id/ledger', () => {
  it('answers with the history, newest first', async () => {
    const variantId = await variantOf(10)

    await stock().adjust({ variantId, type: 'SALE', quantity: -2 })
    await stock().adjust({ variantId, type: 'ADJUST', quantity: -1, reason: '파손' })

    const body = await client().getVariantLedger(variantId)

    expect(body.entries.map((entry) => entry.seq)).toEqual([3, 2, 1])
    expect(body.entries[0]).toMatchObject({ type: 'ADJUST', quantity: -1, reason: '파손' })
    expect(body.variant).toMatchObject({ stock: 7, ledgerBalance: 7, entryCount: 3 })
    expect(body.nextCursor).toBeNull()
  })

  it('pages by seq without repeating or dropping a movement', async () => {
    const variantId = await variantOf(1)

    for (let round = 0; round < 9; round += 1) {
      await stock().adjust({ variantId, type: 'INBOUND', quantity: 1 })
    }

    const seen: number[] = []
    let cursor: number | undefined

    do {
      const page = await client().getVariantLedger(variantId, { limit: 3, cursor })

      seen.push(...page.entries.map((entry) => entry.seq))
      cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined)

    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('answers the shape `stockLedgerResponseSchema` declares (C3)', async () => {
    const variantId = await variantOf(4)
    const response = await fetch(`${api.baseUrl}/api/v1/variants/${variantId}/ledger`, {
      headers: {
        'x-test-user': seller.userId,
        'x-test-roles': 'SELLER_OWNER',
        'x-test-seller': seller.sellerId ?? '',
      },
    })

    expect(response.status).toBe(200)

    const body: unknown = await response.json()

    expect(() => stockLedgerResponseSchema.parse(body)).not.toThrow()
  })

  it('answers 401 without a caller (A4)', async () => {
    const variantId = await variantOf(1)

    expect((await failure(api.client.getVariantLedger(variantId))).status).toBe(401)
  })

  it("answers 403 for another store's variant (A3)", async () => {
    const variantId = await variantOf(1)

    expect((await failure(client(rival).getVariantLedger(variantId))).status).toBe(403)
  })

  it('lets an operator read any store history (A3)', async () => {
    const variantId = await variantOf(1)

    await expect(api.clientAs(callers.operator).getVariantLedger(variantId)).resolves.toMatchObject(
      { variant: { stock: 1 } },
    )
  })

  it('answers 404 for a variant nobody has', async () => {
    expect((await failure(client().getVariantLedger(randomUUID()))).status).toBe(404)
  })

  it('answers 400 naming the parameter it could not read (A2)', async () => {
    const variantId = await variantOf(1)
    const outcome = await failure(
      client().getVariantLedger(variantId, { limit: 9_999 as unknown as number }),
    )

    expect(outcome.status).toBe(400)
    expect(outcome.code).toBe('BAD_REQUEST')
    expect(
      outcome.details.filter(
        (entry): entry is { field: string } =>
          typeof entry === 'object' && entry !== null && 'field' in entry,
      ),
    ).toEqual([expect.objectContaining({ field: 'limit' })])
  })

  it('answers 400 for an id that is not a variant id', async () => {
    expect((await failure(client().getVariantLedger('not-a-uuid'))).status).toBe(400)
  })
})
