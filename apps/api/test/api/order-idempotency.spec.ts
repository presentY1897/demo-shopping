import { randomBytes, randomUUID } from 'node:crypto'

import type { ApiClient, OrderResponse } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  checkoutResponseSchema,
  orderListResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { OrderService } from '../../src/orders/order.service.js'
import { ORDER_NUMBER_SUFFIX_LENGTH, orderNumberOf } from '../../src/orders/order-number.js'
import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
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

/**
 * `POST /orders` 의 멱등 (TASK-0057 4.4), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **`orders.integration.spec.ts` 옆의 새 파일인 이유**는 재는 것이 다른 TASK 의
 * 다른 성질이기 때문이다. 저쪽은 TASK-0049 의 「주문 하나가 올바르게 만들어지는가」를
 * F1~F9 로 훑고, 여기는 **같은 주문서로 두 번째가 왔을 때 아무 일도 일어나지 않는가**
 * 하나만 본다. 필요한 장치도 겹치지 않는다 — 주문서를 열고, 요청 둘을 겹치고,
 * 제약이 마지막 줄인지 확인하려고 이긴 주문을 커밋 전에 붙잡아 둔다.
 *
 * 고치려는 증상은 화면에 있다. 화면이 새로 마운트되면 자기가 만든 주문을 잊고(카드가
 * 거절돼 새로고침한 뒤, 결제창을 닫고 실패 화면에서 주문서로 돌아온 뒤) 같은
 * 주문서로 다시 누른다. 재고가 두 몫 잠기지는 않지만 **결제되지 않은 주문 한 건**이
 * 남고, 산 사람은 주문 목록에서 자기가 두 번 주문했다고 읽는다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let buyer: TestCaller
let addressId: string
let categoryId: number

interface Listing {
  readonly variantId: string
  readonly sellerId: string
}

async function listing(options: { readonly stock?: number } = {}): Promise<Listing> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    minPrice: 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: 10_000,
    stock: options.stock ?? 10,
    isActive: true,
  })

  return { variantId: variant.id, sellerId: seller.id }
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
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

/** 주문서를 연다 — 즉 재고를 잡는다. 그 id 가 멱등의 열쇠다. */
async function open(itemIds: readonly string[]): Promise<string> {
  const { checkout } = await client().request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds },
    schema: checkoutResponseSchema,
  })

  return checkout.id
}

