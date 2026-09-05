import { randomBytes, randomUUID } from 'node:crypto'

import type { ApiClient, OrderListResponse, OrderResponse, PricingDiscount } from '@shopping/shared'
import {
  ApiClientError,
  calculateOrder,
  cartResponseSchema,
  ORDER_NUMBER_PATTERN,
  orderListResponseSchema,
  orderResponseSchema,
  sellerOrderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { OrderService } from '../../src/orders/order.service.js'
import { ORDER_NUMBER_SUFFIX_LENGTH, orderNumberOf } from '../../src/orders/order-number.js'
import { ReservationService } from '../../src/reservation/reservation.service.js'
import { useApiApp } from '../support/api-app.js'
import { concurrently, fulfilled } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * 주문 생성 (TASK-0049), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 응답은 전부 계약 스키마로 파싱된다 — 필드 이름이 바뀌면 단언이 그것을 언급하지
 * 않아도 `malformed_response` 로 빨개진다 (게이트 C3).
 *
 * **재고는 한 개도 줄지 않는다** (4.4). 주문은 예약을 잡고 `PAYMENT_PENDING` 으로
 * 남는다. 그래서 아래의 검사들은 `stock` 이 아니라 `reserved` 를 본다 — 그것이
 * D-026 의 구조이고, 「주문했는데 재고가 그대로다」는 결함이 아니다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let buyer: TestCaller
let addressId: string
let categoryId: number

interface Listing {
  readonly variantId: string
  readonly sellerId: string
  readonly sellerOwner: TestCaller
  readonly productId: string
  readonly price: number
}

async function listing(
  options: {
    readonly stock?: number
    readonly price?: number
    readonly name?: string
    readonly brandName?: string
    readonly maxPurchaseQuantity?: number | null
    readonly shippingFee?: number
    readonly freeShippingThreshold?: number | null
  } = {},
): Promise<Listing> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })

  if (options.shippingFee !== undefined || options.freeShippingThreshold !== undefined) {
    await db.query(
      `UPDATE "Seller" SET "shippingFee" = COALESCE($2, "shippingFee"),
                          "freeShippingThreshold" = $3
        WHERE "id" = $1`,
      [seller.id, options.shippingFee ?? null, options.freeShippingThreshold ?? null],
    )
  }

  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    name: options.name ?? '오버핏 코트',
    status: 'ACTIVE',
    minPrice: options.price ?? 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: options.price ?? 10_000,
    stock: options.stock ?? 10,
    maxPurchaseQuantity: options.maxPurchaseQuantity ?? null,
    isActive: true,
  })

  return {
    variantId: variant.id,
    sellerId: seller.id,
    sellerOwner: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id },
    productId: product.id,
    price: options.price ?? 10_000,
  }
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function orders(): OrderService {
  return api.resolve<OrderService>(OrderService)
}

function reservations(): ReservationService {
  return api.resolve<ReservationService>(ReservationService)
}

/** 담고 그 줄의 id 를 돌려준다. */
async function add(variantId: string, quantity = 1): Promise<string> {
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity },
    schema: cartResponseSchema,
  })
  const line = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === variantId)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  return line.id
}

function remove(itemId: string): Promise<unknown> {
  return client().request({
    path: '/cart/items/remove',
    method: 'POST',
    body: { itemIds: [itemId] },
    schema: cartResponseSchema,
  })
}

function place(itemIds: readonly string[]): Promise<OrderResponse> {
  return client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId },
    schema: orderResponseSchema,
  })
}

interface HttpFailure {
  readonly status: number
  readonly code: string
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return { status: error.status ?? 0, code: error.body?.error.code ?? '' }
}

/** 표에서 바로 읽은 실물 재고와 예약분. */
async function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

