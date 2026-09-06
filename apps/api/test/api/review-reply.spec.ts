import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  reviewListResponseSchema,
  reviewReplyResponseSchema,
  reviewResponseSchema,
  sellerProductReviewsResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 판매자의 리뷰 답변 (TASK-0085), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **자격의 출처가 리뷰가 아니라 상품이다.** 리뷰는 산 사람의 것이지만 답할 자격은
 * 판 사람의 것이고, 그 둘을 잇는 것이 상품이다 — 아래 검사들이 재는 것은 그 선이
 * 실제로 그어져 있는가다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'

let buyer: TestCaller
let seller: TestCaller
let rival: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  buyer = { userId: (await createUser(db, { name: '홍길동' })).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 20 })
  seller = {
    userId: (
      await db.one<{ userId: string }>(`SELECT "userId" FROM "Seller" WHERE "id" = $1`, [
        store.seller.id,
      ])
    ).userId,
    roles: ['SELLER_OWNER'],
    sellerId: store.seller.id,
  }

  const other = await createUser(db)
  const otherStore = await createSeller(db, { userId: other.id })

  rival = { userId: other.id, roles: ['SELLER_OWNER'], sellerId: otherStore.id }
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

/** 산 것에 리뷰 하나. */
async function reviewed(rating = 5): Promise<string> {
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
    [orderId, `20260909-${String(sequence).padStart(8, '0')}`, buyer.userId],
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

  const { review } = await client(buyer).request({
    path: '/reviews',
    method: 'POST',
    body: { orderItemId, rating, content: '잘 받았습니다.' },
    schema: reviewResponseSchema,
  })

  return review.id
}

function reply(
  caller: TestCaller,
  reviewId: string,
  content = '이용해 주셔서 감사합니다.',
): Promise<{ reply: { content: string; brandName: string } }> {
  return client(caller).request({
    path: `/reviews/${reviewId}/reply`,
    method: 'PUT',
    body: { content },
    schema: reviewReplyResponseSchema,
  })
}

function console_(
  caller: TestCaller,
  sellerId: string,
  query = '',
): Promise<{
  reviews: readonly { id: string; rating: number; reply: { content: string } | null }[]
  unansweredCount: number
}> {
  return client(caller).request({
    path: `/seller-product-reviews?sellerId=${sellerId}${query}`,
    schema: sellerProductReviewsResponseSchema,
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

describe('답변 (F1 · F2 · F3)', () => {
  it('자기 상품 리뷰에 답한다', async () => {
    const id = await reviewed()
    const { reply: written } = await reply(seller, id)

    expect(written.content).toBe('이용해 주셔서 감사합니다.')
    expect(written.brandName).toBeTruthy()
  })

  /** 리뷰는 공개다 — 존재를 숨길 것이 없는 자리에서 404 를 주면 거짓말이 된다. */
  it('남의 상품 리뷰에는 답할 수 없다 (F2)', async () => {
    const id = await reviewed()

    expect(await failure(reply(rival, id))).toBe(403)
  })

  it('구매자는 답할 수 없다', async () => {
    const id = await reviewed()

    expect(await failure(reply(buyer, id))).toBe(403)
  })

  /** 두 번째 답변이 저장될 자리가 없다 — 기본키가 리뷰의 id 그 자체다. */
  it('두 번 쓰면 고쳐진다 (F3)', async () => {
    const id = await reviewed()

    await reply(seller, id, '처음 답변')

    const second = await reply(seller, id, '고친 답변')
    const rows = await db.query<{ content: string }>(
      `SELECT "content" FROM "ReviewReply" WHERE "reviewId" = $1`,
      [id],
    )

    expect(second.reply.content).toBe('고친 답변')
    expect(rows).toHaveLength(1)
  })

  it('빈 답변은 거절한다', async () => {
    const id = await reviewed()

    expect(await failure(reply(seller, id, '   '))).toBe(400)
  })

  it('지우면 리뷰는 남고 답변만 사라진다', async () => {
    const id = await reviewed()

    await reply(seller, id)
    await client(seller).request({
      path: `/reviews/${id}/reply`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect((await console_(seller, store.seller.id)).reviews[0]?.reply).toBeNull()
  })
})

describe('상품 상세에 함께 온다 (F4)', () => {
  /** 따로 받으면 리뷰 한 장마다 요청이 하나씩 늘고, 그것이 바로 N+1 이다. */
  it('리뷰 목록에 답변이 실린다', async () => {
    const id = await reviewed()

    await reply(seller, id, '감사합니다!')

    const { reviews } = await api.client.request({
      path: `/products/${store.product.id}/reviews`,
      schema: reviewListResponseSchema,
    })

    expect(reviews[0]?.reply?.content).toBe('감사합니다!')
  })
})

describe('관리 목록 (F5 · F6 · F7)', () => {
  it('미답변이 위에 온다 (F5)', async () => {
    const answered = await reviewed()

    await reply(seller, answered)

    const pending = await reviewed()

    expect((await console_(seller, store.seller.id)).reviews[0]?.id).toBe(pending)
  })

  it('미답변만 볼 수 있다', async () => {
    const answered = await reviewed()

    await reply(seller, answered)

    const pending = await reviewed()
    const { reviews } = await console_(seller, store.seller.id, '&unansweredOnly=true')

    expect(reviews.map((review) => review.id)).toEqual([pending])
  })

  /** 대응이 필요한 리뷰를 먼저 찾는 것이 실제 사용 패턴이다 (4장). */
  it('낮은 평점만 거를 수 있다 (F6)', async () => {
    await reviewed(5)

    const bad = await reviewed(2)
    const { reviews } = await console_(seller, store.seller.id, '&maxRating=2')

    expect(reviews.map((review) => review.id)).toEqual([bad])
  })

  /** 뱃지는 「지금 화면에 몇 개」가 아니라 「할 일이 몇 개」다. */
  it('미답변 건수가 필터와 무관하다 (F7)', async () => {
    await reviewed(5)
    await reviewed(1)

    const filtered = await console_(seller, store.seller.id, '&maxRating=1')

    expect(filtered.reviews).toHaveLength(1)
    expect(filtered.unansweredCount).toBe(2)
  })

  it('답하면 미답변 건수가 준다', async () => {
    const id = await reviewed()

    await reply(seller, id)

    expect((await console_(seller, store.seller.id)).unansweredCount).toBe(0)
  })

  it('남의 스토어 목록은 볼 수 없다', async () => {
    expect(await failure(console_(rival, store.seller.id))).toBe(403)
  })
})
