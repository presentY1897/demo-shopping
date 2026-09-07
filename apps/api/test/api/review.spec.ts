import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  reviewableListResponseSchema,
  reviewResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  REVIEW_EDIT_WINDOW_DAYS,
  REVIEW_WRITE_WINDOW_DAYS,
} from '../../src/reviews/review-rules.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 리뷰 (TASK-0083), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **여기서 가장 중요한 검사는 「구매하지 않은 사람이 쓸 수 없다」가 아니다.** 그것은
 * 스키마가 이미 참으로 만들어 두었다 — 요청이 가리키는 것이 주문 항목이라, 사지 않은
 * 사람에게는 가리킬 것이 없다. 아래가 재는 것은 **그 구조가 실제로 서 있는가**이고,
 * 그래서 마지막 두 검사가 서비스를 통째로 건너뛰고 DB 에 직접 넣어 본다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1_000

let buyer: TestCaller
let stranger: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  buyer = { userId: (await createUser(db, { name: '홍길동' })).id, roles: ['BUYER'] }
  stranger = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 10 })
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function daysAgo(days: number): string {
  return new Date(new Date(NOW).getTime() - days * DAY_MS).toISOString()
}

interface Bought {
  readonly orderItemId: string
  readonly orderId: string
}

/**
 * 산 것 하나. 배송완료 이력까지 심는다.
 *
 * 체크아웃부터 걷지 않는 이유는 이 스펙이 재는 것이 그 앞이 아니어서다 — 그 길은
 * 자기 스펙이 이미 재고 있다.
 */
async function bought(
  options: {
    readonly userId?: string
    readonly status?: string
    readonly deliveredAt?: string | null
  } = {},
): Promise<Bought> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const orderItemId = randomUUID()
  const status = options.status ?? 'DELIVERED'

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             10000, 10000, now())`,
    [orderId, `20260909-${String(sequence).padStart(8, '0')}`, options.userId ?? buyer.userId],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "updatedAt")
     VALUES ($1, $2, $3, $4::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0, now())`,
    [sellerOrderId, orderId, store.seller.id, status],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "commissionRateBp", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::jsonb, 10000, 1, 10000, 1000, now())`,
    [
      orderItemId,
      sellerOrderId,
      store.variant.id,
      store.product.id,
      JSON.stringify({
        productId: store.product.id,
        productName: '울 코트',
        optionLabel: '블랙 / M',
        thumbnailUrl: 'https://cdn.test.invalid/coat.jpg',
      }),
    ],
  )

  const deliveredAt = options.deliveredAt === undefined ? daysAgo(1) : options.deliveredAt

  if (deliveredAt !== null) {
    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
       VALUES (gen_random_uuid(), $1, 'SHIPPED'::"SellerOrderStatus",
               'DELIVERED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", $2::timestamptz)`,
      [sellerOrderId, deliveredAt],
    )
  }

  return { orderItemId, orderId }
}

