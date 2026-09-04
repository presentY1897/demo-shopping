import { APP_ID_HEADER } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { DemoSeedContext } from '../../src/demo/demo-seed.service.js'
import { DemoSeedService } from '../../src/demo/demo-seed.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'

/**
 * F8 — issuing a demo account is **one** transaction.
 *
 * A half-built demo has no repair path: the visitor is already signed in as the
 * account that is missing its store, and the screen does not offer to try again.
 * So the account, its roles, everything a seeder wrote, the store and the
 * session row all have to arrive together or not at all.
 *
 * **Proved with `xmin`, not by counting rows.** Every row Postgres stores
 * carries the id of the transaction that inserted it, so "these rows were
 * written together" is a fact the database itself can be asked — and unlike a
 * count it cannot be satisfied by a path that happened to write everything in
 * the right order across three transactions.
 */

function issue(baseUrl: string, role: string, app: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [APP_ID_HEADER]: app },
    body: JSON.stringify({ role }),
  })
}

describe('발급의 원자성', () => {
  const db = useDatabase()
  const api = useApiApp({ database: db })

  /** How many distinct transactions wrote the rows this account is made of. */
  async function writingTransactions(): Promise<number> {
    const rows = await db.query<{ writer: string }>(
      `SELECT DISTINCT "xmin"::text AS writer FROM "User"
       UNION SELECT DISTINCT "xmin"::text FROM "UserRole"
       UNION SELECT DISTINCT "xmin"::text FROM "RefreshToken"
       UNION SELECT DISTINCT "xmin"::text FROM "Address"
       UNION SELECT DISTINCT "xmin"::text FROM "UserPreference"`,
    )

    return rows.length
  }

  it('계정 · 역할 · 초기 데이터 · 세션이 한 트랜잭션에서 커밋된다', async () => {
    const response = await issue(api.baseUrl, 'BUYER', 'shop')

    expect(response.status).toBe(200)
    await response.text()

    expect(await writingTransactions()).toBe(1)
  })

  it('판매자 데모의 스토어와 복제한 상품까지 같은 트랜잭션이다', async () => {
    const owner = await createUser(db)
    const seller = await createSeller(db, { userId: owner.id })
    const category = await createCategory(db)
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'ACTIVE',
      minPrice: 9_000,
    })
    await createProductVariant(db, { productId: product.id, sellerId: seller.id, stock: 4 })

    const response = await issue(api.baseUrl, 'SELLER', 'seller')

    expect(response.status).toBe(200)
    await response.text()

    const [store] = await db.query<{ id: string }>(
      `SELECT s."id" FROM "Seller" s JOIN "User" u ON u."id" = s."userId"
        WHERE u."demoExpiresAt" IS NOT NULL`,
    )

    const rows = await db.query<{ writer: string }>(
      `SELECT DISTINCT "xmin"::text AS writer FROM "User" WHERE "demoExpiresAt" IS NOT NULL
       UNION SELECT DISTINCT "xmin"::text FROM "Seller" WHERE "id" = $1
       UNION SELECT DISTINCT "xmin"::text FROM "Product" WHERE "sellerId" = $1
       UNION SELECT DISTINCT "xmin"::text FROM "ProductVariant" WHERE "sellerId" = $1
       UNION SELECT DISTINCT "xmin"::text FROM "RefreshToken"`,
      [store?.id],
    )

    expect(rows).toHaveLength(1)

    // And the ledger came with it, so the store is reconcilable from its first
    // second rather than from its first stock edit.
    const ledger = await db.query(
      `SELECT 1 FROM "StockLedger" l JOIN "ProductVariant" v ON v."id" = l."variantId"
        WHERE v."sellerId" = $1`,
      [store?.id],
    )

    expect(ledger).toHaveLength(1)
  })
})

describe('초기 데이터 생성이 실패하면', () => {
  const db = useDatabase()

  /**
   * A seeder that writes and then fails, which is the only interesting shape.
   *
   * One that failed before writing anything would leave nothing behind whatever
   * the transaction boundary was, and the assertion would pass against a path
   * that commits each step separately.
   */
  const failing = {
    seed: async (_role: unknown, context: DemoSeedContext): Promise<void> => {
      await context.tx.address.create({
        data: {
          userId: context.userId,
          recipientName: '체험 구매자',
          phone: '010-0000-0000',
          postalCode: '06234',
          addressLine1: '서울특별시 강남구 테헤란로 1',
          isDefault: true,
          createdAt: context.now,
          updatedAt: context.now,
        },
      })

      throw new Error('초기 데이터 생성 실패')
    },
  }

  const api = useApiApp({
    database: db,
    overrides: [{ token: DemoSeedService, value: failing }],
  })

  it('계정도 역할도 세션도 남지 않는다', async () => {
    const response = await issue(api.baseUrl, 'BUYER', 'shop')

    expect(response.status).toBe(500)
    await response.text()

    expect(await db.query('SELECT 1 FROM "User"')).toHaveLength(0)
    expect(await db.query('SELECT 1 FROM "UserRole"')).toHaveLength(0)
    expect(await db.query('SELECT 1 FROM "Address"')).toHaveLength(0)
    expect(await db.query('SELECT 1 FROM "RefreshToken"')).toHaveLength(0)
  })
})
