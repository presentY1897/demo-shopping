import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { productListResponseSchema, reviewListResponseSchema } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 리뷰가 목록을 무겁게 하지 않는가 (TASK-0084 F7 · A1 · A5).
 *
 * **집계를 조회할 때 하면 상품 목록이 N+1 이 된다.** 상품 20개짜리 한 장이 리뷰
 * 집계를 스무 번 하고, 그 비용은 리뷰가 쌓일수록 커진다 — 그런데 화면은 멀쩡히
 * 그려지므로 아무도 신고하지 않는다.
 *
 * 그래서 평점은 **리뷰가 바뀔 때** `Product` 에 적히고, 목록은 그 컬럼을 읽는다.
 * 아래는 그 구조가 실제로 서 있는지를 **문장 수**로 잰다.
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

const NOW = '2026-09-10T00:00:00.000Z'

/** A1 의 문턱. QUALITY-GATES 3장. */
const P95_BUDGET_MS = 300

const SAMPLES = 20

/** 한 상품에 쌓아 볼 리뷰의 수. */
const REVIEWS = 50

let operator: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>

beforeEach(async () => {
  api.clock.set(NOW)

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  store = await createSellableVariant(db, { stock: 100 })
})

/**
 * 리뷰 `REVIEWS` 건을 한 번에 심는다.
 *
 * 라우트를 한 건씩 태우면 이 준비만 몇 분이 되고, 그것은 **재는 것과 상관없는
 * 비용**이다. 목록이 읽는 칸만 정확히 심는다.
 */
async function seedReviews(): Promise<void> {
  const buyer = await createUser(db)
  const orderId = randomUUID()
  const sellerOrderId = randomUUID()

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, '20260909-00000001', $2, gen_random_uuid(), '홍길동', '010-0000-0000',
             '06234', '서울시 강남구', 10000, 10000, now())`,
    [orderId, buyer.id],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "updatedAt")
     VALUES ($1, $2, $3, 'DELIVERED'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0, now())`,
    [sellerOrderId, orderId, store.seller.id],
  )

  const orderItemIds = Array.from({ length: REVIEWS }, () => randomUUID())

  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "commissionRateBp", "updatedAt")
     SELECT id, $2, $3, $4, '{"optionLabel":"블랙 / M"}'::jsonb, 10000, 1, 10000, 1000, now()
       FROM unnest($1::uuid[]) AS t(id)`,
    [orderItemIds, sellerOrderId, store.variant.id, store.product.id],
  )
  await db.execute(
    `INSERT INTO "Review"
       ("id", "orderItemId", "productId", "userId", "rating", "content", "updatedAt")
     SELECT gen_random_uuid(), id, $2, $3, 1 + (ordinality % 5), '괜찮아요', now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)`,
    [orderItemIds, store.product.id, buyer.id],
  )
  await db.execute(
    `UPDATE "Product"
        SET "ratingCount" = $2,
            "ratingAvg" = (SELECT ROUND(AVG("rating") * 100)::int FROM "Review"
                            WHERE "productId" = $1)
      WHERE "id" = $1`,
    [store.product.id, REVIEWS],
  )
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)

  return sorted[index] ?? 0
}

describe('A5 — 상품 목록의 N+1 (F7)', () => {
  /**
   * **리뷰 수가 상품 목록의 문장 수를 바꾸지 않는다.**
   *
   * 바뀐다면 목록이 평점을 그 자리에서 세고 있다는 뜻이고, 그 모양은 리뷰가 쌓일수록
   * 조용히 느려진다.
   */
  it('리뷰가 쌓여도 상품 목록의 문장 수가 그대로다', async () => {
    const client = api.clientAs(operator)
    const empty = await recordStatements(statements, () =>
      client.request({ path: '/products?limit=20', schema: productListResponseSchema }),
    )

    await seedReviews()

    const loaded = await recordStatements(statements, () =>
      client.request({ path: '/products?limit=20', schema: productListResponseSchema }),
    )

    expect(loaded).toHaveLength(empty.length)
  })

  /** 리뷰 목록 자체도 리뷰 수에 따라 문장이 늘지 않는다 — 사진과 투표가 조인이다. */
  it('리뷰 목록의 문장 수가 리뷰 수에 따라 늘지 않는다', async () => {
    const path = `/products/${store.product.id}/reviews?limit=10`
    const empty = await recordStatements(statements, () =>
      api.client.request({ path, schema: reviewListResponseSchema }),
    )

    await seedReviews()

    const loaded = await recordStatements(statements, () =>
      api.client.request({ path, schema: reviewListResponseSchema }),
    )

    expect(loaded).toHaveLength(empty.length)
  })
})

describe('A1 — 응답 시간', () => {
  it('리뷰 50건짜리 상품의 리뷰 목록이 300ms 안에 끝난다', async () => {
    await seedReviews()

    const path = `/products/${store.product.id}/reviews?limit=10`
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await api.client.request({ path, schema: reviewListResponseSchema })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(P95_BUDGET_MS)
  })
})