function write(
  caller: TestCaller,
  orderItemId: string,
  overrides: Record<string, unknown> = {},
): Promise<{
  review: {
    id: string
    rating: number
    authorName: string
    optionLabel: string | null
    images: readonly { key: string; url: string | null }[]
  }
}> {
  return client(caller).request({
    path: '/reviews',
    method: 'POST',
    body: { orderItemId, rating: 5, content: '따뜻하고 핏이 좋아요.', ...overrides },
    schema: reviewResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await work
  } catch (error) {
    if (error instanceof ApiClientError) {
      return { status: error.status ?? 0, code: error.code ?? '' }
    }

    throw error
  }

  throw new Error('실패했어야 하는 요청이 성공했습니다.')
}

describe('구매 검증 (F1 · F2)', () => {
  it('산 것에는 쓸 수 있다', async () => {
    const item = await bought()
    const { review } = await write(buyer, item.orderItemId)

    expect(review.rating).toBe(5)
    // 산 조합의 이름이 함께 온다 — 주문 시점의 스냅샷에서.
    expect(review.optionLabel).toBe('블랙 / M')
  })

  /**
   * **남의 주문 항목에는 403 이 아니라 404 다.** 403 을 주면 그 id 가 존재한다는
   * 사실을 알려 주는 것이 된다.
   */
  it('남의 주문 항목에는 쓸 수 없고, 있는지도 알려 주지 않는다', async () => {
    const item = await bought({ userId: stranger.userId })

    expect((await failure(write(buyer, item.orderItemId))).status).toBe(404)
  })

  it('없는 주문 항목도 같은 답이다', async () => {
    expect((await failure(write(buyer, randomUUID()))).status).toBe(404)
  })

  it('같은 항목에 두 번 쓸 수 없다', async () => {
    const item = await bought()

    await write(buyer, item.orderItemId)

    expect((await failure(write(buyer, item.orderItemId))).code).toBe('REVIEW_ALREADY_WRITTEN')
  })

  /**
   * **서비스를 통째로 건너뛰고 DB 에 직접 넣어 본다.**
   *
   * 이 검사가 이 TASK 의 설계 그 자체다 — 애플리케이션 검사는 우회 경로가 생기면
   * 뚫리지만, 유니크 제약은 어떤 경로로 들어와도 두 번째 행을 거절한다.
   */
  it('중복은 DB 가 막는다 — 코드를 지나지 않아도', async () => {
    const item = await bought()

    await write(buyer, item.orderItemId)

    await expect(
      db.execute(
        `INSERT INTO "Review" ("id", "orderItemId", "productId", "userId", "rating", "content",
                               "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 1, '두 번째', now())`,
        [item.orderItemId, store.product.id, buyer.userId],
      ),
    ).rejects.toThrow(/Review_orderItemId_key/u)
  })

  /**
   * **사지 않은 상품의 리뷰는 저장될 수 없다.** 상품 id 를 바꿔 넣으면 복합 외래키가
   * 가리킬 행을 찾지 못한다 — 「이 상품의 리뷰」가 조회 없이 참인 이유다.
   */
  it('주문 항목과 다른 상품을 가리키는 리뷰는 저장되지 않는다', async () => {
    const item = await bought()
    const other = await createSellableVariant(db, { stock: 1 })

    await expect(
      db.execute(
        `INSERT INTO "Review" ("id", "orderItemId", "productId", "userId", "rating", "content",
                               "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 5, '엉뚱한 상품', now())`,
        [item.orderItemId, other.product.id, buyer.userId],
      ),
    ).rejects.toThrow(/Review_orderItemId_productId_fkey/u)
  })
})

describe('시점 (F3)', () => {
  it.each([
    ['PAID', 'REVIEW_NOT_DELIVERED'],
    ['PREPARING', 'REVIEW_NOT_DELIVERED'],
    ['SHIPPED', 'REVIEW_NOT_DELIVERED'],
    ['CANCELED', 'REVIEW_ORDER_CANCELED'],
    ['RETURNED', 'REVIEW_ORDER_CANCELED'],
  ])('%s 상태에서는 쓸 수 없다', async (status, code) => {
    const item = await bought({ status, deliveredAt: null })

    expect((await failure(write(buyer, item.orderItemId))).code).toBe(code)
  })

  it('구매확정된 뒤에도 쓸 수 있다', async () => {
    const item = await bought({ status: 'CONFIRMED' })

    expect((await write(buyer, item.orderItemId)).review.rating).toBe(5)
  })

  it('작성 기한이 지나면 쓸 수 없다', async () => {
    const item = await bought({ deliveredAt: daysAgo(REVIEW_WRITE_WINDOW_DAYS + 1) })

    expect((await failure(write(buyer, item.orderItemId))).code).toBe('REVIEW_WINDOW_CLOSED')
  })
})

describe('사진 (F6)', () => {
  function key(owner: string, index: number): string {
    return `reviews/${owner}/0192f0c1-0000-7000-8000-00000000000${String(index)}.jpg`
  }

  it('사진을 세 장 붙인다', async () => {
    const item = await bought()
    const keys = [key(buyer.userId, 1), key(buyer.userId, 2), key(buyer.userId, 3)]
    const { review } = await write(buyer, item.orderItemId, { imageKeys: keys })

    expect(review.images.map((image) => image.key)).toEqual(keys)
  })

  /** 열쇠가 곧 소유자다 — 두 번째 조회 없이 남의 사진을 막는다. */
  it('남의 사진은 붙일 수 없다', async () => {
    const item = await bought()

    expect(
      (await failure(write(buyer, item.orderItemId, { imageKeys: [key(stranger.userId, 1)] })))
        .code,
    ).toBe('REVIEW_IMAGE_FOREIGN')
  })

  it('상한을 넘으면 거절한다', async () => {
    const item = await bought()
    const keys = Array.from({ length: 6 }, (_unused, index) => key(buyer.userId, index))

    expect((await failure(write(buyer, item.orderItemId, { imageKeys: keys }))).code).toBe(
      'REVIEW_IMAGE_TOO_MANY',
    )
  })
})

describe('수정과 삭제 (F4 · F5)', () => {
  function patch(
    caller: TestCaller,
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ review: { rating: number; content: string } }> {
    return client(caller).request({
      path: `/reviews/${id}`,
      method: 'PATCH',
      body: { rating: 3, content: '다시 써 봅니다.', ...body },
      schema: reviewResponseSchema,
    })
  }

  it('본인은 고칠 수 있다', async () => {
    const item = await bought()
    const { review } = await write(buyer, item.orderItemId)

    const updated = await patch(buyer, review.id, {})

    expect(updated.review).toMatchObject({ rating: 3, content: '다시 써 봅니다.' })
  })

  /** 남의 리뷰에도 403 이 아니라 404 다 — 있는지 알려 주지 않는다. */
  it('남의 리뷰는 고칠 수 없다', async () => {
    const item = await bought()
    const { review } = await write(buyer, item.orderItemId)

    expect((await failure(patch(stranger, review.id, {}))).status).toBe(404)
  })

  /** 무기한 수정은 「좋은 리뷰를 받고 나중에 바꾸는」 조작을 가능하게 한다. */
  it('수정 기한이 지나면 고칠 수 없다', async () => {
    const item = await bought()
    const { review } = await write(buyer, item.orderItemId)

    api.clock.set(new Date(new Date(NOW).getTime() + (REVIEW_EDIT_WINDOW_DAYS + 1) * DAY_MS))

    expect((await failure(patch(buyer, review.id, {}))).code).toBe('REVIEW_EDIT_WINDOW_CLOSED')
  })

  it('사진은 통째로 갈아 끼운다', async () => {
    const item = await bought()
    const first = `reviews/${buyer.userId}/0192f0c1-0000-7000-8000-000000000001.jpg`
    const second = `reviews/${buyer.userId}/0192f0c1-0000-7000-8000-000000000002.jpg`
    const { review } = await write(buyer, item.orderItemId, { imageKeys: [first] })

    await patch(buyer, review.id, { imageKeys: [second] })

    const read = await client(buyer).request({
      path: `/reviews/${review.id}`,
      schema: reviewResponseSchema,
    })

    expect(read.review.images.map((image) => image.key)).toEqual([second])
  })

  /** 지운 뒤에는 다시 쓸 수 없다 — 행이 남아 유니크가 그대로 막는다. */
  it('지우면 없는 것이 되고, 다시 쓸 수도 없다', async () => {
    const item = await bought()
    const { review } = await write(buyer, item.orderItemId)

    await client(buyer).request({
      path: `/reviews/${review.id}`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect(
      (
        await failure(
          client(buyer).request({ path: `/reviews/${review.id}`, schema: reviewResponseSchema }),
        )
      ).status,
    ).toBe(404)
    expect((await failure(write(buyer, item.orderItemId))).code).toBe('REVIEW_ALREADY_WRITTEN')
  })
})

describe('쓸 수 있는 주문 목록 (F7)', () => {
  function reviewable(caller: TestCaller): Promise<{
    items: readonly { orderItemId: string; writableUntil: string; productName: string }[]
  }> {
    return client(caller).request({
      path: '/me/reviewable-items',
      schema: reviewableListResponseSchema,
    })
  }

  it('아직 쓰지 않은 배송완료 항목만 담는다', async () => {
    const writable = await bought()

    await bought({ status: 'SHIPPED', deliveredAt: null })

    const written = await bought()

    await write(buyer, written.orderItemId)

    const answer = await reviewable(buyer)

    expect(answer.items.map((entry) => entry.orderItemId)).toEqual([writable.orderItemId])
  })

  /** 기한을 서버가 계산해 내려보낸다 — 화면이 다시 세면 규칙이 두 벌이 된다. */
  it('언제까지 쓸 수 있는지를 함께 답한다', async () => {
    await bought({ deliveredAt: daysAgo(1) })

    const [item] = (await reviewable(buyer)).items
    const expected = new Date(
      new Date(daysAgo(1)).getTime() + REVIEW_WRITE_WINDOW_DAYS * DAY_MS,
    ).toISOString()

    expect(item?.writableUntil).toBe(expected)
    expect(item?.productName).toBe('울 코트')
  })

  it('기한이 지난 항목은 담지 않는다', async () => {
    await bought({ deliveredAt: daysAgo(REVIEW_WRITE_WINDOW_DAYS + 1) })

    expect((await reviewable(buyer)).items).toEqual([])
  })

  it('남의 주문은 담지 않는다', async () => {
    await bought({ userId: stranger.userId })

    expect((await reviewable(buyer)).items).toEqual([])
  })
})

describe('공개되는 만큼', () => {
  /**
   * **리뷰는 로그인하지 않은 사람도 읽는다.** 그래서 이름은 서버가 가려서
   * 내려보낸다 — 화면마다 가리게 두면 한 화면이 잊는 날 그 화면만 이름을 다 보여 준다.
   */
  it('쓴 사람의 이름을 가려서 내려보낸다', async () => {
    const item = await bought()
    const { review } = await write(buyer, item.orderItemId)

    expect(review.authorName).toBe('홍*동')
  })
})
