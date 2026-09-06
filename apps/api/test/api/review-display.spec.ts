import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  reviewHelpfulResponseSchema,
  reviewListResponseSchema,
  reviewResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 리뷰 표시와 평점 집계 (TASK-0084), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 산술은 `review-console.spec.ts` 가 순수 함수로 잰다. **여기서 재는 것은 그 산술이
 * 실제 목록과 상품에 닿는가**이고, 값이 셋에 몰려 있다.
 *
 * - **평점이 리뷰를 따라 움직이는가** (F2 · F3). 안 움직이면 상품 목록의 별점이
 *   조용히 옛날 값으로 남는다 — 아무도 신고하지 않는 종류의 거짓말이다.
 * - **검색이 그것을 알게 되는가** (F4). 모르면 「평점순」 정렬이 옛날 순서를 준다.
 * - **도움돼요가 두 번 세어지지 않는가.** 세어지면 정렬 축 자체가 무너진다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'

let buyer: TestCaller
let other: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  buyer = { userId: (await createUser(db, { name: '홍길동' })).id, roles: ['BUYER'] }
  other = { userId: (await createUser(db, { name: '김철수' })).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 50 })
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

/** 산 것 하나. 배송완료까지. */
async function bought(userId: string): Promise<string> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const orderItemId = randomUUID()

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             10000, 10000, now())`,
    [orderId, `20260909-${String(sequence).padStart(8, '0')}`, userId],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "updatedAt")
     VALUES ($1, $2, $3, 'DELIVERED'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0, now())`,
    [sellerOrderId, orderId, store.seller.id],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "commissionRateBp", "updatedAt")
     VALUES ($1, $2, $3, $4, '{"optionLabel":"블랙 / M"}'::jsonb, 10000, 1, 10000, 1000, now())`,
    [orderItemId, sellerOrderId, store.variant.id, store.product.id],
  )
  await db.execute(
    `INSERT INTO "OrderStatusHistory"
       ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
     VALUES (gen_random_uuid(), $1, 'SHIPPED'::"SellerOrderStatus",
             'DELIVERED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", now())`,
    [sellerOrderId],
  )

  return orderItemId
}

async function write(
  caller: TestCaller,
  rating: number,
  imageKeys: string[] = [],
): Promise<string> {
  const orderItemId = await bought(caller.userId)
  const { review } = await client(caller).request({
    path: '/reviews',
    method: 'POST',
    body: { orderItemId, rating, content: '잘 받았습니다.', imageKeys },
    schema: reviewResponseSchema,
  })

  return review.id
}

interface Listed {
  readonly reviews: readonly {
    id: string
    rating: number
    helpfulCount: number
    helpfulByMe: boolean
  }[]
  readonly nextCursor: string | null
  readonly summary: {
    averageTimes100: number
    count: number
    photoCount: number
    buckets: readonly { rating: number; count: number; percentage: number }[]
  }
}

function list(caller: TestCaller | null, query = ''): Promise<Listed> {
  const target = caller === null ? api.client : client(caller)

  return target.request({
    path: `/products/${store.product.id}/reviews${query}`,
    schema: reviewListResponseSchema,
  })
}

function ratingOf(): Promise<{ ratingAvg: number; ratingCount: number }> {
  return db.one(`SELECT "ratingAvg", "ratingCount" FROM "Product" WHERE "id" = $1`, [
    store.product.id,
  ])
}