function place(
  checkoutId: string,
  options: { readonly caller?: TestCaller; readonly addressId?: string } = {},
): Promise<OrderResponse> {
  return client(options.caller ?? buyer).request({
    path: '/orders',
    method: 'POST',
    body: { checkoutId, addressId: options.addressId ?? addressId },
    schema: orderResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<{ status: number }> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return { status: error.status ?? 0 }
}

interface Counts {
  readonly orders: number
  readonly sellerOrders: number
  readonly items: number
  readonly history: number
  readonly reservations: number
}

/** 두 번째 요청이 **무엇도 더 만들지 않았는지**를 한 질의로 본다. */
function counts(): Promise<Counts> {
  return db.one<Counts>(
    `SELECT (SELECT count(*)::int FROM "Order")              AS "orders",
            (SELECT count(*)::int FROM "SellerOrder")        AS "sellerOrders",
            (SELECT count(*)::int FROM "OrderItem")          AS "items",
            (SELECT count(*)::int FROM "OrderStatusHistory") AS "history",
            (SELECT count(*)::int FROM "StockReservation")   AS "reservations"`,
  )
}

function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

describe('같은 주문서는 한 주문이다 (4.4)', () => {
  it('answers the second request with the first order', async () => {
    const store = await listing({ stock: 10 })
    const checkoutId = await open([await add(store.variantId, 3)])

    const first = await place(checkoutId)
    const second = await place(checkoutId)

    expect(second.order.id).toBe(first.order.id)
    // 주문번호까지 같아야 한다. 전화로 불러 주는 번호가 두 개면 「같은 주문」이라는
    // 말이 산 사람에게 참이 아니다.
    expect(second.order.orderNumber).toBe(first.order.orderNumber)
    // 아무것도 더 만들어지지 않았다 — 판매자 몫도, 항목도, 이력 한 줄도, 예약도.
    expect(await counts()).toEqual({
      orders: 1,
      sellerOrders: 1,
      items: 1,
      history: 1,
      reservations: 1,
    })
    expect(await levelsOf(store.variantId)).toEqual({ stock: 10, reserved: 3 })
  })

  it('keeps the address the first request chose', async () => {
    const store = await listing()
    const checkoutId = await open([await add(store.variantId)])
    const { order } = await place(checkoutId)
    const elsewhere = await createAddress(db, { userId: buyer.userId })

    await db.query(`UPDATE "Address" SET "addressLine1" = '부산시 해운대구' WHERE "id" = $1`, [
      elsewhere.id,
    ])

    const again = await place(checkoutId, { addressId: elsewhere.id })

    // **배송지를 갈아 끼우는 것은 멱등이 아니라 수정이다.** 그 주문에는 이미 결제가
    // 붙어 판매자가 주소를 읽었을 수 있고, 조용히 바뀌는 쪽이 훨씬 나쁘다. 답은 첫
    // 요청이 남긴 것이지 두 번째 요청의 함수가 아니다.
    expect(again.order.id).toBe(order.id)
    expect(again.order.recipient.addressLine1).toBe('서울시 강남구')
    expect((await counts()).orders).toBe(1)
  })

  it('is not so wide that two checkouts share an order', async () => {
    const store = await listing({ stock: 10 })
    const itemId = await add(store.variantId)
    const first = await place(await open([itemId]))
    const second = await place(await open([itemId]))

    // 멱등의 열쇠는 주문서 하나다. 같은 사람이 같은 줄로 두 번 주문하는 것은
    // 정상이고, 그것까지 같은 주문으로 접으면 두 번째 주문이 사라진다.
    expect(second.order.id).not.toBe(first.order.id)
    expect((await counts()).orders).toBe(2)
  })
})

describe('경합 (A7)', () => {
  it('answers both of two simultaneous requests with one order', async () => {
    const store = await listing({ stock: 10 })
    const checkoutId = await open([await add(store.variantId)])
    const gate = barrier(2)

    const results = await concurrently(2, async () => {
      // 둘이 같은 순간에 떠나야 둘 다 「아직 없다」를 읽는다. 하나가 먼저 끝나
      // 버리면 재는 것이 멱등의 빠른 길뿐이고, 그때는 깨진 구현도 초록이다.
      await gate.arrive()

      return place(checkoutId)
    })
    const placed = fulfilled(results)

    expect(rejected(results)).toEqual([])
    expect(placed).toHaveLength(2)
    // **진 쪽도 200 이다.** 「먼저 온 쪽만 성공」은 이 화면에서 아무 도움이 안 된다 —
    // 두 요청 다 같은 사람의 같은 주문서이고, 답은 하나뿐이기 때문이다.
    expect(placed[1]?.order.id).toBe(placed[0]?.order.id)
    expect(await counts()).toMatchObject({ orders: 1, sellerOrders: 1, items: 1 })
  })

  it('re-reads the winner when the unique constraint is what stops it', async () => {
    const store = await listing({ stock: 10 })
    const checkoutId = await open([await add(store.variantId)])
    const winner = randomUUID()

    // **겹침을 희망하지 않고 배열한다.** 위의 검사는 둘을 같은 순간에 보내지만,
    // 어느 쪽이 먼저 커밋하는지는 스케줄러가 정한다 — 운이 나쁘면 두 번째가 첫
    // 번째의 주문을 읽어 버려 제약까지 가지 않고, 그러면 마지막 줄이 실제로
    // 동작하는지는 재지 못한 채 초록이 된다.
    //
    // 그래서 이긴 주문을 손으로 놓고 **커밋하지 않은 채** 요청을 보낸다. 요청의
    // 사전 조회는 커밋되지 않은 행을 보지 못하므로 반드시 저장까지 가고, 그
    // INSERT 는 유니크 인덱스 앞에서 이 트랜잭션을 기다린다. 커밋하는 순간
    // 위반이 나고, 그때 무엇을 하는지가 이 검사가 재는 전부다.
    await db.withConnection(async (client) => {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO "Order"
           ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
            "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
         VALUES ($1, $2, $3, $4, '수령인', '010-0000-0000', '06234', '서울시 강남구',
                 10000, 13000, now())`,
        [
          winner,
          orderNumberOf(
            new Date('2026-09-05T00:00:00.000Z'),
            randomBytes(ORDER_NUMBER_SUFFIX_LENGTH),
          ),
          buyer.userId,
          checkoutId,
        ],
      )

      const [placed] = await Promise.all([
        place(checkoutId),
        (async () => {
          await awaitBlockedInsert()
          await client.query('COMMIT')
        })(),
      ])

      // 500 이 아니라 이긴 주문이다. 다시 읽는 일이 트랜잭션 **밖**이라야 이것이
      // 가능하다 — 안에서 잡아 읽으면 그 읽기가 「current transaction is aborted」다.
      expect(placed.order.id).toBe(winner)
    })

    // 진 쪽의 트랜잭션은 통째로 롤백됐다. 판매자 몫 하나도 남지 않는다.
    expect(await counts()).toMatchObject({ orders: 1, sellerOrders: 0, items: 0 })
  })
})

describe('남의 주문서', () => {
  it('refuses somebody else’s checkout and leaks no order', async () => {
    const store = await listing()
    const checkoutId = await open([await add(store.variantId)])
    const { order } = await place(checkoutId)
    const account = await createUser(db, {})
    const stranger: TestCaller = { userId: account.id, roles: ['BUYER'] }
    const theirAddress = await createAddress(db, { userId: account.id, isDefault: true })

    // 주문이 만들어지기 전에도 남의 주문서는 403 이었다. 멱등이 그 문을 열어 주면
    // 남의 `checkoutId` 하나로 남의 배송지·상품·금액을 전부 읽게 된다.
    expect(
      await failure(place(checkoutId, { caller: stranger, addressId: theirAddress.id })),
    ).toEqual({ status: 403 })

    const theirs = await api
      .clientAs(stranger)
      .request({ path: '/orders', schema: orderListResponseSchema })

    expect(theirs.orders).toEqual([])
    expect((await counts()).orders).toBe(1)
    expect(
      await failure(
        api.clientAs(stranger).request({
          path: `/orders/${order.id}`,
          schema: orderResponseSchema,
        }),
      ),
    ).toEqual({ status: 403 })
  })
})

describe('결제가 붙은 뒤에도', () => {
  it('answers with the same order once the holds have been confirmed', async () => {
    const store = await listing({ stock: 10 })
    const checkoutId = await open([await add(store.variantId, 2)])
    const { order } = await place(checkoutId)
    const paymentId = randomUUID()

    await db.query(
      `INSERT INTO "Payment"
         ("id", "orderId", "provider", "status", "authorizedAmount", "paymentKey",
          "approvedAt", "updatedAt")
       VALUES ($1, $2, 'VIRTUAL_CARD', 'PAID', $3, $4, now(), now())`,
      [paymentId, order.id, order.paidAmount, `card-${paymentId}`],
    )
    // 매입이 끝나면 예약은 전부 `CONFIRMED` 가 되어 그 주문서에 `HELD` 가 하나도
    // 남지 않는다. 줄부터 다시 그리는 순서였다면 **결제까지 끝낸 사람의
    // 새로고침이 404** 가 되는 자리다.
    await api.resolve<OrderService>(OrderService).markPaid(order.id)

    const again = await place(checkoutId)

    expect(again.order.id).toBe(order.id)
    expect(again.order.orderNumber).toBe(order.orderNumber)
    expect(again.order.sellerOrders[0]?.status).toBe('PAID')
    // 그 결제도 그대로다. 두 번째 요청이 주문을 하나 더 만들었다면 그 주문에는
    // 결제가 없고, 산 사람은 「결제되지 않은 주문」을 하나 더 보게 된다.
    expect(
      await db.query(`SELECT "id", "status"::text AS "status", "authorizedAmount" FROM "Payment"`),
    ).toEqual([{ id: paymentId, status: 'PAID', authorizedAmount: order.paidAmount }])
    expect(await counts()).toMatchObject({ orders: 1, sellerOrders: 1, items: 1 })
  })
})

/**
 * 어떤 문장 하나가 실제로 잠금 대기에 들어갈 때까지 기다린다.
 *
 * `awaitBlocked` 와 같은 일을 하되 pid 를 모르는 채로 한다 — 막히는 것은 API 가
 * 자기 풀에서 꺼낸 커넥션이고, 검사는 그 번호를 알 방법이 없다. 워커마다
 * 데이터베이스가 다르므로(`QUALITY-GATES` 6장) 이 데이터베이스에서 기다리는
 * 백엔드는 그 하나뿐이다.
 */
async function awaitBlockedInsert(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { waiting } = await db.one<{ waiting: number }>(
      `SELECT count(*)::int AS "waiting" FROM pg_stat_activity
        WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`,
    )

    if (waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('두 번째 INSERT 가 유니크 제약 앞에서 기다리지 않았습니다.')
}