describe('2단 분할 (F1)', () => {
  it('makes one order and one seller order per store', async () => {
    const stores = await Promise.all([listing(), listing(), listing()])
    const itemIds = await Promise.all(stores.map((store) => add(store.variantId)))

    const { order } = await place(itemIds)

    expect(order.sellerOrders).toHaveLength(3)
    expect(order.orderNumber).toMatch(ORDER_NUMBER_PATTERN)
    // 결제는 주문 단위 1건이다. 배송·취소·정산이 판매자 단위인 것과 다르다.
    expect(order.paidAmount).toBe(
      order.sellerOrders.reduce((sum, entry) => sum + entry.paidAmount, 0),
    )
  })

  it('puts two lines of one store in one seller order', async () => {
    const store = await listing()
    const second = await createProductVariant(db, {
      productId: store.productId,
      sellerId: store.sellerId,
      price: 5_000,
      stock: 10,
      optionSignature: 'second',
    })
    const itemIds = [await add(store.variantId), await add(second.id)]

    const { order } = await place(itemIds)

    // 한 판매자는 한 몫이다. 두 줄이면 그 판매자의 배송비가 두 번 붙는다.
    expect(order.sellerOrders).toHaveLength(1)
    expect(order.sellerOrders[0]?.items).toHaveLength(2)
    expect(order.sellerOrders[0]?.shippingFee).toBe(3_000)
  })

  it('starts every seller order at PAYMENT_PENDING, with the first history row', async () => {
    const store = await listing()
    const { order } = await place([await add(store.variantId)])
    const history = await db.query<{ fromStatus: string | null; toStatus: string }>(
      `SELECT h."fromStatus", h."toStatus" FROM "OrderStatusHistory" h
         JOIN "SellerOrder" s ON s."id" = h."sellerOrderId"
        WHERE s."orderId" = $1`,
      [order.id],
    )

    expect(order.sellerOrders[0]?.status).toBe('PAYMENT_PENDING')
    expect(history).toEqual([{ fromStatus: null, toStatus: 'PAYMENT_PENDING' }])
  })
})

describe('금액 (F2)', () => {
  it('matches the pricing engine to the won, shipping included', async () => {
    // 무료 기준을 넘는 가게와 못 넘는 가게를 섞는다. 둘 다 같은 값이면 배송비가
    // 계산에 들어갔는지 알 수 없다.
    const rich = await listing({ price: 60_000, freeShippingThreshold: 50_000 })
    const poor = await listing({ price: 9_000, shippingFee: 4_000, freeShippingThreshold: 50_000 })
    const itemIds = [await add(rich.variantId), await add(poor.variantId, 2)]

    const { order } = await place(itemIds)
    const expected = calculateOrder({
      items: [
        { itemId: 'a', sellerId: rich.sellerId, unitPrice: 60_000, quantity: 1 },
        { itemId: 'b', sellerId: poor.sellerId, unitPrice: 9_000, quantity: 2 },
      ],
      discounts: [],
      shippingPolicies: [
        { sellerId: rich.sellerId, fee: 3_000, freeThreshold: 50_000 },
        { sellerId: poor.sellerId, fee: 4_000, freeThreshold: 50_000 },
      ],
    })

    expect(order.totalProductAmount).toBe(expected.totalProductAmount)
    expect(order.totalShippingFee).toBe(expected.totalShippingFee)
    expect(order.paidAmount).toBe(expected.paidAmount)
    // 6만원짜리는 무료, 1만8천원짜리는 4,000원.
    expect(order.totalShippingFee).toBe(4_000)
  })
})

describe('스냅샷 (F3 · F4)', () => {
  it('keeps the name and the price the order was placed at', async () => {
    const store = await listing({ name: '울 롱코트', price: 189_000 })
    const { order } = await place([await add(store.variantId)])

    await db.query(`UPDATE "Product" SET "name" = '이름이 바뀐 상품' WHERE "id" = $1`, [
      store.productId,
    ])
    await db.query(`UPDATE "ProductVariant" SET "price" = 99_000 WHERE "id" = $1`, [
      store.variantId,
    ])

    const again = await client().request({
      path: `/orders/${order.id}`,
      schema: orderResponseSchema,
    })
    const item = again.order.sellerOrders[0]?.items[0]

    expect(item?.snapshot.productName).toBe('울 롱코트')
    expect(item?.unitPrice).toBe(189_000)
  })

  it('still renders after the listing is taken down', async () => {
    const store = await listing({ name: '사라질 상품' })
    const { order } = await place([await add(store.variantId)])

    await db.query(
      `UPDATE "Product" SET "deletedAt" = now(), "status" = 'INACTIVE' WHERE "id" = $1`,
      [store.productId],
    )

    const again = await client().request({
      path: `/orders/${order.id}`,
      schema: orderResponseSchema,
    })

    expect(again.order.sellerOrders[0]?.items[0]?.snapshot.productName).toBe('사라질 상품')
  })
})

