import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  commissionRateListResponseSchema,
  commissionRateResponseSchema,
  commissionSimulationResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_COMMISSION_RATE_BP } from '../../src/settlement/commission-rate.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategoryBranch,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 수수료율 (TASK-0079), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 어느 요율이 이기는가는 `commission-rate.spec.ts` 가 순수 함수로 잰다. **여기서
 * 재는 것은 그 판정이 실제 주문과 이력에 닿는가**이고, 값은 넷에 몰려 있다.
 *
 * - **누가 바꿀 수 있는가** (F7). 요율은 모든 판매자의 다음 정산을 한 번에 옮기는
 *   값이라, 데모 관리자가 만질 수 있으면 방문자가 플랫폼의 수익 구조를 바꾼다.
 * - **바꾼 것이 이력으로 남는가** (F5). 남지 않으면 「언제부터 이 요율이었나」의
 *   답이 어디에도 없고, 정산 이의 제기에 답할 방법이 사라진다.
 * - **이미 판 것이 따라 움직이지 않는가** (F4). 움직이면 어제 동의한 조건이 오늘
 *   달라지는 것이고, 그것은 계약이 아니다.
 * - **미리보기가 영향을 부풀리지 않는가** (F6). 부풀리면 그 숫자를 보고 내린 결정이
 *   전부 틀린 전제 위에 선다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-07T00:00:00.000Z'
const LATER = '2026-09-08T00:00:00.000Z'

let superAdmin: TestCaller
let operator: TestCaller
let demoAdmin: TestCaller
let buyer: TestCaller
let addressId: string
let tree: Awaited<ReturnType<typeof createCategoryBranch>>

beforeEach(async () => {
  api.clock.set(NOW)

  superAdmin = { userId: (await createUser(db)).id, roles: ['ADMIN_SUPER'] }
  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  demoAdmin = { userId: (await createUser(db)).id, roles: ['DEMO_ADMIN'] }

  const account = await createUser(db)

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  tree = await createCategoryBranch(db)
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function setRate(
  caller: TestCaller,
  body: { sellerId?: string | null; categoryId?: number | null; rateBp: number },
): Promise<{ rate: { id: string; rateBp: number; scope: string; validUntil: string | null } }> {
  return client(caller).request({
    path: '/commission-rates',
    method: 'PUT',
    body,
    schema: commissionRateResponseSchema,
  })
}

function query(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString()

  return search === '' ? '' : `?${search}`
}

function listRates(caller: TestCaller, params: Record<string, string> = {}) {
  return client(caller).request({
    path: `/commission-rates${query(params)}`,
    method: 'GET',
    schema: commissionRateListResponseSchema,
  })
}

interface Listing {
  readonly variantId: string
  readonly sellerId: string
  readonly price: number
}

/** 잎 카테고리에 걸린 가게 하나와 그 물건 하나. */
async function listing(options: { readonly price?: number } = {}): Promise<Listing> {
  const owner = await createUser(db)
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId: tree.leaf.id,
    status: 'ACTIVE',
    minPrice: options.price ?? 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: options.price ?? 10_000,
    stock: 10,
    isActive: true,
  })

  return { variantId: variant.id, sellerId: seller.id, price: options.price ?? 10_000 }
}

/** 담고 주문한다. 돌려주는 것은 그 주문의 항목에 박힌 요율들이다. */
async function placeAndReadRates(variantId: string): Promise<readonly (number | null)[]> {
  const cart = await client(buyer).request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity: 1 },
    schema: cartResponseSchema,
  })
  const line = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === variantId)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  const { order } = await client(buyer).request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [line.id], addressId },
    schema: orderResponseSchema,
  })

  const rows = await db.query<{ commissionRateBp: number | null }>(
    `SELECT oi."commissionRateBp"
       FROM "OrderItem" oi
       JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
      WHERE so."orderId" = $1`,
    [order.id],
  )

  return rows.map((row) => row.commissionRateBp)
}

/**
 * 방금 만든 주문들을 결제까지 끝난 것으로 만든다.
 *
 * 상태 머신을 지나지 않고 직접 쓰는 이유는 여기서 재는 것이 전이가 아니기 때문이다.
 * **미리보기가 세는 것은 실제로 팔린 것**이고, 결제를 기다리는 주문은 아직 판매가
 * 아니다 — 그 구분을 만들려면 이 줄이 필요하다.
 */
