import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { sellerRevenueResponseSchema, settlementOutlookResponseSchema } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 매출 집계의 A1 · A5 (TASK-0082 F7).
 *
 * **집계는 조용히 무거워진다.** 주문이 500건일 때 300ms 안에 끝나던 화면이 5,000건에서
 * 3초가 되는 것은 결함으로 보이지 않고 「데이터가 많아서」로 보인다. 그리고 그때는
 * 이미 판매자가 매일 여는 화면이다.
 *
 * A5 가 여기서 재는 것은 **문장 수가 주문 수에 따라 늘지 않는가**이다. 늘어나는
 * 방식은 하나뿐이고, 그것은 판매자 몫을 하나씩 읽어 합계를 코드에서 더하는 모양으로
 * 되돌아가는 것이다.
 */

const db = useDatabase()

const statements: string[] = []

const observable = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db.url, max: 5 }),
  log: [{ emit: 'event', level: 'query' }],
})

;(
  observable as unknown as {
    $on: (event: 'query', listener: (payload: { query: string }) => void) => void
  }
).$on('query', (payload) => statements.push(payload.query))

const api = useApiApp({ database: db, authenticate: true, prisma: observable })

afterAll(async () => {
  await observable.$disconnect()
})

const NOW = '2026-09-09T05:00:00.000Z'

/** A1 의 문턱. QUALITY-GATES 3장. */
const P95_BUDGET_MS = 300

const SAMPLES = 20

/** TASK-0082 F7 의 기준 규모. */
const ORDERS = 500

let seller: TestCaller
let sellerId: string

beforeEach(async () => {
  api.clock.set(NOW)

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  sellerId = store.id
  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
})

/**
 * 30일에 걸친 주문 `ORDERS` 건을 한 번에 심는다.
 *
 * 한 건씩 라우트를 태우면 이 준비만 몇 분이 되고, 그것은 **재는 것과 상관없는
 * 비용**이다. 집계가 읽는 칸만 정확히 심는다.
 */
async function seedOrders(): Promise<void> {
  const { variant, product } = await createSellableVariant(db, { stock: 1 })
  const buyer = await createUser(db)
  const orderIds: string[] = []
  const sellerOrderIds: string[] = []
  const days: number[] = []

  for (let index = 0; index < ORDERS; index += 1) {
    orderIds.push(randomUUID())
    sellerOrderIds.push(randomUUID())
    days.push(index % 30)
  }

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     SELECT id, '20260908-' || lpad(ordinality::text, 8, '0'), $2, gen_random_uuid(),
            '홍길동', '010-0000-0000', '06234', '서울시 강남구', 10000, 10000, now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)`,
    [orderIds, buyer.id],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "createdAt", "updatedAt")
     SELECT s.id, o.id, $3, 'CONFIRMED'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0,
            $4::timestamptz - make_interval(days => d.day), now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS s(id, position)
       JOIN unnest($2::uuid[]) WITH ORDINALITY AS o(id, position) ON o.position = s.position
       JOIN unnest($5::int[])  WITH ORDINALITY AS d(day, position) ON d.position = s.position`,
    [sellerOrderIds, orderIds, sellerId, NOW, days],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productSnapshot", "unitPrice", "quantity",
        "productAmount", "commissionRateBp", "updatedAt")
     SELECT gen_random_uuid(), s.id, $2, $3::jsonb, 10000, 1, 10000, 1000, now()
       FROM unnest($1::uuid[]) AS s(id)`,
    [sellerOrderIds, variant.id, JSON.stringify({ productId: product.id, productName: '울 코트' })],
  )
  await db.execute(
    `INSERT INTO "OrderStatusHistory"
       ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
     SELECT gen_random_uuid(), s.id, 'DELIVERED'::"SellerOrderStatus",
            'CONFIRMED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", now()
       FROM unnest($1::uuid[]) AS s(id)`,
    [sellerOrderIds],
  )
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)

  return sorted[index] ?? 0
}

describe('A1 — 응답 시간 (F7)', () => {
  it('주문 500건에서 매출 집계가 300ms 안에 끝난다', async () => {
    await seedOrders()

    const client = api.clientAs(seller)
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await client.request({ path: '/seller-revenue', schema: sellerRevenueResponseSchema })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(P95_BUDGET_MS)
  })

  it('주문 500건에서 정산 예정 금액이 300ms 안에 끝난다', async () => {
    await seedOrders()

    const client = api.clientAs(seller)
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await client.request({
        path: '/seller-settlement-outlook',
        schema: settlementOutlookResponseSchema,
      })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(P95_BUDGET_MS)
  })
})

describe('A5 — 문장 수', () => {
  /**
   * **주문 수가 문장 수를 바꾸지 않는다.** 바뀐다면 합계를 SQL 이 아니라 코드에서
   * 더하고 있다는 뜻이고, 그 모양은 규모가 커질수록 조용히 느려진다.
   */
  it('매출 집계의 문장 수가 주문 수에 따라 늘지 않는다', async () => {
    const client = api.clientAs(seller)
    const empty = await recordStatements(statements, () =>
      client.request({ path: '/seller-revenue', schema: sellerRevenueResponseSchema }),
    )

    await seedOrders()

    const loaded = await recordStatements(statements, () =>
      client.request({ path: '/seller-revenue', schema: sellerRevenueResponseSchema }),
    )

    expect(loaded).toHaveLength(empty.length)
  })
})
