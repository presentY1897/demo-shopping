import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  adminOrderPaymentsResponseSchema,
  adminOrderSearchResponseSchema,
  adminSellerListResponseSchema,
  demoAccountListResponseSchema,
  demoPolicyResponseSchema,
  demoStatsResponseSchema,
  productListResponseSchema,
  productModerationResponseSchema,
  sellerStatusHistoryResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 판매자 관리 · 전체 조회 · 데모 관리 (TASK-0094 · 0095 · 0096).
 *
 * **가장 중요한 검사 셋.**
 *
 * - **클레임률이 0건짜리 스토어를 맨 위로 올리지 않는가** (0094 F2). 0으로 두면
 *   신규 스토어가 「문제 없는 스토어」로 목록의 머리에 온다.
 * - **강제 숨김이 검색에서도 빠지는가** (0095 F2). 목록에는 없는데 검색으로 나오면
 *   그것은 안 가려진 것이다.
 * - **강제 만료가 지우지 않는가** (0096 F2). 지우는 순서를 아는 곳은 청소기뿐이다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-20T05:00:00.000Z'

let operator: TestCaller
let superAdmin: TestCaller
let buyer: TestCaller
let sellerId: string
let quietSellerId: string
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  superAdmin = { userId: (await createUser(db)).id, roles: ['ADMIN_SUPER'] }
  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }

  store = await createSellableVariant(db, { stock: 50 })
  // 내릴 수 있는 것은 **판매 중인 상품**뿐이다. 초안을 내려 봐야 아무 일도 안 나므로
  // 먼저 진열 상태로 만든다.
  await db.execute(
    `UPDATE "Product" SET "status" = 'ACTIVE'::"ProductStatus", "minPrice" = 10000 WHERE "id" = $1`,
    [store.product.id],
  )
  sellerId = store.seller.id
  quietSellerId = (await createSeller(db, { userId: (await createUser(db)).id })).id
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

async function seedOrder(options: { claim?: boolean } = {}): Promise<string> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             10000, 10000, now())`,
    [orderId, `20260920-${String(sequence).padStart(8, '0')}`, buyer.userId],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'CONFIRMED'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0,
             $4::timestamptz, now())`,
    [sellerOrderId, orderId, sellerId, NOW],
  )

  if (options.claim === true) {
    await db.execute(
      `INSERT INTO "ClaimRequest"
         ("id", "sellerOrderId", "requestedById", "type", "status", "reason", "fault", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'CANCEL'::"ClaimType",
               'CANCEL_REQUESTED'::"ClaimStatus", '단순 변심', 'CUSTOMER'::"ClaimFault", now())`,
      [sellerOrderId, buyer.userId],
    )
  }

  return orderId
}