async function settleAll(): Promise<void> {
  await db.query(
    `UPDATE "SellerOrder" SET "status" = 'CONFIRMED' WHERE "status" = 'PAYMENT_PENDING'`,
  )
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

describe('누가 바꿀 수 있는가 (F7)', () => {
  it('최고 관리자는 요율을 바꾼다', async () => {
    const { rate } = await setRate(superAdmin, { rateBp: 500 })

    expect(rate).toMatchObject({ rateBp: 500, scope: 'global', validUntil: null })
  })

  /**
   * 운영자에게 없는 것은 스코프가 아니라 **권한 자체**다. 거절이 조건문이 아니라
   * 권한 목록의 빈자리에서 나온다는 것이 이 검사의 값이다.
   */
  it('운영자는 읽지만 바꾸지 못한다', async () => {
    await setRate(superAdmin, { rateBp: 500 })

    const seen = await listRates(operator)

    expect(seen.rates).toHaveLength(1)
    expect(await failure(setRate(operator, { rateBp: 700 }))).toBe(403)
  })

  /** 데모 관리자는 운영자에서 파생되므로 같은 자리에서 같은 이유로 막힌다. */
  it('데모 관리자도 바꾸지 못한다', async () => {
    expect(await failure(setRate(demoAdmin, { rateBp: 700 }))).toBe(403)
  })

  it('구매자는 요율을 읽지도 못한다', async () => {
    expect(await failure(listRates(buyer))).toBe(403)
  })
})

describe('이력 (F5)', () => {
  it('바꾸면 앞의 행이 닫히고 새 행이 열린다', async () => {
    await setRate(superAdmin, { rateBp: 500 })
    api.clock.set(LATER)
    await setRate(superAdmin, { rateBp: 700 })

    const open = await listRates(superAdmin)
    const history = await listRates(superAdmin, { history: 'true' })

    expect(open.rates).toHaveLength(1)
    expect(open.rates[0]).toMatchObject({ rateBp: 700, validUntil: null })
    expect(history.rates.map((rate) => rate.rateBp)).toEqual([700, 500])
    expect(history.rates[1]?.validUntil).toBe(LATER)
  })

  it('누가 바꿨는지 남는다', async () => {
    await setRate(superAdmin, { rateBp: 500 })

    const { rates } = await client(superAdmin).request({
      path: '/commission-rates',
      method: 'GET',
      schema: commissionRateListResponseSchema,
    })

    expect(rates[0]?.createdBy.id).toBe(superAdmin.userId)
  })

  /** 이력이 똑같은 줄로 채워지면 **정말 바뀐 날**을 찾을 수 없게 된다. */
  it('같은 값으로 다시 바꾸면 줄이 늘지 않는다', async () => {
    const first = await setRate(superAdmin, { rateBp: 500 })

    api.clock.set(LATER)
    const again = await setRate(superAdmin, { rateBp: 500 })

    expect(again.rate.id).toBe(first.rate.id)
    expect((await listRates(superAdmin, { history: 'true' })).rates).toHaveLength(1)
  })

  /**
   * 같은 순간에 두 번 바꾸면 앞의 행은 **어느 시점에도 적용된 적이 없다.** 닫아서
   * 남기면 길이가 0인 기간이 이력에 끼고, 그런 행은 읽는 사람에게 아무 말도 하지
   * 않는다.
   */
  it('한 순간 안의 재수정은 이력이 아니라 고쳐 쓰기다', async () => {
    const first = await setRate(superAdmin, { rateBp: 500 })
    const amended = await setRate(superAdmin, { rateBp: 700 })

    expect(amended.rate.id).toBe(first.rate.id)
    expect(amended.rate.rateBp).toBe(700)
  })
})

describe('범위', () => {
  it('스토어와 카테고리를 동시에 지정할 수 없다', async () => {
    const store = await listing()

    const denied = await failure(
      setRate(superAdmin, { sellerId: store.sellerId, categoryId: tree.leaf.id, rateBp: 300 }),
    )

    expect(denied).toBe(400)
  })

  it('없는 카테고리의 요율은 만들 수 없다', async () => {
    expect(await failure(setRate(superAdmin, { categoryId: 999_999, rateBp: 300 }))).toBe(404)
  })
})

describe('주문 시점의 요율 (F4)', () => {
  it('설정한 요율이 주문 항목에 박힌다', async () => {
    const store = await listing()

    await setRate(superAdmin, { sellerId: store.sellerId, rateBp: 250 })

    expect(await placeAndReadRates(store.variantId)).toEqual([250])
  })

  it('아무 설정이 없으면 기본율이 박힌다 — `NULL` 이 아니다', async () => {
    const store = await listing()

    expect(await placeAndReadRates(store.variantId)).toEqual([DEFAULT_COMMISSION_RATE_BP])
  })

  it('조상 카테고리에 건 요율이 잎의 상품에 적용된다', async () => {
    const store = await listing()

    await setRate(superAdmin, { categoryId: tree.root.id, rateBp: 300 })

    expect(await placeAndReadRates(store.variantId)).toEqual([300])
  })

  /** **여기가 F4 다.** 요율을 올려도 어제 판 것의 수수료는 그대로다. */
  it('요율을 바꿔도 이미 만들어진 주문은 따라 움직이지 않는다', async () => {
    const store = await listing()

    await setRate(superAdmin, { sellerId: store.sellerId, rateBp: 250 })
    const before = await placeAndReadRates(store.variantId)

    api.clock.set(LATER)
    await setRate(superAdmin, { sellerId: store.sellerId, rateBp: 900 })

    const after = await db.query<{ commissionRateBp: number | null }>(
      `SELECT "commissionRateBp" FROM "OrderItem" ORDER BY "createdAt"`,
    )

    expect(before).toEqual([250])
    expect(after.map((row) => row.commissionRateBp)).toEqual([250])
  })
})

describe('미리보기 (F6)', () => {
  function simulate(params: Record<string, string>) {
    return client(superAdmin).request({
      path: `/commission-rates/simulation${query(params)}`,
      method: 'GET',
      schema: commissionSimulationResponseSchema,
    })
  }

  it('지난 판매에 지금 요율과 새 요율을 나란히 적용한다', async () => {
    const store = await listing({ price: 10_000 })

    await setRate(superAdmin, { sellerId: store.sellerId, rateBp: 1_000 })
    await placeAndReadRates(store.variantId)
    await settleAll()

    const answer = await simulate({ sellerId: store.sellerId, rateBp: '2000' })

    expect(answer).toEqual({
      salesAmount: 10_000,
      currentAmount: 1_000,
      proposedAmount: 2_000,
      sellerOrderCount: 1,
    })
  })

  /**
   * **부풀리지 않는 것이 이 기능의 전부다.** 개별 계약이 있는 가게는 카테고리 요율을
   * 바꿔도 아무 영향을 받지 않는데, 그 판매까지 합에 넣으면 미리보기가 거짓말을 한다.
   */
  it('판매자 개별율에 가려진 판매는 카테고리 미리보기에서 빠진다', async () => {
    const contracted = await listing({ price: 10_000 })
    const plain = await listing({ price: 20_000 })

    await setRate(superAdmin, { sellerId: contracted.sellerId, rateBp: 500 })
    await placeAndReadRates(contracted.variantId)
    await placeAndReadRates(plain.variantId)
    await settleAll()

    const answer = await simulate({ categoryId: String(tree.leaf.id), rateBp: '2000' })

    expect(answer.salesAmount).toBe(20_000)
    expect(answer.sellerOrderCount).toBe(1)
  })

  /** 결제를 기다리는 주문은 아직 판매가 아니다 — 실패하거나 시간이 지나면 사라진다. */
  it('결제 전 주문은 세지 않는다', async () => {
    const store = await listing({ price: 10_000 })

    await placeAndReadRates(store.variantId)

    expect((await simulate({ rateBp: '2000' })).sellerOrderCount).toBe(0)
  })

  it('비교할 판매가 없으면 0을 답한다', async () => {
    const answer = await simulate({ rateBp: '2000' })

    expect(answer).toEqual({
      salesAmount: 0,
      currentAmount: 0,
      proposedAmount: 0,
      sellerOrderCount: 0,
    })
  })
})
