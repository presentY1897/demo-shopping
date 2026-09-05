import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { CartResponse } from '@shopping/shared'
import { cartResponseSchema } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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
import { recordStatements } from '../support/statements.js'

/**
 * 장바구니의 A1(응답 시간)과 A5(N+1 없음).
 *
 * A5 가 여기서 중요한 이유는 응답의 모양 때문이다. 판매자별로 묶어서 내려주고
 * 줄마다 상품·이미지·옵션·판매자를 함께 싣는다 — **판매자가 열 곳이면 조회가 열
 * 배가 되는 모양**이고, 그 회귀는 기능 검사를 하나도 빨갛게 만들지 않는다.
 *
 * 통계는 실제 `PrismaClient` 에서 나온다. 모킹하지 않는다(A6) — 운영과 다른 것은
 * 이 클라이언트가 자기가 실행한 것을 말한다는 점뿐이다.
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

const SAMPLES = 40

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

let buyer: TestCaller

function cart(): Promise<CartResponse> {
  return api.clientAs(buyer).request({ path: '/cart', schema: cartResponseSchema })
}

/** `sellers` stores, one listing each, all of it in the caller's cart. */
async function fill(sellers: number): Promise<void> {
  const category = await createCategory(db, {})

  const created = await db.one<{ id: string }>(
    `INSERT INTO "Cart" ("id", "userId", "updatedAt") VALUES (gen_random_uuid(), $1, now())
     RETURNING "id"`,
    [buyer.userId],
  )
  const cartId = created.id

  for (let index = 0; index < sellers; index += 1) {
    const owner = await createUser(db, {})
    const seller = await createSeller(db, { userId: owner.id })
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'ACTIVE',
      minPrice: 10_000,
    })
    const variant = await createProductVariant(db, {
      productId: product.id,
      sellerId: seller.id,
      stock: 10,
    })

    await db.query(
      `INSERT INTO "CartItem"
         ("id", "cartId", "variantId", "sellerId", "quantity", "priceAtAdded", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 1, 10000, now())`,
      [cartId, variant.id, seller.id],
    )
  }
}

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
})

describe('A5 — 판매자가 늘어도 질의는 늘지 않는다', () => {
  it('costs the same number of statements for one store and for ten', async () => {
    await fill(1)

    const one = await recordStatements(statements, cart)

    const account = await createUser(db, {})

    buyer = { userId: account.id, roles: ['BUYER'] }
    await fill(10)

    const ten = await recordStatements(statements, cart)

    // **기울기 0이 이 검사의 전부다.** 판매자별 그룹핑을 API 가 하기 때문에
    // (D-023) 응답 모양이 「판매자마다 한 번 더」를 부르기 쉬운데, 그렇게 되면
    // 기능 검사는 전부 통과한 채로 열 배가 된다.
    expect(ten.length).toBe(one.length)
  })

  it('reads the whole cart without a statement per line', async () => {
    await fill(5)

    const seen = await recordStatements(statements, cart)
    const cartReads = seen.filter((statement) => /"CartItem"|"Cart"/.test(statement))

    // 계정 한 번, 장바구니 한 번. 줄마다 한 번이면 다섯 번이다.
    expect(cartReads.length).toBeLessThanOrEqual(2)
  })
})

describe('A1 — 응답 시간', () => {
  it('answers a ten-store cart well inside 300ms at p95', async () => {
    await fill(10)

    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await cart()
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})
