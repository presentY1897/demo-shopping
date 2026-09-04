import type { ApiClient, CreateProductRequest, SellerStatus } from '@shopping/shared'
import { ApiClientError, stockAdjustResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * Adjusting stock from the console (TASK-0115 완료 기준 F2 · F9 · F10 · A2~A4).
 *
 * The endpoint's whole job is *authorisation plus delegation*: everything about
 * the movement — the row lock, the position, the balance, the refusal when
 * there is not enough — belongs to TASK-0036 and is proved there. What is
 * checked here is that the console cannot get at the column any other way, that
 * the answer carries what a screen needs, and that the history the seller then
 * opens is the one this request wrote.
 *
 * Every response passes through `createApiClient`, so a shape that does not
 * match `stockAdjustResponseSchema` fails before an assertion sees it (C3).
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let slugCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

function operator(): ApiClient {
  return api.clientAs(callers.operator)
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly fields: readonly string[]
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
    fields: (error.body?.error.details ?? [])
      .filter((entry): entry is { field: string } => typeof entry === 'object' && entry !== null)
      .map((entry) => entry.field),
  }
}

let categoryId: number
let seller: TestCaller
let rival: TestCaller

async function storefront(status: SellerStatus = 'ACTIVE'): Promise<TestCaller> {
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id, status })

  return { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
}

beforeEach(async () => {
  const { category } = await operator().createCategory({
    parentId: null,
    name: '의류',
    slug: uniqueSlug('clothing'),
  })

  categoryId = category.id
  seller = await storefront()
  rival = await storefront()
})

/** A listing with one variant, opening at `stock` units. */
async function variantOf(stock: number, caller: TestCaller = seller): Promise<string> {
  const request: CreateProductRequest = {
    categoryId,
    name: '오버사이즈 티셔츠',
    variantDefaults: { price: 19_000, stock },
  }
  const { product } = await api.clientAs(caller).createProduct(request)

  return product.variants[0]?.id ?? ''
}

/** The column and the ledger's own sum, which have to agree. */
async function auditOf(variantId: string): Promise<{ stock: number; sum: number; rows: number }> {
  return db.one<{ stock: number; sum: number; rows: number }>(
    `SELECT v."stock",
            COALESCE(sum(l."quantity"), 0)::int AS "sum",
            count(l.*)::int                     AS "rows"
       FROM "ProductVariant" v
       LEFT JOIN "StockLedger" l ON l."variantId" = v."id"
      WHERE v."id" = $1
      GROUP BY v."stock"`,
    [variantId],
  )
}

describe('F2 — +5 입고', () => {
  it('raises the stock by five and writes exactly one ledger row', async () => {
    const variantId = await variantOf(12)
    const before = await auditOf(variantId)
    const answer = await api
      .clientAs(seller)
      .adjustVariantStock(variantId, { delta: 5, type: 'INBOUND' })

    expect(() => stockAdjustResponseSchema.parse(answer)).not.toThrow()
    expect(answer).toMatchObject({ variantId, delta: 5, balanceAfter: 17 })

    const after = await auditOf(variantId)

    expect(after.stock).toBe(before.stock + 5)
    expect(after.rows).toBe(before.rows + 1)
    // The invariant the whole endpoint exists to protect.
    expect(after.sum).toBe(after.stock)
  })

  it('takes stock away with a negative delta and a reason', async () => {
    const variantId = await variantOf(12)
    const answer = await api
      .clientAs(seller)
      .adjustVariantStock(variantId, { delta: -3, type: 'ADJUST', reason: '파손' })

    expect(answer).toMatchObject({ delta: -3, balanceAfter: 9 })

    const { reason } = await db.one<{ reason: string }>(
      `SELECT "reason" FROM "StockLedger" WHERE "variantId" = $1 AND "seq" = $2`,
      [variantId, answer.seq],
    )

    expect(reason).toBe('파손')
  })

  it('names who did it, so the history can be audited', async () => {
    const variantId = await variantOf(0)
    const answer = await api
      .clientAs(seller)
      .adjustVariantStock(variantId, { delta: 4, type: 'INBOUND' })

    const { actorId } = await db.one<{ actorId: string | null }>(
      `SELECT "actorId" FROM "StockLedger" WHERE "variantId" = $1 AND "seq" = $2`,
      [variantId, answer.seq],
    )

    expect(actorId).toBe(seller.userId)
  })
})

