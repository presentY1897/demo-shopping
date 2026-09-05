import type { ApiClient, CartResponse } from '@shopping/shared'
import { ApiClientError, cartResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 장바구니 (TASK-0045), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 응답은 전부 `cartResponseSchema` 로 파싱된다 — 필드 이름이 바뀌면 단언이 그것을
 * 언급하지 않아도 `malformed_response` 로 빨개진다 (게이트 C3).
 *
 * **경로에 사용자 id 가 없다.** 그래서 「남의 장바구니」를 시도하는 검사를 쓸 수가
 * 없고, 대신 그 사실 자체를 잰다 (F7 · 4.3).
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let buyer: TestCaller
let categoryId: number

interface Listing {
  readonly variantId: string
  readonly sellerId: string
  readonly price: number
}

/** A store with one listing on sale. */
async function listing(
  options: {
    readonly stock?: number
    readonly price?: number
    readonly maxPurchaseQuantity?: number | null
    readonly productMax?: number | null
    readonly name?: string
  } = {},
): Promise<Listing> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    name: options.name ?? '오버핏 코트',
    status: 'ACTIVE',
    minPrice: options.price ?? 10_000,
    maxPurchaseQuantity: options.productMax ?? null,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: options.price ?? 10_000,
    stock: options.stock ?? 10,
    maxPurchaseQuantity: options.maxPurchaseQuantity ?? null,
    isActive: true,
  })

  return { variantId: variant.id, sellerId: seller.id, price: options.price ?? 10_000 }
}

function client(): ApiClient {
  return api.clientAs(buyer)
}

function cart(): Promise<CartResponse> {
  return client().request({ path: '/cart', schema: cartResponseSchema })
}

function add(variantId: string, quantity: number): Promise<CartResponse> {
  return client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity },
    schema: cartResponseSchema,
  })
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
  }
}

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }

  const category = await createCategory(db, {})

  categoryId = category.id
})

describe('F1 — 담기와 합산', () => {
  it('adds a line and answers with the whole cart', async () => {
    const item = await listing()
    const answer = await add(item.variantId, 2)

    expect(answer.itemCount).toBe(1)
    expect(answer.groups[0]?.items[0]?.quantity).toBe(2)
    expect(answer.totalProductAmount).toBe(item.price * 2)
  })

  it('adds to the quantity rather than the line count', async () => {
    const item = await listing()

    await add(item.variantId, 2)

    const answer = await add(item.variantId, 3)

    // 줄이 둘이 아니라 수량이 5다. `CartItem_cartId_variantId_key` 가 그것을
    // 애플리케이션이 아니라 데이터베이스가 지키게 한다.
    expect(answer.itemCount).toBe(1)
    expect(answer.groups[0]?.items[0]?.quantity).toBe(5)
  })

  it('starts empty rather than 404 for somebody who has never added anything', async () => {
    const answer = await cart()

    expect(answer).toEqual({ groups: [], totalProductAmount: 0, itemCount: 0 })
  })
})

describe('F2 · F2b · F2c — 담을 수 있는 수량', () => {
  it('refuses more than the stock, and says how much is left (F2)', async () => {
    const item = await listing({ stock: 3 })
    const refused = await failure(add(item.variantId, 4))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('CART_STOCK_EXCEEDED')
    expect(refused.details).toEqual([expect.objectContaining({ params: { stock: 3 } })])
  })

  it('refuses more than the seller allows, with a different code (F2b)', async () => {
    // 재고는 기다리면 늘어날 수 있고 상한은 늘어나지 않는다 — 사람이 할 일이 다르다.
    const item = await listing({ stock: 100, maxPurchaseQuantity: 2 })
    const refused = await failure(add(item.variantId, 3))

    expect(refused.code).toBe('CART_PURCHASE_LIMIT')
    expect(refused.details).toEqual([expect.objectContaining({ params: { max: 2 } })])
  })

  it('takes the product default when the variant sets none', async () => {
    const item = await listing({ stock: 100, productMax: 2 })

    expect((await failure(add(item.variantId, 3))).code).toBe('CART_PURCHASE_LIMIT')
  })

  it('counts what is already there, so adding twice cannot get past it (F2c)', async () => {
    const item = await listing({ stock: 100, maxPurchaseQuantity: 2 })

    await add(item.variantId, 2)

    // 검사할 것은 요청의 1 이 아니라 **합산된 3** 이다. 요청의 수량만 보면
    // 상한이 한 번 더 담는 것으로 우회된다.
    const refused = await failure(add(item.variantId, 1))

    expect(refused.code).toBe('CART_PURCHASE_LIMIT')
  })

  it('refuses a listing that is not on sale', async () => {
    const owner = await createUser(db, {})
    const seller = await createSeller(db, { userId: owner.id })
    const product = await createProduct(db, { sellerId: seller.id, categoryId, status: 'DRAFT' })
    const variant = await createProductVariant(db, {
      productId: product.id,
      sellerId: seller.id,
      stock: 10,
    })

    expect((await failure(add(variant.id, 1))).code).toBe('CART_ITEM_UNAVAILABLE')
  })
})

