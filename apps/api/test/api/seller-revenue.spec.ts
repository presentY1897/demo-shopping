import { randomUUID } from 'node:crypto'

import type { ApiClient, SellerRevenueResponse, SettlementOutlookResponse } from '@shopping/shared'
import {
  ApiClientError,
  sellerRevenueResponseSchema,
  settlementOutlookResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 판매자의 매출과 정산 예정 (TASK-0082), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **판매자 콘솔의 완성 지점**이고, 값이 셋에 몰려 있다.
 *
 * - **남의 숫자가 보이지 않는가** (F1). 남의 매출은 그 가게의 영업 기밀이다.
 * - **예정 금액이 실제 정산액과 같은 계산인가** (F3 · F4). 다르면 판매자는 화면에서
 *   본 숫자와 다른 돈을 받고, 그것은 문의가 아니라 신뢰의 문제다.
 * - **두 단계가 섞이지 않는가** (F4). 합치면 「받기로 확정된 돈」과 「아직 취소될 수
 *   있는 돈」이 같은 숫자가 되고, 판매자는 그 합을 확정된 금액으로 읽는다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 2026-09-09 05:00 UTC = KST 2026-09-09 14:00. */
const NOW = '2026-09-09T05:00:00.000Z'

let seller: TestCaller
let sellerId: string
let rival: TestCaller
let rivalSellerId: string
let operator: TestCaller
let buyerId: string
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  const owner = await createUser(db)
  const mine = await createSeller(db, { userId: owner.id })

  sellerId = mine.id
  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: mine.id }

  const other = await createUser(db)
  const theirs = await createSeller(db, { userId: other.id })

  rivalSellerId = theirs.id
  rival = { userId: other.id, roles: ['SELLER_OWNER'], sellerId: theirs.id }

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  buyerId = (await createUser(db)).id
  store = await createSellableVariant(db, { stock: 100 })
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

interface SeedOptions {
  readonly sellerId?: string
  readonly status?: string
  readonly createdAt?: string
  readonly unitPrice?: number
  readonly quantity?: number
  readonly commissionRateBp?: number
  readonly sellerCouponDiscountAmount?: number
  readonly confirmed?: boolean
}

/** 판매자 몫 하나. 매출과 정산이 읽는 칸을 그대로 심는다. */
async function seed(options: SeedOptions = {}): Promise<string> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const unitPrice = options.unitPrice ?? 10_000
  const quantity = options.quantity ?? 1
  const productAmount = unitPrice * quantity

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             $4, $4, now())`,
    [orderId, `20260908-${String(sequence).padStart(8, '0')}`, buyerId, productAmount],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4::"SellerOrderStatus", '가상브랜드', $5, $5, 0,
             $6::timestamptz, now())`,
    [
      sellerOrderId,
      orderId,
      options.sellerId ?? sellerId,
      options.status ?? 'CONFIRMED',
      productAmount,
      options.createdAt ?? NOW,
    ],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productSnapshot", "unitPrice", "quantity",
        "productAmount", "couponDiscountAmount", "sellerCouponDiscountAmount",
        "discountAmount", "commissionRateBp", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4, $5, $6, $7, $7, $7, $8, now())`,
    [
      sellerOrderId,
      store.variant.id,
      JSON.stringify({ productId: store.product.id, productName: '울 코트' }),
      unitPrice,
      quantity,
      productAmount,
      options.sellerCouponDiscountAmount ?? 0,
      options.commissionRateBp ?? 1_000,
    ],
  )

  if (options.confirmed === true) {
    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
       VALUES (gen_random_uuid(), $1, 'DELIVERED'::"SellerOrderStatus",
               'CONFIRMED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", now())`,
      [sellerOrderId],
    )
  }

  return sellerOrderId
}

function revenue(caller: TestCaller, query = ''): Promise<SellerRevenueResponse> {
  return client(caller).request({
    path: `/seller-revenue${query}`,
    schema: sellerRevenueResponseSchema,
  })
}

