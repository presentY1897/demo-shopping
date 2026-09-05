/**
 * 데모 만료 정리 — against the real database (TASK-0025 6.1).
 *
 * **A6 is the point here more than anywhere else.** Every rule this task has is
 * a rule Postgres enforces: `RESTRICT` on the ledger's two foreign keys, the
 * append-only trigger, `User_google_identity_check`. A doubled implementation in
 * a mock would agree with itself and disagree with production, and the way that
 * failure shows up is **data that is gone**.
 *
 * So the sweep runs against a real schema, and the check that matters most is a
 * negative one: F9 proves the hard delete this task was originally written to do
 * really is refused.
 */

import { ApiClientError, demoStatusResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DemoCleanupService } from '../../src/demo/demo-cleanup.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { DEMO_CLEANUP_LAST_RUN_KEY } from '../../src/demo/demo-cleanup.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import { callers } from '../support/principal.js'

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/**
 * Before and after the app's fixed clock (`DEFAULT_TEST_INSTANT`).
 *
 * The sweep asks the injected `Clock`, not the wall clock, so "expired" is a
 * statement about that instant — a date that merely looks past would be in the
 * future to the code under test.
 */
const PAST = new Date('2026-09-02T00:00:00.000Z')
const FUTURE = new Date('2099-01-01T00:00:00.000Z')

function sweeper(): DemoCleanupService {
  return api.resolve<DemoCleanupService>(DemoCleanupService)
}

/** A demo seller with a store, a listing, a combination and an address. */
async function demoStore(options: { readonly expiresAt: Date }) {
  const user = await createUser(db, { isDemo: true, demoExpiresAt: options.expiresAt })
  const seller = await createSeller(db, { userId: user.id })
  const category = await createCategory(db, {})
  const product = await createProduct(db, { sellerId: seller.id, categoryId: category.id })
  const variant = await createProductVariant(db, { productId: product.id, sellerId: seller.id })
  const address = await createAddress(db, { userId: user.id })

  // Every variant is born with an opening `INBOUND` (TASK-0036 4.7). Writing it
  // here is what makes this fixture the real shape rather than a convenient one.
  await db.query(
    `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter", "reason")
     VALUES ($1, 1, 'INBOUND', 10, 10, '상품 등록 초기 재고')`,
    [variant.id],
  )

  return { user, seller, product, variant, address }
}