describe('F3 — 판매자별 그룹핑', () => {
  it('returns one group per store, each with its own subtotal', async () => {
    const first = await listing({ price: 10_000, name: '코트' })
    const second = await listing({ price: 20_000, name: '니트' })
    const third = await listing({ price: 30_000, name: '머플러' })

    await add(first.variantId, 1)
    await add(second.variantId, 2)
    await add(third.variantId, 1)

    const answer = await cart()

    // 배송비가 판매자 단위로 붙고(D-023) 주문도 판매자별로 쪼개진다. 클라이언트가
    // 매번 묶으면 그 규칙이 여러 곳에 흩어진다.
    expect(answer.groups).toHaveLength(3)
    expect(answer.groups.map((group) => group.productAmount).sort((a, b) => a - b)).toEqual([
      10_000, 30_000, 40_000,
    ])
    expect(answer.totalProductAmount).toBe(80_000)
  })

  it('keeps two listings of one store in one group', async () => {
    const owner = await createUser(db, {})
    const seller = await createSeller(db, { userId: owner.id })
    // 두 **상품**이다. 옵션 없는 두 Variant 를 한 상품에 두면
    // `ProductVariant_product_signature_key` 가 거절한다 — 조합의 정규형이 둘 다
    // 빈 문자열이기 때문이다 (erd.md 「옵션 없는 상품도 Variant 를 하나 갖는다」).
    const products = await Promise.all([
      // `Product_active_price_check`: 판매 중인 상품은 살아 있는 가격을 가져야 한다.
      createProduct(db, {
        sellerId: seller.id,
        categoryId,
        name: '코트',
        status: 'ACTIVE',
        minPrice: 10_000,
      }),
      createProduct(db, {
        sellerId: seller.id,
        categoryId,
        name: '니트',
        status: 'ACTIVE',
        minPrice: 10_000,
      }),
    ])
    const [one, two] = await Promise.all(
      products.map(async (product) =>
        createProductVariant(db, { productId: product.id, sellerId: seller.id, stock: 5 }),
      ),
    )

    await add(one?.id ?? '', 1)
    await add(two?.id ?? '', 1)

    const answer = await cart()

    expect(answer.groups).toHaveLength(1)
    expect(answer.groups[0]?.items).toHaveLength(2)
  })
})

