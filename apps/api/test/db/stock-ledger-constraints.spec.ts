import { randomUUID } from 'node:crypto'

import { DatabaseError } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import type { ProductVariantRow } from '../support/factories.js'
import {
  createProductVariant,
  createSellableVariant,
  createStockLedgerEntry,
  createUser,
} from '../support/factories.js'

/**
 * Gate S5 for the stock ledger: the rules are tried against the real database.
 *
 * TASK-0036 4.12 draws a line — what the database can hold and what only the
 * service can — and this file is where "stated in the migration" is proven to
 * mean "enforced". Each rule is tried **twice**, as TASK-0106 4.8 established: a
 * violation has to be refused with the right SQLSTATE and constraint name, and
 * the neighbouring case that must be permitted has to succeed. The second half
 * is what a check of the migration text can never do — a predicate written
 * backwards still refuses violations, it just also refuses everything else.
 *
 * The last describe block is the other half of the boundary: the three
 * statements the database **accepts** violations of (L1, L2, L4), pinned down so
 * that "the database will catch it" never becomes the reason somebody deletes
 * the row lock.
 *
 * Every attempt is raw SQL. Going through Prisma or through `StockService`
 * would let application validation answer first, and the question here is
 * precisely whether the database would have refused on its own.
 */

const db = useDatabase()

let variant: ProductVariantRow
let productId: string
let sellerId: string

beforeEach(async () => {
  const fixture = await createSellableVariant(db)

  variant = fixture.variant
  productId = fixture.product.id
  sellerId = fixture.seller.id
})

/** Runs `work`, asserting that it was the database that refused, and how. */
async function refusal(work: Promise<unknown>): Promise<DatabaseError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof DatabaseError)) {
    throw new Error(
      `DB 가 거부할 것으로 기대했지만 성공했거나 다른 오류가 났습니다: ${String(error)}`,
    )
  }
  return error
}

function entry(options: Parameters<typeof createStockLedgerEntry>[1]): Promise<unknown> {
  return createStockLedgerEntry(db, options)
}