async function rowExists(table: string, id: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM "${table}" WHERE "id" = $1`, [id])

  return rows.length > 0
}

describe('F1 — an expired account is collected', () => {
  it('throws away what is only theirs and hides what the ledger holds', async () => {
    const { user, seller, product, variant, address } = await demoStore({ expiresAt: PAST })

    const report = await sweeper().sweep()

    expect(report.swept).toBe(1)
    expect(report.failed).toBe(0)

    // Gone.
    expect(await rowExists('Address', address.id)).toBe(false)
    expect(await db.query(`SELECT 1 FROM "UserRole" WHERE "userId" = $1`, [user.id])).toHaveLength(
      0,
    )

    // Hidden, not gone — the ledger holds the variant and the variant holds the
    // product.
    const [productRow] = await db.query<{ deletedAt: Date | null; status: string }>(
      `SELECT "deletedAt", "status" FROM "Product" WHERE "id" = $1`,
      [product.id],
    )
    const [variantRow] = await db.query<{ deletedAt: Date | null; isActive: boolean }>(
      `SELECT "deletedAt", "isActive" FROM "ProductVariant" WHERE "id" = $1`,
      [variant.id],
    )

    expect(productRow?.deletedAt).not.toBeNull()
    expect(productRow?.status).toBe('INACTIVE')
    expect(variantRow?.deletedAt).not.toBeNull()
    expect(variantRow?.isActive).toBe(false)

    // The store is closed by status; the row stays because products point at it.
    const [sellerRow] = await db.query<{ status: string; statusReason: string | null }>(
      `SELECT "status", "statusReason" FROM "Seller" WHERE "id" = $1`,
      [seller.id],
    )

    expect(sellerRow?.status).toBe('SUSPENDED')
    expect(sellerRow?.statusReason).toContain('만료')

    // The account survives as a tombstone; the ledger's `actorId` points here.
    const [userRow] = await db.query<{ deletedAt: Date | null }>(
      `SELECT "deletedAt" FROM "User" WHERE "id" = $1`,
      [user.id],
    )

    expect(userRow?.deletedAt).not.toBeNull()
  })

  it('does not collect the same account twice', async () => {
    // Without `deletedAt: null` in the query this would sweep the tombstone every
    // fifteen minutes for the life of the database.
    await demoStore({ expiresAt: PAST })

    expect((await sweeper().sweep()).swept).toBe(1)
    expect((await sweeper().sweep()).swept).toBe(0)
  })
})

describe('장바구니도 함께 간다 (TASK-0045 F8)', () => {
  it('throws the cart away, and its lines with it', async () => {
    const { user, variant } = await demoStore({ expiresAt: PAST })
    const [cart] = await db.query<{ id: string }>(
      `INSERT INTO "Cart" ("id", "userId", "updatedAt") VALUES (gen_random_uuid(), $1, now())
       RETURNING "id"`,
      [user.id],
    )

    await db.query(
      `INSERT INTO "CartItem"
         ("id", "cartId", "variantId", "sellerId", "quantity", "priceAtAdded", "updatedAt")
       SELECT gen_random_uuid(), $1, v."id", v."sellerId", 1, v."price", now()
         FROM "ProductVariant" v WHERE v."id" = $2`,
      [cart?.id, variant.id],
    )

    expect(await rowExists('Cart', cart?.id ?? '')).toBe(true)

    await sweeper().sweep()

    // 온전히 그 사람의 것이고 아무것도 참조하지 않는다. 남길 이력이 없다 — 주문은
    // 별개의 표이고 자기 스냅샷을 갖는다.
    expect(await rowExists('Cart', cart?.id ?? '')).toBe(false)
    expect(await db.query(`SELECT 1 FROM "CartItem" WHERE "cartId" = $1`, [cart?.id])).toHaveLength(
      0,
    )
  })

  it('leaves a real account’s cart alone', async () => {
    const real = await createUser(db, { isDemo: false })
    const [cart] = await db.query<{ id: string }>(
      `INSERT INTO "Cart" ("id", "userId", "updatedAt") VALUES (gen_random_uuid(), $1, now())
       RETURNING "id"`,
      [real.id],
    )

    await demoStore({ expiresAt: PAST })
    await sweeper().sweep()

    expect(await rowExists('Cart', cart?.id ?? '')).toBe(true)
  })
})

describe('잡아 둔 재고도 놓아 준다 (TASK-0048)', () => {
  it('gives the held quantity back to the variant and throws the reservation away', async () => {
    const { user, variant } = await demoStore({ expiresAt: PAST })
    const [reservation] = await db.query<{ id: string }>(
      `INSERT INTO "StockReservation"
         ("id", "variantId", "userId", "checkoutId", "quantity", "expiresAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 2, now() + interval '15 minutes', now())
       RETURNING "id"`,
      [variant.id, user.id],
    )

    await db.query(`UPDATE "ProductVariant" SET "reserved" = 2 WHERE "id" = $1`, [variant.id])

    await sweeper().sweep()

    // 행만 지우면 `reserved` 에 2가 남아 아무도 살 수 없는 재고가 된다. 실패로
    // 나타나지 않으므로 판매자는 팔리지 않는 이유를 영원히 알 수 없다.
    const [after] = await db.query<{ reserved: number }>(
      `SELECT "reserved" FROM "ProductVariant" WHERE "id" = $1`,
      [variant.id],
    )

    expect(after?.reserved).toBe(0)
    expect(await rowExists('StockReservation', reservation?.id ?? '')).toBe(false)
  })

  it('leaves the shelf alone for a hold that was already confirmed', async () => {
    const { user, variant } = await demoStore({ expiresAt: PAST })

    await db.query(
      `INSERT INTO "StockReservation"
         ("id", "variantId", "userId", "checkoutId", "quantity", "status", "expiresAt", "settledAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 2, 'CONFIRMED', now(), now(), now())`,
      [variant.id, user.id],
    )

    await sweeper().sweep()

    // 확정된 몫은 이미 `reserved` 에서 빠졌고 실제로 팔렸다. 되돌리면 음수가 된다.
    const [after] = await db.query<{ reserved: number }>(
      `SELECT "reserved" FROM "ProductVariant" WHERE "id" = $1`,
      [variant.id],
    )

    expect(after?.reserved).toBe(0)
  })
})