describe('F9 — 이력 조회', () => {
  it('shows three adjustments in order, each explaining the next balance', async () => {
    const variantId = await variantOf(0)

    for (const delta of [7, -2, 5]) {
      await api
        .clientAs(seller)
        .adjustVariantStock(variantId, { delta, type: 'ADJUST', reason: '실사' })
    }

    // The read is TASK-0036's endpoint, called unchanged — this task opened the
    // write and reuses the history rather than building a second one.
    const history = await api.clientAs(seller).getVariantLedger(variantId)

    expect(history.entries).toHaveLength(3)
    expect(history.entries.map((entry) => entry.seq)).toEqual([3, 2, 1])
    expect(history.entries.map((entry) => entry.balanceAfter)).toEqual([10, 5, 7])
    expect(history.variant).toMatchObject({ stock: 10, ledgerBalance: 10, entryCount: 3 })
  })

  it('hands back the seq that finds the row it just wrote', async () => {
    const variantId = await variantOf(0)
    const first = await api
      .clientAs(seller)
      .adjustVariantStock(variantId, { delta: 3, type: 'INBOUND' })
    const second = await api
      .clientAs(seller)
      .adjustVariantStock(variantId, { delta: 4, type: 'INBOUND' })

    const history = await api.clientAs(seller).getVariantLedger(variantId)
    const found = history.entries.find((entry) => entry.seq === second.seq)

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(found).toMatchObject({ quantity: 4, balanceAfter: 7 })
  })
})

describe('A2 — 입력 검증', () => {
  it('refuses a delta of zero', async () => {
    const variantId = await variantOf(5)

    // A movement of nothing is not a movement, and a row carrying one would
    // occupy a position the reconciliation then counts as history.
    expect(
      await failure(
        api.clientAs(seller).adjustVariantStock(variantId, { delta: 0, type: 'ADJUST' }),
      ),
    ).toMatchObject({ status: 400 })
  })

  it('refuses a movement type the console may not record', async () => {
    const variantId = await variantOf(5)
    const answer = await failure(
      api.clientAs(seller).adjustVariantStock(variantId, { delta: -1, type: 'SALE' as never }),
    )

    // A console entry carries no order reference, so a `SALE` recorded here is
    // a sale nothing accounts for (`sellerStockAdjustTypes`).
    expect(answer.status).toBe(400)
    expect(answer.fields).toContain('type')
  })

  it('refuses an adjustment with no reason, naming the field', async () => {
    const variantId = await variantOf(5)
    const answer = await failure(
      api.clientAs(seller).adjustVariantStock(variantId, { delta: -1, type: 'ADJUST' }),
    )

    // The rule lives in the ledger and is not repeated in the schema; what the
    // form needs is the field name, and it arrives either way.
    expect(answer.status).toBe(400)
    expect(answer.fields).toContain('reason')
  })

  it('refuses a receipt that would take stock away', async () => {
    const variantId = await variantOf(5)

    expect(
      await failure(
        api.clientAs(seller).adjustVariantStock(variantId, { delta: -1, type: 'INBOUND' }),
      ),
    ).toMatchObject({ status: 400 })
  })

  it('refuses to take away more than there is', async () => {
    const variantId = await variantOf(2)
    const answer = await failure(
      api
        .clientAs(seller)
        .adjustVariantStock(variantId, { delta: -3, type: 'ADJUST', reason: '실사' }),
    )

    expect(answer.status).toBe(409)
    expect((await auditOf(variantId)).stock).toBe(2)
  })

  it('answers 404 for a variant that does not exist', async () => {
    expect(
      await failure(
        api
          .clientAs(seller)
          .adjustVariantStock('0192f0c1-0000-7000-8000-00000000beef', {
            delta: 1,
            type: 'INBOUND',
          }),
      ),
    ).toMatchObject({ status: 404 })
  })
})

describe('A3 · A4 · F10 — 권한 · 인증 · 스토어 상태', () => {
  it('refuses another store’s variant', async () => {
    const theirs = await variantOf(5, rival)

    expect(
      await failure(api.clientAs(seller).adjustVariantStock(theirs, { delta: 1, type: 'INBOUND' })),
    ).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('refuses a buyer', async () => {
    const variantId = await variantOf(5)

    expect(
      await failure(
        api.clientAs(callers.buyer).adjustVariantStock(variantId, { delta: 1, type: 'INBOUND' }),
      ),
    ).toMatchObject({ status: 403 })
  })

  it('refuses an anonymous caller with a 401', async () => {
    const variantId = await variantOf(5)

    expect(
      await failure(api.client.adjustVariantStock(variantId, { delta: 1, type: 'INBOUND' })),
    ).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
  })

  it('refuses a suspended store, with a code an ownership 403 does not carry', async () => {
    const suspended = await storefront('ACTIVE')
    const variantId = await variantOf(5, suspended)

    await db.execute(`UPDATE "Seller" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [
      suspended.sellerId,
    ])

    const answer = await failure(
      api.clientAs(suspended).adjustVariantStock(variantId, { delta: 1, type: 'INBOUND' }),
    )

    // Two 403s with opposite advice: "내 스토어가 맞는지 확인" and "스토어가
    // 승인된 뒤에". Only the code tells them apart.
    expect(answer).toMatchObject({ status: 403, code: 'PRODUCT_SELLER_INACTIVE' })
    expect((await auditOf(variantId)).stock).toBe(5)
  })

  it('lets a suspended store still read its own history', async () => {
    const suspended = await storefront('ACTIVE')
    const variantId = await variantOf(5, suspended)

    await db.execute(`UPDATE "Seller" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [
      suspended.sellerId,
    ])

    const history = await api.clientAs(suspended).getVariantLedger(variantId)

    expect(history.variant.stock).toBe(5)
  })
})