describe('StockLedger_quantity_check — 0 은 변동이 아니다', () => {
  it('refuses a movement of nothing', async () => {
    const error = await refusal(
      entry({ variantId: variant.id, type: 'ADJUST', quantity: 0, reason: '실사' }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockLedger_quantity_check')
  })

  it('permits any non-zero quantity', async () => {
    await expect(entry({ variantId: variant.id, quantity: 1 })).resolves.toMatchObject({
      quantity: 1,
    })
  })
})

describe('StockLedger_direction_check — 유형이 부호를 정한다', () => {
  it.each([
    ['SALE', 2],
    ['RESERVE_CONFIRM', 1],
    ['INBOUND', -1],
    ['CANCEL', -1],
    ['RETURN_IN', -1],
  ] as const)('refuses %s with quantity %i', async (type, quantity) => {
    const error = await refusal(entry({ variantId: variant.id, type, quantity, balanceAfter: 10 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockLedger_direction_check')
  })

  it.each([
    ['INBOUND', 5],
    ['CANCEL', 5],
    ['RETURN_IN', 5],
    ['SALE', -5],
    ['RESERVE_CONFIRM', -5],
  ] as const)('permits %s with quantity %i', async (type, quantity) => {
    await expect(
      entry({ variantId: variant.id, type, quantity, balanceAfter: 10 }),
    ).resolves.toMatchObject({ type })
  })

  it('lets ADJUST move both ways', async () => {
    await entry({ variantId: variant.id, seq: 1, type: 'ADJUST', quantity: 3, reason: '실사 +' })
    await expect(
      entry({
        variantId: variant.id,
        seq: 2,
        type: 'ADJUST',
        quantity: -3,
        balanceAfter: 0,
        reason: '실사 -',
      }),
    ).resolves.toMatchObject({ quantity: -3 })
  })
})

describe('StockLedger_balance_check — 어느 시점에도 음수가 아니었다', () => {
  it('refuses a balance below zero', async () => {
    const error = await refusal(
      entry({ variantId: variant.id, type: 'SALE', quantity: -1, balanceAfter: -1 }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockLedger_balance_check')
  })

  it('permits a balance of zero', async () => {
    await expect(
      entry({ variantId: variant.id, type: 'SALE', quantity: -1, balanceAfter: 0 }),
    ).resolves.toMatchObject({ balanceAfter: 0 })
  })
})

describe('StockLedger_seq_check — 자리는 1부터', () => {
  it('refuses position zero', async () => {
    const error = await refusal(entry({ variantId: variant.id, seq: 0 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockLedger_seq_check')
  })

  it('permits position one', async () => {
    await expect(entry({ variantId: variant.id, seq: 1 })).resolves.toMatchObject({ seq: 1 })
  })
})

describe('StockLedger_ref_pair_check — 참조는 짝이다', () => {
  it('refuses a type with no id', async () => {
    const error = await refusal(
      entry({ variantId: variant.id, refType: 'ORDER_ITEM', refId: null }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockLedger_ref_pair_check')
  })

  it('refuses an id with no type', async () => {
    const error = await refusal(
      entry({ variantId: variant.id, refType: null, refId: randomUUID() }),
    )

    expect(error.constraint).toBe('StockLedger_ref_pair_check')
  })

  it('permits both halves and neither', async () => {
    await expect(entry({ variantId: variant.id, seq: 1 })).resolves.toBeTruthy()
    await expect(
      entry({ variantId: variant.id, seq: 2, refType: 'ORDER_ITEM', refId: randomUUID() }),
    ).resolves.toBeTruthy()
  })
})

describe('사유 — 조정은 이유를 말한다', () => {
  it('refuses whitespace, whatever the type', async () => {
    const error = await refusal(entry({ variantId: variant.id, reason: '   ' }))

    expect(error.constraint).toBe('StockLedger_reason_blank_check')
  })

  it('refuses an adjustment with none', async () => {
    const error = await refusal(
      entry({ variantId: variant.id, type: 'ADJUST', quantity: 2, reason: null }),
    )

    expect(error.constraint).toBe('StockLedger_adjust_reason_check')
  })

  it('permits every other type with none', async () => {
    await expect(
      entry({ variantId: variant.id, type: 'INBOUND', reason: null }),
    ).resolves.toBeTruthy()
  })
})

describe('StockLedger_pkey — 한 자리에 한 행', () => {
  it('refuses a second movement at the same position', async () => {
    await entry({ variantId: variant.id, seq: 1 })

    const error = await refusal(entry({ variantId: variant.id, seq: 1, quantity: 3 }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('StockLedger_pkey')
  })

  it('permits the same position on another variant', async () => {
    await entry({ variantId: variant.id, seq: 1 })

    const other = await createProductVariant(db, {
      productId,
      sellerId,
      optionSignature: 'other',
    })

    await expect(entry({ variantId: other.id, seq: 1 })).resolves.toBeTruthy()
  })
})

describe('StockLedger_ref_key — 같은 변동은 한 번뿐', () => {
  it('refuses the same movement recorded twice', async () => {
    const refId = randomUUID()

    await entry({
      variantId: variant.id,
      seq: 1,
      type: 'SALE',
      quantity: -1,
      refType: 'ORDER_ITEM',
      refId,
    })

    const error = await refusal(
      entry({
        variantId: variant.id,
        seq: 2,
        type: 'SALE',
        quantity: -1,
        refType: 'ORDER_ITEM',
        refId,
      }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('StockLedger_ref_key')
  })

  it('permits a different movement for the same reference', async () => {
    const refId = randomUUID()

    await entry({
      variantId: variant.id,
      seq: 1,
      type: 'SALE',
      quantity: -1,
      refType: 'ORDER_ITEM',
      refId,
    })

    // A sale and its cancellation name the same order item and are two
    // different things that really happened.
    await expect(
      entry({
        variantId: variant.id,
        seq: 2,
        type: 'CANCEL',
        quantity: 1,
        refType: 'ORDER_ITEM',
        refId,
      }),
    ).resolves.toBeTruthy()
  })

  it('permits repeats when there is no reference at all', async () => {
    // "+5 입고" twice is two receipts, not a duplicate — which is why the index
    // is partial.
    await entry({ variantId: variant.id, seq: 1, type: 'INBOUND', quantity: 5 })

    await expect(
      entry({ variantId: variant.id, seq: 2, type: 'INBOUND', quantity: 5, balanceAfter: 10 }),
    ).resolves.toBeTruthy()
  })
})

describe('외래키 — 원장은 실재하는 행을 가리킨다', () => {
  it('refuses a movement for a variant that does not exist', async () => {
    const error = await refusal(entry({ variantId: randomUUID() }))

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('StockLedger_variantId_fkey')
  })

  it('refuses an actor that does not exist', async () => {
    const error = await refusal(entry({ variantId: variant.id, actorId: randomUUID() }))

    expect(error.constraint).toBe('StockLedger_actorId_fkey')
  })

  it('refuses removing a variant that has history', async () => {
    await entry({ variantId: variant.id })

    const error = await refusal(
      db.execute(`DELETE FROM "ProductVariant" WHERE "id" = $1`, [variant.id]),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('StockLedger_variantId_fkey')
  })

  it('permits an actor who has since withdrawn', async () => {
    // Withdrawal is `deletedAt`; the row stays behind precisely so that history
    // keeps pointing at something.
    const actor = await createUser(db)

    await entry({ variantId: variant.id, actorId: actor.id })
    await db.execute(`UPDATE "User" SET "deletedAt" = now() WHERE "id" = $1`, [actor.id])

    const [row] = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "StockLedger" WHERE "actorId" = $1`,
      [actor.id],
    )

    expect(row?.count).toBe(1)
  })
})

describe('StockLedger_append_only — 원장은 고쳐 쓰지 않는다', () => {
  beforeEach(async () => {
    await entry({ variantId: variant.id, seq: 1 })
  })

  it('refuses an update', async () => {
    const error = await refusal(
      db.execute(`UPDATE "StockLedger" SET "quantity" = 99 WHERE "variantId" = $1`, [variant.id]),
    )

    expect(error.code).toBe('23001')
    expect(error.constraint).toBe('StockLedger_append_only')
  })

  it('refuses a delete', async () => {
    const error = await refusal(
      db.execute(`DELETE FROM "StockLedger" WHERE "variantId" = $1`, [variant.id]),
    )

    expect(error.code).toBe('23001')
    expect(error.constraint).toBe('StockLedger_append_only')
  })

  it('leaves the row exactly as it was', async () => {
    await refusal(
      db.execute(`UPDATE "StockLedger" SET "quantity" = 99 WHERE "variantId" = $1`, [variant.id]),
    )

    const row = await db.one<{ quantity: number }>(
      `SELECT "quantity" FROM "StockLedger" WHERE "variantId" = $1`,
      [variant.id],
    )

    expect(row.quantity).toBe(5)
  })

  it('still accepts an insert — the correction is a new movement', async () => {
    // A mistaken movement is offset by an opposite ADJUST, so that who reversed
    // what stays in the ledger too (TASK-0036 4.5).
    await expect(
      entry({
        variantId: variant.id,
        seq: 2,
        type: 'ADJUST',
        quantity: -5,
        balanceAfter: 0,
        reason: '잘못 입력한 입고 취소',
      }),
    ).resolves.toBeTruthy()
  })
})

/**
 * The other half of the boundary (TASK-0036 4.12).
 *
 * Three of the four statements a true ledger satisfies need an aggregate over
 * other rows, and a CHECK may not contain one. The database therefore accepts
 * every one of these — which is exactly why the row lock and
 * `StockService.reconcile` exist, and why nobody may delete them on the grounds
 * that "the database will catch it".
 */
describe('DB 가 받아들이는 것 — 경계 (L1 · L2 · L4)', () => {
  it('accepts a stock the movements do not add up to (L1)', async () => {
    await entry({ variantId: variant.id, seq: 1, type: 'INBOUND', quantity: 5, balanceAfter: 5 })
    await db.execute(`UPDATE "ProductVariant" SET "stock" = 99 WHERE "id" = $1`, [variant.id])

    const row = await db.one<{ stock: number; sum: number }>(
      `SELECT v."stock", COALESCE(sum(l."quantity"), 0)::int AS "sum"
         FROM "ProductVariant" v LEFT JOIN "StockLedger" l ON l."variantId" = v."id"
        WHERE v."id" = $1 GROUP BY v."stock"`,
      [variant.id],
    )

    expect(row.stock).toBe(99)
    expect(row.sum).toBe(5)
  })

  it('accepts a balance that does not follow from the previous one (L2)', async () => {
    await entry({ variantId: variant.id, seq: 1, type: 'INBOUND', quantity: 5, balanceAfter: 5 })

    await expect(
      entry({ variantId: variant.id, seq: 2, type: 'INBOUND', quantity: 5, balanceAfter: 42 }),
    ).resolves.toBeTruthy()
  })

  it('accepts a gap in the positions (L4)', async () => {
    await entry({ variantId: variant.id, seq: 1 })

    await expect(entry({ variantId: variant.id, seq: 7, balanceAfter: 10 })).resolves.toBeTruthy()
  })
})