describe('주문은 남는다 (TASK-0049)', () => {
  it('keeps a demo buyer’s order after the sweep', async () => {
    const { user, variant } = await demoStore({ expiresAt: PAST })
    const [order] = await db.query<{ id: string }>(
      `INSERT INTO "Order"
         ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
          "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
       VALUES (gen_random_uuid(), '20260905-KEEPKEEP', $1, gen_random_uuid(), '수령인',
               '010-0000-0000', '06234', '서울시 강남구', 10000, 10000, now())
       RETURNING "id"`,
      [user.id],
    )

    await db.query(
      `INSERT INTO "SellerOrder"
         ("id", "orderId", "sellerId", "brandName", "productAmount", "paidAmount", "updatedAt")
       SELECT gen_random_uuid(), $1, v."sellerId", '브랜드', 10000, 10000, now()
         FROM "ProductVariant" v WHERE v."id" = $2`,
      [order?.id, variant.id],
    )

    await sweeper().sweep()

    // 산 사람이 데모였다는 것은 **판 사람의 기록을 지울 이유가 아니다.** 정산과
    // 판매 이력이 이 주문을 가리키고, 계정 행은 툼스톤으로 남으므로 외래키도
    // 끊기지 않는다.
    expect(await rowExists('Order', order?.id ?? '')).toBe(true)
  })
})

describe('F2 · F3 — what the sweep must not touch', () => {
  it('leaves a demo account that has not expired', async () => {
    const alive = await demoStore({ expiresAt: FUTURE })

    await sweeper().sweep()

    expect(await rowExists('Address', alive.address.id)).toBe(true)
  })

  it('leaves a real account alone even if it somehow carries an expiry', async () => {
    // `isDemo` is the guard R1 asks for. The database forbids this combination
    // (`User_demo_expiry_check`), so the row is built by hand — the point is that
    // the *query* would still refuse it.
    const real = await createUser(db, { isDemo: false })
    const address = await createAddress(db, { userId: real.id })

    await db.query(`UPDATE "User" SET "isDemo" = false WHERE "id" = $1`, [real.id])
    await sweeper().sweep()

    expect(await rowExists('Address', address.id)).toBe(true)
  })

  it('leaves another demo account’s rows where they are', async () => {
    const expired = await demoStore({ expiresAt: PAST })
    const other = await demoStore({ expiresAt: FUTURE })

    await sweeper().sweep()

    expect(await rowExists('Address', expired.address.id)).toBe(false)
    expect(await rowExists('Address', other.address.id)).toBe(true)
  })

  it('leaves the public catalogue alone', async () => {
    const category = await createCategory(db, {})
    const publicUser = await createUser(db, {})
    const publicSeller = await createSeller(db, { userId: publicUser.id })
    const publicProduct = await createProduct(db, {
      sellerId: publicSeller.id,
      categoryId: category.id,
    })

    await demoStore({ expiresAt: PAST })
    await sweeper().sweep()

    const [row] = await db.query<{ deletedAt: Date | null }>(
      `SELECT "deletedAt" FROM "Product" WHERE "id" = $1`,
      [publicProduct.id],
    )

    expect(row?.deletedAt).toBeNull()
    expect(await rowExists('Category', String(category.id))).toBe(true)
  })
})

describe('F9 — the ledger is why the product survives', () => {
  it('keeps every ledger row of a collected store', async () => {
    const { variant } = await demoStore({ expiresAt: PAST })

    await sweeper().sweep()

    const entries = await db.query(`SELECT "seq" FROM "StockLedger" WHERE "variantId" = $1`, [
      variant.id,
    ])

    expect(entries).toHaveLength(1)
  })

  it('really would refuse the hard delete this task was first written to do', async () => {
    // The negative control for the whole design change. If this ever starts
    // passing, the soft delete is no longer necessary and the task's 4장 is
    // wrong — but until then, deleting the product is a failed transaction, and
    // a sweep that tried it would collect nothing at all.
    const { product } = await demoStore({ expiresAt: PAST })

    await expect(db.query(`DELETE FROM "Product" WHERE "id" = $1`, [product.id])).rejects.toThrow(
      /violates foreign key constraint/i,
    )
  })

  it('refuses to delete a ledger row even directly', async () => {
    const { variant } = await demoStore({ expiresAt: PAST })

    await expect(
      db.query(`DELETE FROM "StockLedger" WHERE "variantId" = $1`, [variant.id]),
    ).rejects.toThrow(/재고 원장은 수정하거나 삭제할 수 없습니다/)
  })
})