describe('예약 (F5 · A7)', () => {
  it('holds every line and takes no stock at all', async () => {
    const store = await listing({ stock: 10 })

    await place([await add(store.variantId, 3)])

    // 판 것이 아니라 잡아 둔 것이다 (4.4). 확정은 결제(M08)의 일이다.
    expect(await levelsOf(store.variantId)).toEqual({ stock: 10, reserved: 3 })
  })

  it('rolls the earlier holds back when a later line is sold out', async () => {
    const plenty = await listing({ stock: 10 })
    const scarce = await listing({ stock: 2 })
    const itemIds = [await add(plenty.variantId, 2), await add(scarce.variantId, 2)]

    // 담을 때는 통과했다. 그 사이에 남이 주문서에 들어가 그 재고를 잡았다 —
    // 장바구니는 재고를 예약하지 않으므로(D-026) 이것이 정상 경로다.
    const rival = await createUser(db, {})

    await reservations().hold({
      variantId: scarce.variantId,
      quantity: 1,
      userId: rival.id,
      checkoutId: randomUUID(),
    })

    const refused = await failure(place(itemIds))

    expect(refused).toEqual({ status: 409, code: 'RESERVATION_SOLD_OUT' })
    // 앞선 예약도 없던 일이 된다. 트랜잭션 안에서 잡았기 때문이고, 밖에서 잡고
    // 보상하는 모양이었다면 보상이 실패하는 경우를 또 다뤄야 한다.
    expect(await levelsOf(plenty.variantId)).toEqual({ stock: 10, reserved: 0 })
    expect(await levelsOf(scarce.variantId)).toEqual({ stock: 2, reserved: 1 })
    expect(await db.query(`SELECT 1 FROM "Order"`)).toHaveLength(0)
  })

  it('lets exactly one of two simultaneous orders have the last unit (A7)', async () => {
    const store = await listing({ stock: 1 })
    const mine = await add(store.variantId)
    const other = await createUser(db, {})
    const rival: TestCaller = { userId: other.id, roles: ['BUYER'] }
    const rivalAddress = await createAddress(db, { userId: other.id, isDefault: true })
    const rivalCart = await api.clientAs(rival).request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId: store.variantId, quantity: 1 },
      schema: cartResponseSchema,
    })
    const rivalItem = rivalCart.groups[0]?.items[0]?.id ?? ''

    const results = await concurrently(2, (index) =>
      index === 0
        ? place([mine])
        : api.clientAs(rival).request({
            path: '/orders',
            method: 'POST',
            body: { itemIds: [rivalItem], addressId: rivalAddress.id },
            schema: orderResponseSchema,
          }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(await levelsOf(store.variantId)).toEqual({ stock: 1, reserved: 1 })
  })
})

describe('권한 (F6 · A3 · A4)', () => {
  it('lets a seller read their own share', async () => {
    const store = await listing()
    const { order } = await place([await add(store.variantId)])
    const id = order.sellerOrders[0]?.id ?? ''

    const answer = await api.clientAs(store.sellerOwner).request({
      path: `/seller-orders/${id}`,
      schema: sellerOrderResponseSchema,
    })

    expect(answer.sellerOrder.sellerId).toBe(store.sellerId)
    expect(answer.orderNumber).toBe(order.orderNumber)
  })

  it('refuses another seller’s share with 403', async () => {
    const mine = await listing()
    const rival = await listing()
    const { order } = await place([await add(mine.variantId)])
    const id = order.sellerOrders[0]?.id ?? ''

    expect(
      (
        await failure(
          api.clientAs(rival.sellerOwner).request({
            path: `/seller-orders/${id}`,
            schema: sellerOrderResponseSchema,
          }),
        )
      ).status,
    ).toBe(403)
  })

  it('refuses another buyer’s order with 403', async () => {
    const store = await listing()
    const { order } = await place([await add(store.variantId)])
    const other = await createUser(db, {})

    expect(
      (
        await failure(
          api.clientAs({ userId: other.id, roles: ['BUYER'] }).request({
            path: `/orders/${order.id}`,
            schema: orderResponseSchema,
          }),
        )
      ).status,
    ).toBe(403)
  })

  it('lets an operator read any order', async () => {
    const store = await listing()
    const { order } = await place([await add(store.variantId)])

    const seen = await api.clientAs(callers.operator).request({
      path: `/orders/${order.id}`,
      schema: orderResponseSchema,
    })

    expect(seen.order.id).toBe(order.id)
  })

  it('refuses an anonymous caller with 401 (A4)', async () => {
    const store = await listing()
    const itemId = await add(store.variantId)

    expect(
      (
        await failure(
          api.client.request({
            path: '/orders',
            method: 'POST',
            body: { itemIds: [itemId], addressId },
            schema: orderResponseSchema,
          }),
        )
      ).status,
    ).toBe(401)
  })
})