describe('F4 · F5 — 담은 뒤에 달라진 것', () => {
  it('reports a price rise and shows both numbers', async () => {
    const item = await listing({ price: 10_000 })

    await add(item.variantId, 1)
    await db.query('UPDATE "ProductVariant" SET "price" = 12000 WHERE "id" = $1', [item.variantId])

    const line = (await cart()).groups[0]?.items[0]

    expect(line?.notices).toEqual(['price_increased'])
    expect(line?.price).toBe(12_000)
    expect(line?.priceAtAdded).toBe(10_000)
  })

  it('reports sold out', async () => {
    const item = await listing({ stock: 5 })

    await add(item.variantId, 2)
    await db.query('UPDATE "ProductVariant" SET "stock" = 0 WHERE "id" = $1', [item.variantId])

    expect((await cart()).groups[0]?.items[0]?.notices).toEqual(['sold_out'])
  })

  it('reports a shortfall, which is a different thing to do about', async () => {
    const item = await listing({ stock: 5 })

    await add(item.variantId, 3)
    await db.query('UPDATE "ProductVariant" SET "stock" = 1 WHERE "id" = $1', [item.variantId])

    expect((await cart()).groups[0]?.items[0]?.notices).toEqual(['stock_reduced'])
  })

  it('keeps a withdrawn listing in the cart and says so (R1)', async () => {
    const item = await listing()

    await add(item.variantId, 1)
    await db.query(
      `UPDATE "Product" SET "status" = 'SUSPENDED' WHERE "id" IN
      (SELECT "productId" FROM "ProductVariant" WHERE "id" = $1)`,
      [item.variantId],
    )

    const answer = await cart()

    // 자동으로 지우지 않는다. 사라진 줄은 사람이 무엇을 잃었는지 알 수 없게 한다.
    expect(answer.itemCount).toBe(1)
    expect(answer.groups[0]?.items[0]?.notices).toEqual(['unavailable'])
  })
})

describe('수량 변경과 삭제', () => {
  it('assigns the quantity rather than adding to it', async () => {
    const item = await listing({ stock: 10 })
    const added = await add(item.variantId, 3)
    const lineId = added.groups[0]?.items[0]?.id ?? ''

    const answer = await client().request({
      path: `/cart/items/${lineId}`,
      method: 'PATCH',
      body: { quantity: 5 },
      schema: cartResponseSchema,
    })

    expect(answer.groups[0]?.items[0]?.quantity).toBe(5)
  })

  it('refuses a quantity the stock cannot meet', async () => {
    const item = await listing({ stock: 3 })
    const added = await add(item.variantId, 1)
    const lineId = added.groups[0]?.items[0]?.id ?? ''

    const refused = await failure(
      client().request({
        path: `/cart/items/${lineId}`,
        method: 'PATCH',
        body: { quantity: 4 },
        schema: cartResponseSchema,
      }),
    )

    expect(refused.code).toBe('CART_STOCK_EXCEEDED')
  })

  it('removes the lines it was given and leaves the rest', async () => {
    const first = await listing({ name: '코트' })
    const second = await listing({ name: '니트' })

    await add(first.variantId, 1)

    const both = await add(second.variantId, 1)
    const target = both.groups.flatMap((group) => group.items).find((line) => line.quantity === 1)

    const answer = await client().request({
      path: '/cart/items/remove',
      method: 'POST',
      body: { itemIds: [target?.id] },
      schema: cartResponseSchema,
    })

    expect(answer.itemCount).toBe(1)
  })

  it('ignores an id that belongs to somebody else rather than refusing', async () => {
    const item = await listing()
    const mine = await add(item.variantId, 1)

    const other = await createUser(db, {})
    const stranger: TestCaller = { userId: other.id, roles: ['BUYER'] }

    await api.clientAs(stranger).request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId: item.variantId, quantity: 1 },
      schema: cartResponseSchema,
    })

    // 남의 줄 id 를 섞어 보내도 그것은 지워지지 않는다. 거절이 아니라 무시이고,
    // 요청한 사람이 볼 수 있는 결과는 「내 것이 지워졌다」로 같다.
    const answer = await api.clientAs(stranger).request({
      path: '/cart/items/remove',
      method: 'POST',
      body: { itemIds: [mine.groups[0]?.items[0]?.id] },
      schema: cartResponseSchema,
    })

    expect(answer.itemCount).toBe(1)
    expect((await cart()).itemCount).toBe(1)
  })

  it('is a 404 for a line that is not in the caller’s cart', async () => {
    const item = await listing()
    const mine = await add(item.variantId, 1)

    const other = await createUser(db, {})
    const stranger: TestCaller = { userId: other.id, roles: ['BUYER'] }

    // 「남의 줄입니다」는 그 줄이 존재한다는 사실을 알려 준다.
    const refused = await failure(
      api.clientAs(stranger).request({
        path: `/cart/items/${mine.groups[0]?.items[0]?.id ?? ''}`,
        method: 'PATCH',
        body: { quantity: 2 },
        schema: cartResponseSchema,
      }),
    )

    expect(refused.status).toBe(404)
  })
})