function sellers(caller: TestCaller, query = '') {
  return client(caller).request({
    path: `/admin/stores${query}`,
    schema: adminSellerListResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<number> {
  try {
    await work
  } catch (error) {
    if (error instanceof ApiClientError && error.status !== undefined) return error.status

    throw error
  }

  throw new Error('실패했어야 하는 요청이 성공했습니다.')
}

describe('판매자 지표 (TASK-0094 F1 · F2 · F7)', () => {
  it('counts sales, claims and products for every store in one answer', async () => {
    await seedOrder()
    await seedOrder({ claim: true })

    const row = (await sellers(operator)).sellers.find((entry) => entry.sellerId === sellerId)

    expect(row?.metrics).toMatchObject({
      salesAmount: 20_000,
      orderCount: 2,
      claimCount: 1,
      // 2건 중 1건 = 50% = 5000bp. **정수 100배다** — 소수를 실으면 화면마다
      // 반올림이 달라진다.
      claimRateBp: 5_000,
    })
  })

  /**
   * **주문이 없으면 `null` 이다.** 0이 아니다 — 「클레임이 한 건도 없는 좋은
   * 스토어」와 「아직 아무것도 안 판 스토어」는 다른 사실이고, 0으로 두면 신규
   * 스토어가 목록의 맨 위에 올라온다.
   */
  it('says nothing rather than zero for a store that has not sold', async () => {
    const row = (await sellers(operator)).sellers.find((entry) => entry.sellerId === quietSellerId)

    expect(row?.metrics.claimRateBp).toBeNull()
    expect(row?.metrics.orderCount).toBe(0)
  })

  it('sorts by claim rate without letting the untraded store to the top', async () => {
    await seedOrder({ claim: true })

    const [first] = (await sellers(operator, '?sort=claimRate')).sellers

    expect(first?.sellerId).toBe(sellerId)
  })

  it('marks a demo store so its numbers are not read as real ones', async () => {
    const demoOwner = await createUser(db, { isDemo: true })

    await createSeller(db, { userId: demoOwner.id })

    const rows = (await sellers(operator, '?isDemo=true')).sellers

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.isDemo)).toBe(true)
  })
})

describe('제재 이력 (TASK-0094 F6)', () => {
  /**
   * `Seller` 는 지금 상태만 들고 있어 정지와 해제를 반복하면 앞의 것이 덮인다 —
   * 그러면 반복 위반과 한 번의 실수를 구별할 수 없다.
   */
  it('keeps every move, so repeating a suspension is visible', async () => {
    await db.execute(`UPDATE "Seller" SET "status" = 'PENDING'::"SellerStatus" WHERE "id" = $1`, [
      quietSellerId,
    ])

    await client(superAdmin).request({
      path: `/admin/sellers/${quietSellerId}/approve`,
      method: 'POST',
      body: { version: 0 },
      schema: z.unknown(),
    })
    await client(superAdmin).request({
      path: `/admin/sellers/${quietSellerId}/suspend`,
      method: 'POST',
      body: { version: 1, reason: '반복 신고' },
      schema: z.unknown(),
    })

    const { events } = await client(operator).request({
      path: `/admin/stores/${quietSellerId}/history`,
      schema: sellerStatusHistoryResponseSchema,
    })

    expect(events.map((event) => event.toStatus)).toEqual(['SUSPENDED', 'ACTIVE'])
    expect(events[0]).toMatchObject({ fromStatus: 'ACTIVE', reason: '반복 신고' })
  })
})

describe('상품 강제 숨김 (TASK-0095 F2 · F3 · F8)', () => {
  function hide(caller: TestCaller, reason = '판매 중단 요청') {
    return client(caller).request({
      path: `/admin/products/${store.product.id}/hidden`,
      method: 'POST',
      body: { reason },
      schema: productModerationResponseSchema,
    })
  }

  it('stops the sale and writes why, and who', async () => {
    const answer = await hide(superAdmin, '위조품 신고 확인')

    expect(answer.product).toMatchObject({ hidden: true, moderationReason: '위조품 신고 확인' })

    const [row] = await db.query<{ status: string; moderatedById: string }>(
      `SELECT "status"::text AS "status", "moderatedById" FROM "Product" WHERE "id" = $1`,
      [store.product.id],
    )

    expect(row).toMatchObject({ status: 'SUSPENDED', moderatedById: superAdmin.userId })
  })

  /** **목록에는 없는데 검색에는 남으면 그것은 안 가려진 것이다.** */
  it('tells the search index to drop it', async () => {
    await hide(superAdmin)

    const [row] = await db.query<{ kind: string }>(
      `SELECT "kind"::text AS "kind" FROM "SearchOutbox" WHERE "productId" = $1
        ORDER BY "id" DESC LIMIT 1`,
      [store.product.id],
    )

    expect(row?.kind).toBe('REMOVE')
  })

  /** 초안은 이미 안 팔리고 있다 — 내릴 것이 없다. */
  it('refuses to hide something that is not on sale', async () => {
    await db.execute(`UPDATE "Product" SET "status" = 'DRAFT'::"ProductStatus" WHERE "id" = $1`, [
      store.product.id,
    ])

    expect(await failure(hide(superAdmin))).toBe(409)
  })

  it('refuses to hide without a reason', async () => {
    expect(
      await failure(
        client(superAdmin).request({
          path: `/admin/products/${store.product.id}/hidden`,
          method: 'POST',
          body: { reason: '   ' },
          schema: productModerationResponseSchema,
        }),
      ),
    ).toBe(400)
  })

  it('puts it back on sale and clears the record', async () => {
    await hide(superAdmin)

    const answer = await client(superAdmin).request({
      path: `/admin/products/${store.product.id}/hidden`,
      method: 'DELETE',
      schema: productModerationResponseSchema,
    })

    expect(answer.product).toMatchObject({ hidden: false, moderationReason: null })
  })

  /** 데모 관리자는 `catalog.write` 가 `demo` 로 좁혀져 있다 (D-058). */
  it('refuses a demo admin on a real account’s product', async () => {
    const demoAdmin: TestCaller = {
      userId: (await createUser(db, { isDemo: true })).id,
      roles: ['DEMO_ADMIN'],
    }

    expect(await failure(hide(demoAdmin))).toBe(403)
  })
})

describe('전체 상품 검색 (TASK-0095 2장)', () => {
  /**
   * **검색 엔진이 대신할 수 없다.** 색인은 `ACTIVE` 만 담으므로(TASK-0038), 관리자가
   * 정작 찾으려는 것 — 초안이거나 강제로 내려진 상품 — 은 거기 없다. 이 목록은
   * 데이터베이스를 직접 보므로 상태와 무관하게 찾는다.
   */
  it('finds a listing that is not on sale, which the index cannot', async () => {
    await db.execute(
      `UPDATE "Product" SET "name" = '숨겨진 코트', "status" = 'DRAFT'::"ProductStatus"
        WHERE "id" = $1`,
      [store.product.id],
    )

    const answer = await client(operator).request({
      path: '/products?q=숨겨진',
      schema: productListResponseSchema,
    })

    expect(answer.products.map((item) => item.name)).toEqual(['숨겨진 코트'])
  })

  /** 이스케이프하지 않으면 「50%」로 찾는 사람이 전부를 받고, 필터가 조용히 사라진다. */
  it('treats a percent sign as a character, not a wildcard', async () => {
    await db.execute(`UPDATE "Product" SET "name" = '50% 할인 코트' WHERE "id" = $1`, [
      store.product.id,
    ])

    const hit = await client(operator).request({
      path: `/products?q=${encodeURIComponent('50%')}`,
      schema: productListResponseSchema,
    })
    const miss = await client(operator).request({
      path: `/products?q=${encodeURIComponent('9%')}`,
      schema: productListResponseSchema,
    })

    expect(hit.products).toHaveLength(1)
    expect(miss.products).toEqual([])
  })

  /**
   * 되돌리는 화면이 **왜 내려졌는지** 볼 수 있어야 한다. 없으면 운영자는 누가 왜
   * 내렸는지 모른 채 그 판단을 무르게 되고, 그것은 되돌리기가 아니라 덮어쓰기다.
   */
  it('carries the moderation reason into the list', async () => {
    await client(superAdmin).request({
      path: `/admin/products/${store.product.id}/hidden`,
      method: 'POST',
      body: { reason: '위조품 신고 확인' },
      schema: productModerationResponseSchema,
    })

    const answer = await client(operator).request({
      path: '/products?status=SUSPENDED',
      schema: productListResponseSchema,
    })

    expect(answer.products[0]).toMatchObject({ moderationReason: '위조품 신고 확인' })
    expect(answer.products[0]?.moderatedAt).not.toBeNull()
  })
})

describe('주문 조회 (TASK-0095 F4 · F5 · F6)', () => {
  it('finds an order by its number, with every seller bundle', async () => {
    const orderId = await seedOrder()
    const [order] = await db.query<{ orderNumber: string }>(
      `SELECT "orderNumber" FROM "Order" WHERE "id" = $1`,
      [orderId],
    )

    const answer = await client(operator).request({
      path: `/admin/orders?orderNumber=${order?.orderNumber ?? ''}`,
      schema: adminOrderSearchResponseSchema,
    })

    expect(answer.orders).toHaveLength(1)
    expect(answer.orders[0]?.sellerOrders).toHaveLength(1)
    // 훑어보는 화면이라 산 사람은 가려서 나간다.
    expect(answer.orders[0]?.maskedBuyerName).not.toBe('홍길동')
  })

  it('answers the payment and refund trail', async () => {
    const orderId = await seedOrder()

    await db.execute(
      `INSERT INTO "Payment"
         ("id", "orderId", "provider", "status", "authorizedAmount", "canceledAmount", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'VIRTUAL_CARD'::"PaymentProviderName",
               'PAID'::"PaymentStatus", 10000, 4000, now())`,
      [orderId],
    )

    const answer = await client(operator).request({
      path: `/admin/orders/${orderId}/payments`,
      schema: adminOrderPaymentsResponseSchema,
    })

    expect(answer.payments).toHaveLength(1)
    expect(answer.refundedAmount).toBe(4_000)
  })

  it('refuses a buyer, whose order.read is their own', async () => {
    expect(
      await failure(
        client(buyer).request({ path: '/admin/orders', schema: adminOrderSearchResponseSchema }),
      ),
    ).toBe(403)
  })
})

describe('데모 관리 (TASK-0096)', () => {
  function policy(caller: TestCaller) {
    return client(caller).request({ path: '/admin/demo/policy', schema: demoPolicyResponseSchema })
  }

  it('answers the policy the migration seeded', async () => {
    expect((await policy(operator)).policy).toEqual({
      ttlHours: 24,
      seedOrders: 3,
      virtualCardLimit: 5_000_000,
    })
  })

  /** **이후 발급분에만 적용된다.** 쓰고 있던 사람의 데모가 눈앞에서 사라지면 사고다. */
  it('changes the lifetime without touching the accounts already issued', async () => {
    const existing = await createUser(db, { isDemo: true })

    await client(superAdmin).request({
      path: '/admin/demo/policy',
      method: 'PUT',
      body: { ttlHours: 1, seedOrders: 0, virtualCardLimit: 10_000 },
      schema: demoPolicyResponseSchema,
    })

    expect((await policy(operator)).policy.ttlHours).toBe(1)

    const [row] = await db.query<{ demoExpiresAt: Date }>(
      `SELECT "demoExpiresAt" FROM "User" WHERE "id" = $1`,
      [existing.id],
    )

    // 앞서 발급된 계정의 만료는 그대로다.
    expect(row?.demoExpiresAt).not.toBeNull()
  })

  it('refuses a lifetime the database would refuse anyway', async () => {
    expect(
      await failure(
        client(superAdmin).request({
          path: '/admin/demo/policy',
          method: 'PUT',
          body: { ttlHours: 0, seedOrders: 3, virtualCardLimit: 5_000_000 },
          schema: demoPolicyResponseSchema,
        }),
      ),
    ).toBe(400)
  })

  it('lists demo accounts and the ones whose cleanup failed', async () => {
    const failed = await createUser(db, { isDemo: true })

    await db.execute(
      `UPDATE "User" SET "demoCleanupFailedAt" = now(), "demoCleanupError" = $2 WHERE "id" = $1`,
      [failed.id, '외래키 위반'],
    )

    const all = await client(operator).request({
      path: '/admin/demo/accounts',
      schema: demoAccountListResponseSchema,
    })
    const only = await client(operator).request({
      path: '/admin/demo/accounts?failedOnly=true',
      schema: demoAccountListResponseSchema,
    })

    expect(all.accounts.length).toBeGreaterThanOrEqual(1)
    expect(only.accounts).toHaveLength(1)
    expect(only.accounts[0]).toMatchObject({ userId: failed.id, cleanupError: '외래키 위반' })
  })

  /** 지우지 않는다 — **만료 시각을 당긴다.** 지우는 순서를 아는 곳은 청소기뿐이다. */
  it('force-expires by moving the expiry, not by deleting', async () => {
    const account = await createUser(db, { isDemo: true })

    await client(superAdmin).request({
      path: `/admin/demo/accounts/${account.id}/expiry`,
      method: 'POST',
      schema: z.unknown(),
    })

    const [row] = await db.query<{ deletedAt: Date | null }>(
      `SELECT "deletedAt" FROM "User" WHERE "id" = $1`,
      [account.id],
    )

    expect(row).toBeDefined()
    expect(row?.deletedAt).toBeNull()
  })

  it('answers issuing statistics on both axes', async () => {
    await createUser(db, { isDemo: true })

    const stats = await client(operator).request({
      path: '/admin/demo/stats',
      schema: demoStatsResponseSchema,
    })

    expect(stats.days.length).toBeGreaterThan(0)
    expect(stats.activeAccounts).toBeGreaterThan(0)
  })

  it('refuses a buyer', async () => {
    expect(await failure(policy(buyer))).toBe(403)
  })
})
