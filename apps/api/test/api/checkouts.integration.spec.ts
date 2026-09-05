import type { ApiClient, CheckoutResponse } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { RESERVATION_TTL_MS } from '../../src/reservation/reservation-rules.js'
import { useApiApp } from '../support/api-app.js'
import { DEFAULT_TEST_INSTANT } from '../support/clock.js'
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
 * 주문서 (TASK-0050 4.1), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **주문서는 표가 아니다.** 같은 `checkoutId` 를 가진 `HELD` 예약들이 곧 주문서이고,
 * 그래서 이 스펙이 확인하는 것은 대부분 「예약이 어떻게 됐나」다 — 열면 잡히고, 읽으면
 * 그 예약이 다시 그려지고, 닫으면 풀린다.
 */

/** 닫기의 응답. 풀린 예약의 수 — 「이미 풀렸다」는 0이다. */
const releasedSchema = z.object({ released: z.int().min(0) })

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let buyer: TestCaller
let addressId: string
let categoryId: number

interface Listing {
  readonly variantId: string
  readonly sellerId: string
}

async function listing(
  options: { readonly stock?: number; readonly price?: number } = {},
): Promise<Listing> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    minPrice: options.price ?? 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: options.price ?? 10_000,
    stock: options.stock ?? 10,
    isActive: true,
  })

  return { variantId: variant.id, sellerId: seller.id }
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

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

  return line?.id ?? ''
}

function open(itemIds: readonly string[], caller: TestCaller = buyer): Promise<CheckoutResponse> {
  return client(caller).request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds },
    schema: checkoutResponseSchema,
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

async function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