function outlook(caller: TestCaller, query = ''): Promise<SettlementOutlookResponse> {
  return client(caller).request({
    path: `/seller-settlement-outlook${query}`,
    schema: settlementOutlookResponseSchema,
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

describe('자기 것만 보인다 (F1)', () => {
  /** 스토어를 지정하지 않으면 자기 것이다 — 화면이 자기 id 를 실어 보낼 이유가 없다. */
  it('스토어를 지정하지 않으면 자기 매출이다', async () => {
    await seed()
    await seed({ sellerId: rivalSellerId })

    expect((await revenue(seller)).totals.salesAmount).toBe(10_000)
  })

  it('남의 스토어를 지정하면 거절한다', async () => {
    expect(await failure(revenue(seller, `?sellerId=${rivalSellerId}`))).toBe(403)
    expect(await failure(outlook(rival, `?sellerId=${sellerId}`))).toBe(403)
  })

  /** 관리자는 어느 스토어든 볼 수 있다 — 판매자의 문의에 답하려면 같은 화면이 필요하다. */
  it('관리자는 남의 스토어도 지정해서 볼 수 있다', async () => {
    await seed()

    expect((await revenue(operator, `?sellerId=${sellerId}`)).totals.salesAmount).toBe(10_000)
  })

  /** 스토어가 없는 계정이 스토어를 말하지 않았다 — 플랫폼 전체 매출은 이 문의 답이 아니다. */
  it('관리자가 스토어를 지정하지 않으면 답할 것이 없다', async () => {
    expect(await failure(revenue(operator))).toBe(404)
  })
})

describe('기간별 매출 (F5 · F6)', () => {
  /**
   * **판매가 없던 날도 한 칸씩 있다.** 빈 날을 빼면 그래프가 그 구간을 건너뛰어
   * 그리고, 「이 주에 3일 쉬었다」가 「매출이 완만했다」로 보인다.
   */
  it('기간 안의 모든 날이 한 칸씩 있다', async () => {
    await seed()

    const answer = await revenue(seller, '?from=2026-09-07&to=2026-09-09')

    expect(answer.days.map((day) => day.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09'])
    expect(answer.days.map((day) => day.salesAmount)).toEqual([0, 0, 10_000])
  })

  it('주지 않으면 오늘까지의 최근 30일이다', async () => {
    const answer = await revenue(seller)

    expect(answer.days).toHaveLength(30)
    expect(answer.to).toBe('2026-09-09')
    expect(answer.from).toBe('2026-08-11')
  })

  /** 날짜는 KST 달력이다 — UTC 로 세면 자정 근처의 주문이 하루씩 밀린다. */
  it('KST 달력 날짜로 묶는다', async () => {
    // KST 2026-09-08 08:59 = UTC 2026-09-07 23:59
    await seed({ createdAt: '2026-09-07T23:59:00.000Z' })

    const answer = await revenue(seller, '?from=2026-09-07&to=2026-09-08')

    expect(answer.days).toEqual([
      { date: '2026-09-07', salesAmount: 0, orderCount: 0 },
      { date: '2026-09-08', salesAmount: 10_000, orderCount: 1 },
    ])
  })

  it('결제 전과 취소된 몫은 매출이 아니다', async () => {
    await seed({ status: 'PAYMENT_PENDING' })
    await seed({ status: 'CANCELED' })
    await seed({ status: 'PAID' })

    expect((await revenue(seller)).totals.orderCount).toBe(1)
  })

  it('평균 주문금액을 함께 답하고, 주문이 없으면 0이다', async () => {
    await seed({ unitPrice: 10_000 })
    await seed({ unitPrice: 21_000 })

    expect((await revenue(seller)).totals.averageOrderAmount).toBe(15_500)
    expect((await revenue(rival)).totals.averageOrderAmount).toBe(0)
  })

  /** 비교 기간은 **바로 앞의 같은 길이**다. 분모를 서버가 정해 화면마다 갈리지 않게 한다. */
  it('바로 앞의 같은 길이 기간을 함께 답한다 (F6)', async () => {
    await seed({ createdAt: '2026-09-09T05:00:00.000Z' })
    await seed({ createdAt: '2026-09-06T05:00:00.000Z', unitPrice: 30_000 })

    const answer = await revenue(seller, '?from=2026-09-08&to=2026-09-09')

    expect(answer.totals.salesAmount).toBe(10_000)
    expect(answer.previous.salesAmount).toBe(30_000)
  })

  it('많이 팔린 상품을 금액순으로 답한다', async () => {
    await seed({ quantity: 2 })

    const answer = await revenue(seller)

    expect(answer.topProducts).toEqual([
      { productId: store.product.id, productName: '울 코트', quantity: 2, salesAmount: 20_000 },
    ])
  })

  it('뒤집힌 기간에도 500 을 내지 않는다', async () => {
    const answer = await revenue(seller, '?from=2026-09-09&to=2026-09-01')

    expect(answer.days).toHaveLength(1)
  })
})

describe('정산 예정 금액 (F4)', () => {
  /**
   * **두 단계가 섞이지 않는다.** 배송완료는 아직 반품될 수 있는 돈이고, 구매확정은
   * 다음 회차에 실릴 돈이다 — 합치면 판매자는 그 합을 확정된 금액으로 읽는다.
   */
  it('확정 대기와 정산 대기를 나눠서 답한다', async () => {
    await seed({ status: 'DELIVERED' })
    await seed({ status: 'CONFIRMED', confirmed: true, unitPrice: 20_000 })

    const answer = await outlook(seller)

    expect(answer.awaitingConfirmation).toEqual({ sellerOrderCount: 1, payoutAmount: 9_000 })
    expect(answer.awaitingSettlement).toEqual({ sellerOrderCount: 1, payoutAmount: 18_000 })
  })

  /**
   * **정산서가 쓰는 것과 같은 계산이다** (F3). 수수료와 판매자 부담 쿠폰이 빠지고,
   * 플랫폼 부담은 빠지지 않는다.
   */
  it('수수료와 판매자 부담 쿠폰을 뺀 금액이다', async () => {
    await seed({
      status: 'CONFIRMED',
      confirmed: true,
      unitPrice: 10_000,
      commissionRateBp: 1_000,
      sellerCouponDiscountAmount: 2_000,
    })

    expect((await outlook(seller)).awaitingSettlement.payoutAmount).toBe(7_000)
  })

  /** 이미 정산된 몫은 예정이 아니다 — 두 번 세면 판매자는 두 배를 기대한다. */
  it('이미 정산서에 실린 몫은 빠진다', async () => {
    const sellerOrderId = await seed({ status: 'CONFIRMED', confirmed: true })
    const settlementId = randomUUID()

    await db.execute(
      `INSERT INTO "Settlement"
         ("id", "sellerId", "periodStart", "periodEnd", "salesAmount", "commissionAmount",
          "sellerCouponAmount", "returnAdjustmentAmount", "payoutAmount", "updatedAt")
       VALUES ($1, $2, '2026-08-31T00:00:00.000Z', '2026-09-07T00:00:00.000Z',
               10000, 1000, 0, 0, 9000, now())`,
      [settlementId, sellerId],
    )
    await db.execute(
      `INSERT INTO "SettlementItem"
         ("id", "settlementId", "type", "sellerOrderId", "salesAmount", "commissionAmount",
          "sellerCouponAmount", "payoutAmount")
       VALUES (gen_random_uuid(), $1, 'SALE'::"SettlementItemType", $2, 10000, 1000, 0, 9000)`,
      [settlementId, sellerOrderId],
    )

    expect((await outlook(seller)).awaitingSettlement).toEqual({
      sellerOrderCount: 0,
      payoutAmount: 0,
    })
  })

  it('아무것도 없으면 0이다', async () => {
    expect(await outlook(seller)).toEqual({
      awaitingConfirmation: { sellerOrderCount: 0, payoutAmount: 0 },
      awaitingSettlement: { sellerOrderCount: 0, payoutAmount: 0 },
    })
  })
})