describe('F6 — 비로그인 장바구니 병합', () => {
  it('merges what the browser held, summing what was already there', async () => {
    const first = await listing({ name: '코트' })
    const second = await listing({ name: '니트' })

    await add(first.variantId, 1)

    const answer = await client().request({
      path: '/cart/merge',
      method: 'POST',
      body: {
        items: [
          { variantId: first.variantId, quantity: 2 },
          { variantId: second.variantId, quantity: 1 },
        ],
      },
      schema: cartResponseSchema,
    })

    const lines = answer.groups.flatMap((group) => group.items)

    expect(answer.itemCount).toBe(2)
    expect(lines.find((line) => line.variantId === first.variantId)?.quantity).toBe(3)
  })

  it('caps at what can be bought instead of refusing the whole merge', async () => {
    const item = await listing({ stock: 100, maxPurchaseQuantity: 2 })

    const answer = await client().request({
      path: '/cart/merge',
      method: 'POST',
      body: { items: [{ variantId: item.variantId, quantity: 9 }] },
      schema: cartResponseSchema,
    })

    // 로그인 직후에 「장바구니를 합칠 수 없습니다」를 보여 주는 것은 아무도 원하지
    // 않는 화면이고, 그때 사람이 할 수 있는 일도 없다.
    expect(answer.groups[0]?.items[0]?.quantity).toBe(2)
  })

  it('skips what can no longer be bought, and keeps the rest', async () => {
    const gone = await listing()
    const alive = await listing({ name: '니트' })

    await db.query('UPDATE "ProductVariant" SET "isActive" = false WHERE "id" = $1', [
      gone.variantId,
    ])

    const answer = await client().request({
      path: '/cart/merge',
      method: 'POST',
      body: {
        items: [
          { variantId: gone.variantId, quantity: 1 },
          { variantId: alive.variantId, quantity: 1 },
        ],
      },
      schema: cartResponseSchema,
    })

    expect(answer.itemCount).toBe(1)
    expect(answer.groups[0]?.items[0]?.variantId).toBe(alive.variantId)
  })
})

describe('A7 — 동시에 담기', () => {
  it('cannot get past the purchase limit by adding twice at once', async () => {
    const item = await listing({ stock: 100, maxPurchaseQuantity: 2 })

    // 잠금이 없으면 둘 다 「지금 0개 있으니 2개는 괜찮다」를 읽고 둘 다 통과해
    // 4개가 된다 — 상한 검사가 읽은 값이 쓰는 시점에는 낡은 것이기 때문이다.
    const results = await concurrently(2, async () => add(item.variantId, 2))

    expect(fulfilled(results).length + rejected(results).length).toBe(2)

    const answer = await cart()

    expect(answer.groups[0]?.items[0]?.quantity).toBe(2)
    expect(rejected(results)).toHaveLength(1)
  })

  it('leaves one line, not two, when the same variant is added at once', async () => {
    const item = await listing({ stock: 100 })

    await concurrently(3, async () => add(item.variantId, 1))

    const answer = await cart()

    // `CartItem_cartId_variantId_key` 가 두 번째 줄을 막고, 잠금이 수량을 맞춘다.
    expect(answer.itemCount).toBe(1)
    expect(answer.groups[0]?.items[0]?.quantity).toBe(3)
  })
})

describe('F7 — 남을 가리킬 수 없다 (4.3)', () => {
  it('answers 401 without a token', async () => {
    expect(
      (await failure(api.client.request({ path: '/cart', schema: cartResponseSchema }))).status,
    ).toBe(401)
  })

  it('gives two accounts two carts, with no way to name the other', async () => {
    const item = await listing()

    await add(item.variantId, 2)

    const other = await createUser(db, {})
    const stranger: TestCaller = { userId: other.id, roles: ['BUYER'] }
    const theirs = await api
      .clientAs(stranger)
      .request({ path: '/cart', schema: cartResponseSchema })

    // 「남의 장바구니를 봤다」를 시도할 수가 없다 — 경로에 id 가 없다. 그래서
    // 재는 것은 거절이 아니라 **격리**다.
    expect(theirs.itemCount).toBe(0)
    expect((await cart()).itemCount).toBe(1)
  })
})