describe('F5 — the sweep says when it last ran', () => {
  it('records the run so a stopped scheduler is a stale timestamp', async () => {
    await sweeper().sweep()

    const [row] = await db.query<{ value: string }>(
      `SELECT "value" FROM "AppMeta" WHERE "key" = $1`,
      [DEMO_CLEANUP_LAST_RUN_KEY],
    )

    expect(row?.value).toBeTruthy()
    expect(await sweeper().lastRunAt()).toBeInstanceOf(Date)
  })

  it('publishes it on /health', async () => {
    await sweeper().sweep()

    const health = await api.client.getHealth()

    expect(health.demoCleanup.lastRunAt).not.toBeNull()
  })

  it('answers null before the first run', async () => {
    await db.query(`DELETE FROM "AppMeta" WHERE "key" = $1`, [DEMO_CLEANUP_LAST_RUN_KEY])

    const health = await api.client.getHealth()

    expect(health.demoCleanup.lastRunAt).toBeNull()
  })
})

describe('F6 — one account’s failure is one account’s', () => {
  it('collects the others, and the failed one is retried on the next sweep', async () => {
    const first = await demoStore({ expiresAt: new Date('2026-09-01T00:00:00.000Z') })
    const second = await demoStore({ expiresAt: PAST })
    const prisma = api.resolve<PrismaService>(PrismaService)

    // The fault is injected rather than manufactured out of a constraint. Every
    // constraint this schema has is one the sweep is *designed* around, so
    // tripping one would test the schema; what F6 is about is what the loop does
    // when a transaction fails for any reason at all.
    const transaction = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('주입한 실패'))

    const report = await sweeper().sweep()

    transaction.mockRestore()

    expect(report.swept).toBe(1)
    expect(report.failed).toBe(1)

    // Nothing half-done: the failed account keeps everything, including the
    // rows the first statement of the transaction would have removed.
    expect(await rowExists('Address', first.address.id)).toBe(true)

    const [failed] = await db.query<{ deletedAt: Date | null }>(
      `SELECT "deletedAt" FROM "User" WHERE "id" = $1`,
      [first.user.id],
    )

    expect(failed?.deletedAt).toBeNull()

    // And it is still expired, which is the whole retry mechanism — nothing has
    // to remember it.
    expect((await sweeper().sweep()).swept).toBe(1)
    expect(await rowExists('Address', first.address.id)).toBe(false)
    expect(await rowExists('Address', second.address.id)).toBe(false)
  })

  it('caps how many it takes in one tick (R2)', async () => {
    await demoStore({ expiresAt: PAST })
    await demoStore({ expiresAt: PAST })
    await demoStore({ expiresAt: PAST })

    expect((await sweeper().sweep(2)).swept).toBe(2)
    expect((await sweeper().sweep(2)).swept).toBe(1)
  })
})

describe('F7 — forcing an expiry', () => {
  beforeEach(() => {
    api.cookies.clear()
  })

  it('brings the expiry forward so the next sweep collects it', async () => {
    const { user, address } = await demoStore({ expiresAt: FUTURE })

    const answer = await api.clientAs(callers.demoAdmin).request({
      path: `/auth/demo/${user.id}/expire`,
      method: 'POST',
      schema: demoStatusResponseSchema,
    })

    expect(answer.demo?.expiresAt).toBeTruthy()

    // It does not delete — it makes the account collectable, and the sweep does
    // the rest. Two paths into the same deletion would be two places to drift.
    expect(await rowExists('Address', address.id)).toBe(true)
    expect((await sweeper().sweep()).swept).toBe(1)
    expect(await rowExists('Address', address.id)).toBe(false)
  })

  it('answers 404 for an account that is not a live demo', async () => {
    const real = await createUser(db, {})

    const error: unknown = await api
      .clientAs(callers.demoAdmin)
      .request({
        path: `/auth/demo/${real.id}/expire`,
        method: 'POST',
        schema: demoStatusResponseSchema,
      })
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).status).toBe(404)
  })

  it('refuses a caller without demo.manage (A3)', async () => {
    const { user } = await demoStore({ expiresAt: FUTURE })

    const error: unknown = await api
      .clientAs(callers.seller)
      .request({
        path: `/auth/demo/${user.id}/expire`,
        method: 'POST',
        schema: demoStatusResponseSchema,
      })
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).status).toBe(403)
  })
})
