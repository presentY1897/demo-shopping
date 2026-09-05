import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { ReservationService } from '../../src/reservation/reservation.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 예약 경로의 A1 · A5 (TASK-0048).
 *
 * 예약에는 자기 엔드포인트가 없다(4.2 ①). 그래서 A1 을 재는 대상은 두 가지다 —
 * 이 TASK 가 **모양을 바꾼 응답**인 상점 상품 상세와, TASK-0049 가 주문 트랜잭션
 * 안에서 부르게 될 **예약 자체**다. 뒤쪽을 지금 재 두는 이유는, 주문 생성이 느릴 때
 * 예약이 원인인지 아닌지를 그때 가서 가릴 수 없기 때문이다.
 *
 * A5 는 문장 수로 잰다. 예약이 무거워지는 방식은 하나뿐이다: 「몇 개 남았는지」를
 * 먼저 읽고 나서 갱신하는 모양으로 되돌아가는 것. 그러면 질의가 하나 늘고 동시에
 * 정확성도 잃는다.
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

let skuCounter = 0

function uniqueSkuPrefix(): string {
  skuCounter += 1
  return `RVP${String(process.env.VITEST_POOL_ID ?? '1')}X${String(skuCounter)}`
}

function reservations(): ReservationService {
  return api.resolve<ReservationService>(ReservationService)
}

let categoryId: number
let seller: TestCaller
let buyer: string

beforeEach(async () => {
  const { category } = await api.clientAs(callers.operator).createCategory({
    parentId: null,
    name: '의류',
    slug: uniqueSkuPrefix().toLowerCase(),
  })

  categoryId = category.id

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
  buyer = (await createUser(db)).id
})

function client(): ApiClient {
  return api.clientAs(seller)
}

const COLOUR_AND_SIZE = [
  { name: '색상', values: ['블랙', '아이보리', '카멜'].map((value) => ({ value })) },
  { name: '사이즈', values: ['S', 'M', 'L', 'XL'].map((value) => ({ value })) },
]

async function twelveVariantListing(): Promise<{ productId: string; variantIds: string[] }> {
  const { product } = await client().createProduct({
    categoryId,
    name: '오버사이즈 코트',
    skuPrefix: uniqueSkuPrefix(),
    status: 'ACTIVE',
    options: COLOUR_AND_SIZE,
    variantDefaults: { price: 189_000, stock: 500 },
  })

  return { productId: product.id, variantIds: product.variants.map((variant) => variant.id) }
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)

  return sorted[index] ?? 0
}

describe('A1 — 응답 시간', () => {
  it('answers a twelve-variant storefront detail well inside 300ms with holds on every SKU', async () => {
    const { productId, variantIds } = await twelveVariantListing()

    // 열두 조합 전부에 예약이 걸린 상태. 가용재고가 컬럼 하나라 예약이 몇 건이든
    // 상세 응답의 비용은 움직이지 않아야 한다 — 합계를 세는 모양이었다면 여기서
    // 열두 개의 부질의가 붙는다.
    for (const variantId of variantIds) {
      await reservations().hold({ variantId, quantity: 3, userId: buyer, checkoutId: randomUUID() })
    }

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getStorefrontProduct(productId)
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('holds a unit well inside 300ms at p95', async () => {
    const { variantIds } = await twelveVariantListing()
    const variantId = variantIds[0] ?? ''
    const durations: number[] = []

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await reservations().hold({ variantId, quantity: 1, userId: buyer, checkoutId: randomUUID() })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})

describe('A5 — 질의 수', () => {
  it('takes the same number of statements whether one hold is on the variant or fifty', async () => {
    const { productId, variantIds } = await twelveVariantListing()
    const variantId = variantIds[0] ?? ''

    await reservations().hold({ variantId, quantity: 1, userId: buyer, checkoutId: randomUUID() })

    const withOne = await recordStatements(statements, () =>
      client().getStorefrontProduct(productId),
    )

    for (let index = 0; index < 49; index += 1) {
      await reservations().hold({ variantId, quantity: 1, userId: buyer, checkoutId: randomUUID() })
    }

    const withFifty = await recordStatements(statements, () =>
      client().getStorefrontProduct(productId),
    )

    // 예약 건수는 상세 조회의 비용에 나타나지 않는다. `reserved` 가 캐시인 이유가
    // 이것이고, 그 대가로 정합성 점검이 필요하다.
    expect(withFifty).toHaveLength(withOne.length)
  })

  it('reserves in two statements on the winning path', async () => {
    const { variantIds } = await twelveVariantListing()
    const variantId = variantIds[0] ?? ''

    const made = await recordStatements(statements, () =>
      reservations().hold({ variantId, quantity: 1, userId: buyer, checkoutId: randomUUID() }),
    )

    // 조건부 갱신 하나와 예약 행 하나. 「몇 개 남았는지」는 **진 쪽만** 읽는다 —
    // 이 수가 늘었다면 읽고 나서 쓰는 모양으로 돌아간 것이고, 그때는 정확성도 함께
    // 잃는다. 트랜잭션 경계는 세지 않는다.
    expect(
      made.filter((query) => !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/u.test(query)),
    ).toHaveLength(2)
  })
})
