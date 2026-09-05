import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import {
  cartResponseSchema,
  checkoutResponseSchema,
  orderListResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
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
import { recordStatements } from '../support/statements.js'

/**
 * 주문의 A1(응답 시간)과 A5(N+1 없음).
 *
 * A5 가 여기서 중요한 이유는 응답의 모양 때문이다. 주문은 **판매자별로 묶여**
 * 내려가고 줄마다 스냅샷이 붙는다 — 판매자가 셋이면 조회가 세 배가 되는 모양이고,
 * 그 회귀는 기능 검사를 하나도 빨갛게 만들지 않는다.
 *
 * 목록도 함께 잰다. 주문 20건의 항목을 전부 실으면 한 화면이 수백 줄을
 * 내려받는데, 그것은 느려지는 것이 아니라 **처음부터 그렇게 만든 것**이라 나중에
 * 눈치채기 어렵다.
 *
 * 통계는 실제 `PrismaClient` 에서 나온다. 모킹하지 않는다 (A6).
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

const SAMPLES = 30

/**
 * 표본 루프 **전체**의 예산.
 *
 * vitest 의 기본 5초는 한 요청의 예산이다. 표본 30개짜리 루프는 한 요청이 35ms 여도
 * 벽시계로 몇 초이고, 스위트 전체가 병렬로 도는 동안에는 그 몇 초가 5초를 넘는다 —
 * 그리고 그때 실패는 「p95 초과」가 아니라 **타임아웃**으로 나타나서, 성능 회귀처럼
 * 읽히지만 아니다. 실제로 전체 게이트에서 한 번 그렇게 빨개졌다.
 */
const SAMPLING_BUDGET_MS = 180_000

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

let buyer: TestCaller
let addressId: string
let categoryId: number

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

function client(): ApiClient {
  return api.clientAs(buyer)
}

/** 가게 하나에 조합 하나. */
async function variantOf(stock: number): Promise<string> {
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
    stock,
    isActive: true,
  })

  return variant.id
}

async function add(variantId: string): Promise<string> {
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity: 1 },
    schema: cartResponseSchema,
  })
  const line = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === variantId)

  return line?.id ?? ''
}

function place(itemIds: readonly string[]): Promise<{ order: { id: string } }> {
  return client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId },
    schema: orderResponseSchema,
  })
}

/** 판매자 `count` 곳에서 한 줄씩 담아 주문 하나를 만든다. */
async function orderAcross(count: number): Promise<string> {
  const itemIds: string[] = []

  for (let index = 0; index < count; index += 1) {
    itemIds.push(await add(await variantOf(50)))
  }

  const { order } = await place(itemIds)

  return order.id
}

describe('A1 — 응답 시간', () => {
  it(
    'creates a three-store order well inside 300ms at p95',
    { timeout: SAMPLING_BUDGET_MS },
    async () => {
      const durations: number[] = []

      for (let index = 0; index < SAMPLES; index += 1) {
        const itemIds = [await add(await variantOf(50)), await add(await variantOf(50))]
        const started = performance.now()

        await place(itemIds)
        durations.push(performance.now() - started)
      }

      expect(p95Of(durations)).toBeLessThan(300)
    },
  )

  it(
    'reads a ten-store order well inside 300ms at p95',
    { timeout: SAMPLING_BUDGET_MS },
    async () => {
      const orderId = await orderAcross(10)
      const durations: number[] = []
      const caller = client()

      for (let index = 0; index < SAMPLES; index += 1) {
        const started = performance.now()

        await caller.request({ path: `/orders/${orderId}`, schema: orderResponseSchema })
        durations.push(performance.now() - started)
      }

      expect(p95Of(durations)).toBeLessThan(300)
    },
  )
})

describe('A5 — 질의 수', () => {
  it(
    'reads an order in the same number of statements whether it has one store or ten',
    { timeout: SAMPLING_BUDGET_MS },
    async () => {
      const one = await orderAcross(1)
      const ten = await orderAcross(10)
      const caller = client()

      const forOne = await recordStatements(statements, () =>
        caller.request({ path: `/orders/${one}`, schema: orderResponseSchema }),
      )
      const forTen = await recordStatements(statements, () =>
        caller.request({ path: `/orders/${ten}`, schema: orderResponseSchema }),
      )

      // 판매자가 열이면 조회가 열 배가 되는 모양이 이 응답의 자연스러운 실패다.
      expect(forTen).toHaveLength(forOne.length)
    },
  )

  it(
    'lists orders in the same number of statements whether there are two or twenty',
    { timeout: SAMPLING_BUDGET_MS },
    async () => {
      const variantId = await variantOf(200)

      for (let index = 0; index < 2; index += 1) {
        const itemId = await add(variantId)

        await place([itemId])
        await client().request({
          path: '/cart/items/remove',
          method: 'POST',
          body: { itemIds: [itemId] },
          schema: cartResponseSchema,
        })
      }

      const forTwo = await recordStatements(statements, () =>
        client().request({ path: '/orders?limit=50', schema: orderListResponseSchema }),
      )

      for (let index = 0; index < 18; index += 1) {
        const itemId = await add(variantId)

        await place([itemId])
        await client().request({
          path: '/cart/items/remove',
          method: 'POST',
          body: { itemIds: [itemId] },
          schema: cartResponseSchema,
        })
      }

      const forTwenty = await recordStatements(statements, () =>
        client().request({ path: '/orders?limit=50', schema: orderListResponseSchema }),
      )

      expect(forTwenty).toHaveLength(forTwo.length)
    },
  )
})

describe('주문서 (TASK-0050)', () => {
  it(
    'opens a ten-store checkout well inside 300ms at p95',
    { timeout: SAMPLING_BUDGET_MS },
    async () => {
      const durations: number[] = []

      for (let index = 0; index < SAMPLES; index += 1) {
        const itemIds = [await add(await variantOf(50)), await add(await variantOf(50))]
        const started = performance.now()

        await client().request({
          path: '/checkouts',
          method: 'POST',
          body: { itemIds },
          schema: checkoutResponseSchema,
        })
        durations.push(performance.now() - started)
      }

      expect(p95Of(durations)).toBeLessThan(300)
    },
  )

  it(
    'reads a checkout in the same number of statements whether it holds one line or ten',
    { timeout: SAMPLING_BUDGET_MS },
    async () => {
      const one = await openAcross(1)
      const ten = await openAcross(10)
      const caller = client()

      const forOne = await recordStatements(statements, () =>
        caller.request({ path: `/checkouts/${one}`, schema: checkoutResponseSchema }),
      )
      const forTen = await recordStatements(statements, () =>
        caller.request({ path: `/checkouts/${ten}`, schema: checkoutResponseSchema }),
      )

      // 주문서는 예약에서 되짚어 그려진다. 줄이 열이면 조회가 열 배가 되는 모양이
      // 이 응답의 자연스러운 실패다.
      expect(forTen).toHaveLength(forOne.length)
    },
  )
})

/** 판매자 `count` 곳에서 한 줄씩 담아 주문서를 연다. */
async function openAcross(count: number): Promise<string> {
  const itemIds: string[] = []

  for (let index = 0; index < count; index += 1) {
    itemIds.push(await add(await variantOf(50)))
  }

  const { checkout } = await client().request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds },
    schema: checkoutResponseSchema,
  })

  return checkout.id
}