describe('입력 (A2 · F9)', () => {
  it('refuses a line that is no longer in the cart', async () => {
    const store = await listing()
    const itemId = await add(store.variantId)

    await client().request({
      path: '/cart/items/remove',
      method: 'POST',
      body: { itemIds: [itemId] },
      schema: cartResponseSchema,
    })

    // 일부만 주문하고 넘어가지 않는다 — 사람이 보고 있는 화면과 다른 것을 사게
    // 되는 쪽이 훨씬 나쁘다.
    expect(await failure(place([itemId]))).toEqual({ status: 400, code: 'ORDER_ITEM_MISSING' })
  })

  it('refuses a listing that has been taken down', async () => {
    const store = await listing()
    const itemId = await add(store.variantId)

    await db.query(`UPDATE "Product" SET "status" = 'INACTIVE' WHERE "id" = $1`, [store.productId])

    expect(await failure(place([itemId]))).toEqual({
      status: 400,
      code: 'ORDER_ITEM_UNAVAILABLE',
    })
  })

  it('enforces the purchase cap even when the cart was passed by (F9)', async () => {
    const store = await listing({ maxPurchaseQuantity: 5 })
    const itemId = await add(store.variantId, 3)

    // 장바구니를 통과한 뒤에 상한이 내려갔다. API 를 직접 부르는 것도 같은 모양이다.
    await db.query(`UPDATE "ProductVariant" SET "maxPurchaseQuantity" = 2 WHERE "id" = $1`, [
      store.variantId,
    ])

    expect(await failure(place([itemId]))).toEqual({ status: 400, code: 'ORDER_PURCHASE_LIMIT' })
    expect(await db.query(`SELECT 1 FROM "Order"`)).toHaveLength(0)
  })

  it('refuses somebody else’s address', async () => {
    const store = await listing()
    const itemId = await add(store.variantId)
    const stranger = await createUser(db, {})
    const theirs = await createAddress(db, { userId: stranger.id })

    const refused = await failure(
      client().request({
        path: '/orders',
        method: 'POST',
        body: { itemIds: [itemId], addressId: theirs.id },
        schema: orderResponseSchema,
      }),
    )

    // 「없다」로 답한다 — 있는지 없는지를 알려 주지 않는 것이 옳다.
    expect(refused).toEqual({ status: 400, code: 'ORDER_ADDRESS_MISSING' })
  })

  it('refuses an empty order', async () => {
    expect((await failure(place([]))).status).toBe(400)
  })
})

describe('주문번호 (F7)', () => {
  it('draws a thousand without a collision', () => {
    // **생성기**를 잰다. 진짜 주문 1000건을 만들면 재는 것의 대부분이 Postgres 의
    // INSERT 속도이고, 번호가 겹치는지는 40비트 난수의 성질이다. 겹쳤을 때 실제로
    // 거절되는지는 `Order_orderNumber_key` 를 시험하는 제약 스펙이 따로 본다.
    const now = new Date('2026-09-05T00:00:00.000Z')
    const drawn = new Set(
      Array.from({ length: 1_000 }, () =>
        orderNumberOf(now, randomBytes(ORDER_NUMBER_SUFFIX_LENGTH)),
      ),
    )

    expect(drawn.size).toBe(1_000)
  })

  it('gives forty real orders forty different numbers', async () => {
    const store = await listing({ stock: 100 })
    const numbers = new Set<string>()

    for (let index = 0; index < 40; index += 1) {
      const itemId = await add(store.variantId)
      const { order } = await place([itemId])

      numbers.add(order.orderNumber)
      // 주문해도 장바구니는 비지 않는다 (4.5). 같은 조합을 다시 담으면 수량이
      // 합산되므로, 매번 한 개를 주문하려면 그 줄을 치워야 한다.
      await remove(itemId)
    }

    expect(numbers.size).toBe(40)
    // 전부 같은 날짜로 시작한다 — 뒤의 여덟 자리만으로 40건이 갈렸다는 뜻이다.
    expect(
      [...numbers].every((number) => number.startsWith([...numbers][0]?.slice(0, 9) ?? '')),
    ).toBe(true)
  })
})