describe('여는 일은 잡는 일이다 (F1)', () => {
  it('holds every chosen line and says when the hold runs out', async () => {
    const store = await listing({ stock: 10 })
    const { checkout } = await open([await add(store.variantId, 3)])

    expect(await levelsOf(store.variantId)).toEqual({ stock: 10, reserved: 3 })

    // 15분 뒤 — 벽시계가 아니라 **주입된 시계** 기준이다(`clock-injection.spec.ts`
    // 가 같은 이유를 적었다). 벽시계로 재면 이 스펙은 고정 시계가 과거로 옮겨지는
    // 날 빨개진다.
    expect(new Date(checkout.expiresAt).getTime()).toBe(
      new Date(DEFAULT_TEST_INSTANT).getTime() + RESERVATION_TTL_MS,
    )
  })

  it('rolls every hold back when one line is sold out', async () => {
    const plenty = await listing({ stock: 10 })
    const scarce = await listing({ stock: 1 })
    const itemIds = [await add(plenty.variantId, 1), await add(scarce.variantId, 1)]

    await db.query(`UPDATE "ProductVariant" SET "reserved" = 1 WHERE "id" = $1`, [scarce.variantId])

    expect((await failure(open(itemIds))).status).toBe(409)
    // 한 트랜잭션이라 롤백이 곧 해제다.
    expect(await levelsOf(plenty.variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('refuses a line that is no longer in the cart', async () => {
    expect((await failure(open([addressId]))).status).toBe(404)
  })
})

describe('읽는 일은 다시 그리는 일이다', () => {
  it('rebuilds the checkout from its holds alone, after the cart line is gone', async () => {
    const store = await listing({ stock: 10, price: 12_000 })
    const itemId = await add(store.variantId, 2)
    const { checkout } = await open([itemId])

    // 장바구니 줄을 지운다. 이미 잡아 둔 재고는 사라지지 않는다 — 주문서는
    // 예약에서 되짚어 그려지므로 그대로 살아 있어야 한다.
    await client().request({
      path: '/cart/items/remove',
      method: 'POST',
      body: { itemIds: [itemId] },
      schema: cartResponseSchema,
    })

    const again = await client().request({
      path: `/checkouts/${checkout.id}`,
      schema: checkoutResponseSchema,
    })

    expect(again.checkout.sellerOrders[0]?.items[0]).toMatchObject({
      quantity: 2,
      unitPrice: 12_000,
      productAmount: 24_000,
    })
    expect(again.checkout.totalProductAmount).toBe(24_000)
  })

  it('answers 404 once the holds are gone', async () => {
    const store = await listing()
    const { checkout } = await open([await add(store.variantId)])

    await client().request({
      path: `/checkouts/${checkout.id}`,
      method: 'DELETE',
      schema: releasedSchema,
    })

    // 만료도 같은 모양이다 — 화면은 「시간이 지났어요」를 보여 주고 장바구니로
    // 돌려보낸다.
    expect(
      (
        await failure(
          client().request({ path: `/checkouts/${checkout.id}`, schema: checkoutResponseSchema }),
        )
      ).status,
    ).toBe(404)
  })
})

describe('닫는 일은 푸는 일이다 (F4)', () => {
  it('gives the stock back', async () => {
    const store = await listing({ stock: 10 })
    const { checkout } = await open([await add(store.variantId, 4)])

    await client().request({
      path: `/checkouts/${checkout.id}`,
      method: 'DELETE',
      schema: releasedSchema,
    })

    expect(await levelsOf(store.variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('is quiet about a checkout that was already closed', async () => {
    const store = await listing()
    const { checkout } = await open([await add(store.variantId)])
    const path = `/checkouts/${checkout.id}`

    await client().request({ path, method: 'DELETE', schema: releasedSchema })

    // 부르는 쪽은 페이지를 떠나는 중이고, 「이미 풀렸다」에 대해 할 수 있는 일이
    // 없다 — 두 번째 신호가 오류가 되면 콘솔만 시끄러워진다.
    await expect(
      client().request({ path, method: 'DELETE', schema: releasedSchema }),
    ).resolves.toBeDefined()
  })
})

describe('남의 주문서 (A3 · A4)', () => {
  it('refuses to show one', async () => {
    const store = await listing()
    const { checkout } = await open([await add(store.variantId)])
    const stranger = await createUser(db, {})

    expect(
      (
        await failure(
          api.clientAs({ userId: stranger.id, roles: ['BUYER'] }).request({
            path: `/checkouts/${checkout.id}`,
            schema: checkoutResponseSchema,
          }),
        )
      ).status,
    ).toBe(403)
  })

  it('refuses to release one', async () => {
    const store = await listing({ stock: 10 })
    const { checkout } = await open([await add(store.variantId, 2)])
    const stranger = await createUser(db, {})

    expect(
      (
        await failure(
          api.clientAs({ userId: stranger.id, roles: ['BUYER'] }).request({
            path: `/checkouts/${checkout.id}`,
            method: 'DELETE',
            schema: releasedSchema,
          }),
        )
      ).status,
    ).toBe(403)
    // 남이 부른 해제로 재고가 풀리면 그것만으로 남의 주문을 망칠 수 있다.
    expect(await levelsOf(store.variantId)).toEqual({ stock: 10, reserved: 2 })
  })

  it('refuses an anonymous caller', async () => {
    const store = await listing()
    const { checkout } = await open([await add(store.variantId)])

    expect(
      (
        await failure(
          api.client.request({ path: `/checkouts/${checkout.id}`, schema: checkoutResponseSchema }),
        )
      ).status,
    ).toBe(401)
  })
})

describe('주문은 잡혀 있는 것을 쓴다 (F5 · F7 · 4.3)', () => {
  it('takes the checkout’s holds instead of making new ones', async () => {
    const store = await listing({ stock: 10, price: 15_000 })
    const { checkout } = await open([await add(store.variantId, 2)])

    const { order } = await client().request({
      path: '/orders',
      method: 'POST',
      body: { checkoutId: checkout.id, addressId },
      schema: orderResponseSchema,
    })

    // **두 몫이 잡히지 않는다.** 두 번 잡으면 한 사람이 같은 물건을 두 몫 잠근다.
    expect(await levelsOf(store.variantId)).toEqual({ stock: 10, reserved: 2 })
    // 금액이 주문서와 1원도 다르지 않다 (F5).
    expect(order.paidAmount).toBe(checkout.paidAmount)
    expect(order.totalProductAmount).toBe(checkout.totalProductAmount)
  })

  it('refuses a checkout that belongs to somebody else', async () => {
    const store = await listing()
    const { checkout } = await open([await add(store.variantId)])
    const stranger = await createUser(db, {})
    const theirAddress = await createAddress(db, { userId: stranger.id, isDefault: true })

    expect(
      (
        await failure(
          api.clientAs({ userId: stranger.id, roles: ['BUYER'] }).request({
            path: '/orders',
            method: 'POST',
            body: { checkoutId: checkout.id, addressId: theirAddress.id },
            schema: orderResponseSchema,
          }),
        )
      ).status,
    ).toBe(403)
  })

  it('refuses a request that names both a checkout and cart lines', async () => {
    const store = await listing()
    const itemId = await add(store.variantId)
    const { checkout } = await open([itemId])

    // 둘 다 보내면 어느 쪽이 이기는지를 정해야 하고, 그 규칙은 아무도 기억하지
    // 못한다.
    expect(
      (
        await failure(
          client().request({
            path: '/orders',
            method: 'POST',
            body: { checkoutId: checkout.id, itemIds: [itemId], addressId },
            schema: orderResponseSchema,
          }),
        )
      ).status,
    ).toBe(400)
  })
})