describe('평점 집계 (F2 · F3)', () => {
  it('리뷰를 쓰면 상품의 평점이 따라 움직인다', async () => {
    await write(buyer, 5)
    await write(other, 4)

    expect(await ratingOf()).toEqual({ ratingAvg: 450, ratingCount: 2 })
  })

  /** 파생값은 누적하지 않는다 — 처음부터 다시 센다. */
  it('리뷰를 고치면 다시 센다', async () => {
    const id = await write(buyer, 5)

    await client(buyer).request({
      path: `/reviews/${id}`,
      method: 'PATCH',
      body: { rating: 1, content: '다시 생각해 보니 별로예요.' },
      schema: reviewResponseSchema,
    })

    expect(await ratingOf()).toEqual({ ratingAvg: 100, ratingCount: 1 })
  })

  it('리뷰를 지우면 평균에서 빠진다 (F3)', async () => {
    const id = await write(buyer, 1)

    await write(other, 5)
    await client(buyer).request({
      path: `/reviews/${id}`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect(await ratingOf()).toEqual({ ratingAvg: 500, ratingCount: 1 })
  })

  /** `Product_rating_check` 가 「개수가 0이면 평균도 0」을 요구한다. */
  it('전부 지우면 0으로 돌아간다', async () => {
    const id = await write(buyer, 5)

    await client(buyer).request({
      path: `/reviews/${id}`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect(await ratingOf()).toEqual({ ratingAvg: 0, ratingCount: 0 })
  })

  /**
   * **검색이 낡은 평점을 주면 「평점순」 정렬이 옛날 순서를 준다** (F4).
   *
   * 사건은 리뷰의 트랜잭션 안에서 남는다 — 롤백되면 사건도 함께 사라지므로 없는
   * 변경이 인덱스에 반영되는 일이 없다.
   */
  it('검색 인덱스에 사건을 남긴다 (F4)', async () => {
    await write(buyer, 5)

    const events = await db.query<{ productId: string; kind: string }>(
      `SELECT "productId"::text AS "productId", "kind"::text AS "kind" FROM "SearchOutbox"`,
    )

    expect(events).toContainEqual({ productId: store.product.id, kind: 'UPSERT' })
  })
})

describe('목록 (F1)', () => {
  it('최신순이 기본이다', async () => {
    const first = await write(buyer, 5)
    const second = await write(other, 4)

    expect((await list(null)).reviews.map((review) => review.id)).toEqual([second, first])
  })

  it('평점순으로 정렬한다', async () => {
    await write(buyer, 3)

    const best = await write(other, 5)

    expect((await list(null, '?sort=rating')).reviews[0]?.id).toBe(best)
  })

  it('한 장씩 넘긴다', async () => {
    const first = await write(buyer, 5)
    const second = await write(other, 4)

    const page = await list(null, '?limit=1')

    expect(page.reviews.map((review) => review.id)).toEqual([second])
    expect(page.nextCursor).not.toBeNull()

    const next = await list(null, `?limit=1&cursor=${page.nextCursor ?? ''}`)

    expect(next.reviews.map((review) => review.id)).toEqual([first])
    expect(next.nextCursor).toBeNull()
  })

  /** 조용히 첫 페이지로 되돌리면 화면이 1페이지를 무한히 반복한다. */
  it('깨진 커서는 400 이다', async () => {
    await expect(list(null, '?cursor=not-a-cursor')).rejects.toBeInstanceOf(ApiClientError)
  })

  it('지워진 리뷰는 목록에 없다', async () => {
    const id = await write(buyer, 5)

    await client(buyer).request({
      path: `/reviews/${id}`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect((await list(null)).reviews).toEqual([])
  })
})

describe('평점 분포와 사진 (F1 · F6)', () => {
  function key(owner: string, index: number): string {
    return `reviews/${owner}/0192f0c1-0000-7000-8000-00000000000${String(index)}.jpg`
  }

  it('별 다섯부터 하나까지 다섯 칸을 답하고, 비율의 합이 100이다', async () => {
    await write(buyer, 5)
    await write(other, 3)

    const { summary } = await list(null)

    expect(summary.count).toBe(2)
    expect(summary.averageTimes100).toBe(400)
    expect(summary.buckets.map((bucket) => bucket.rating)).toEqual([5, 4, 3, 2, 1])
    expect(summary.buckets.reduce((sum, bucket) => sum + bucket.percentage, 0)).toBe(100)
  })

  it('사진이 있는 리뷰만 거를 수 있다 (F6)', async () => {
    const withPhoto = await write(buyer, 5, [key(buyer.userId, 1)])

    await write(other, 4)

    const filtered = await list(null, '?photoOnly=true')

    expect(filtered.reviews.map((review) => review.id)).toEqual([withPhoto])
    // **분포는 필터와 무관하다** — 「사진만」을 켜도 이 상품의 별점 분포는 그대로다.
    expect(filtered.summary.count).toBe(2)
    expect(filtered.summary.photoCount).toBe(1)
  })
})

describe('도움돼요', () => {
  function vote(
    caller: TestCaller,
    id: string,
    method: 'POST' | 'DELETE',
  ): Promise<{
    helpfulCount: number
    helpfulByMe: boolean
  }> {
    return client(caller).request({
      path: `/reviews/${id}/helpful`,
      method,
      schema: reviewHelpfulResponseSchema,
    })
  }

  it('누르면 세어지고, 내가 눌렀다고 답한다', async () => {
    const id = await write(buyer, 5)

    expect(await vote(other, id, 'POST')).toEqual({ helpfulCount: 1, helpfulByMe: true })
  })

  /** 두 번 세어지면 「도움순」 정렬 축 자체가 무너진다. */
  it('두 번 눌러도 한 번이다', async () => {
    const id = await write(buyer, 5)

    await vote(other, id, 'POST')

    expect(await vote(other, id, 'POST')).toEqual({ helpfulCount: 1, helpfulByMe: true })
  })

  it('무르면 다시 0이다', async () => {
    const id = await write(buyer, 5)

    await vote(other, id, 'POST')

    expect(await vote(other, id, 'DELETE')).toEqual({ helpfulCount: 0, helpfulByMe: false })
  })

  it('누른 적 없는 것을 물러도 아무 일이 없다', async () => {
    const id = await write(buyer, 5)

    expect(await vote(other, id, 'DELETE')).toEqual({ helpfulCount: 0, helpfulByMe: false })
  })

  it('도움순으로 정렬한다', async () => {
    await write(buyer, 5)

    const helpful = await write(other, 4)

    await vote(buyer, helpful, 'POST')

    expect((await list(null, '?sort=helpful')).reviews[0]?.id).toBe(helpful)
  })

  /** 로그인하지 않은 사람에게 「내가 눌렀는가」는 뜻이 없다. */
  it('로그인하지 않으면 언제나 누르지 않은 것으로 답한다', async () => {
    const id = await write(buyer, 5)

    await vote(other, id, 'POST')

    const [review] = (await list(null)).reviews

    expect(review).toMatchObject({ helpfulCount: 1, helpfulByMe: false })
  })

  it('로그인하면 내가 누른 것이 눌린 채로 온다', async () => {
    const id = await write(buyer, 5)

    await vote(other, id, 'POST')

    const [review] = (await list(other)).reviews

    expect(review).toMatchObject({ helpfulCount: 1, helpfulByMe: true })
  })
})