describe('안분액 저장 (F8)', () => {
  it('writes each item’s share of an order-wide coupon', async () => {
    // 쿠폰도 적립금도 M11 이라 컨트롤러는 할인을 받지 않는다 (4.2). 저장 경로는
    // 지금 있고, 그것을 재려면 서비스를 직접 부른다.
    const store = await listing({ price: 10_000 })
    const cheap = await createProductVariant(db, {
      productId: store.productId,
      sellerId: store.sellerId,
      price: 5_000,
      stock: 10,
      optionSignature: 'cheap',
    })
    const itemIds = [await add(store.variantId), await add(cheap.id)]
    const discounts: readonly PricingDiscount[] = [
      { id: 'welcome', type: 'COUPON', scope: 'ORDER', amount: 3_000, bearer: 'PLATFORM' },
    ]

    const { order } = await orders().create(
      { app: 'shop', userId: buyer.userId, roles: ['BUYER'], sellerId: null },
      { itemIds, addressId },
      discounts,
    )
    const items = order.sellerOrders[0]?.items ?? []

    // 10,000 과 5,000 에 3,000원을 안분하면 2,000 과 1,000 이다.
    expect(items.map((item) => item.couponDiscountAmount).sort()).toEqual([1_000, 2_000])
    expect(items.every((item) => item.discountAmount === item.couponDiscountAmount)).toBe(true)
    expect(order.totalCouponDiscountAmount).toBe(3_000)
  })
})

describe('목록', () => {
  it('answers newest first and pages by cursor', async () => {
    const store = await listing({ stock: 50 })

    for (let index = 0; index < 3; index += 1) {
      await place([await add(store.variantId)])
    }

    const first = await list({ limit: 2 })

    expect(first.orders).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await list({ limit: 2, cursor: first.nextCursor ?? '' })

    expect(second.orders).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    // 최신순. 커서는 id 로 잡는다 — UUIDv7 이라 시간순이고, `createdAt` 으로
    // 잡으면 같은 밀리초의 두 주문에서 한 건을 건너뛴다.
    expect(first.orders[0]?.orderNumber).not.toBe(second.orders[0]?.orderNumber)
  })

  it('says what was bought without carrying every item', async () => {
    const store = await listing({ name: '울 롱코트', stock: 20 })
    const second = await createProductVariant(db, {
      productId: store.productId,
      sellerId: store.sellerId,
      price: 5_000,
      stock: 10,
      optionSignature: 'two',
    })

    await place([await add(store.variantId), await add(second.id)])

    const answer = await list({})

    expect(answer.orders[0]).toMatchObject({ headline: '울 롱코트', itemCount: 2 })
    expect(answer.orders[0]?.statuses).toEqual(['PAYMENT_PENDING'])
  })

  it('shows a buyer only their own orders', async () => {
    const store = await listing()

    await place([await add(store.variantId)])

    const other = await createUser(db, {})
    const theirs = await api.clientAs({ userId: other.id, roles: ['BUYER'] }).request({
      path: '/orders',
      schema: orderListResponseSchema,
    })

    expect(theirs.orders).toEqual([])
  })
})

function list(query: { limit?: number; cursor?: string }): Promise<OrderListResponse> {
  const search = new URLSearchParams()

  if (query.limit !== undefined) search.set('limit', String(query.limit))
  if (query.cursor !== undefined) search.set('cursor', query.cursor)

  return client().request({
    path: `/orders${search.size > 0 ? `?${search.toString()}` : ''}`,
    schema: orderListResponseSchema,
  })
}
