import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  dashboardMetricsResponseSchema,
  dashboardPendingResponseSchema,
  dashboardSystemResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEMO_CLEANUP_LAST_RUN_KEY,
  DEMO_CLEANUP_STALE_AFTER_MS,
} from '../../src/demo/demo-cleanup.js'
import { SWEEP_LAST_RUN_KEY } from '../../src/reservation/reservation-sweeper.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 관리자 대시보드 (TASK-0092), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **이 화면의 값은 셋에 몰려 있다.**
 *
 * - **숫자가 맞는가** (F1). 대시보드의 숫자는 아무도 검산하지 않는다 — 틀려도
 *   그럴듯해 보이고, 그 상태로 판단의 근거가 된다.
 * - **밀린 일이 사라지지 않는가** (F2). 기간 밖으로 밀려난 할 일은 화면에서 없는
 *   것과 같다.
 * - **멈춘 배치가 드러나는가** (F4). 조용히 멈추는 것이 이 화면이 막으려는 일이다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 2026-09-09 05:00 UTC = KST 2026-09-09 14:00. */
const NOW = '2026-09-09T05:00:00.000Z'

let operator: TestCaller
let buyer: TestCaller
let sellerId: string
let otherSellerId: string
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }

  sellerId = (await createSeller(db, { userId: (await createUser(db)).id })).id
  otherSellerId = (await createSeller(db, { userId: (await createUser(db)).id })).id
  store = await createSellableVariant(db, { stock: 100 })
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

interface SeedOptions {
  readonly sellerId?: string
  readonly status?: string
  readonly createdAt?: string
  readonly amount?: number
}

/** 판매자 몫 하나. 대시보드가 읽는 칸만 심는다. */
async function seed(options: SeedOptions = {}): Promise<void> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const amount = options.amount ?? 10_000

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             $4, $4, now())`,
    [orderId, `20260909-${String(sequence).padStart(8, '0')}`, buyer.userId, amount],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4::"SellerOrderStatus", '가상브랜드', $5, $5, 0, $6::timestamptz, now())`,
    [
      sellerOrderId,
      orderId,
      options.sellerId ?? sellerId,
      options.status ?? 'CONFIRMED',
      amount,
      options.createdAt ?? NOW,
    ],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "commissionRateBp", "updatedAt")
     SELECT gen_random_uuid(), $1, $2, pv."productId", $3::jsonb, $4, 1, $4, 1000, now()
       FROM "ProductVariant" pv WHERE pv."id" = $2`,
    [
      sellerOrderId,
      store.variant.id,
      JSON.stringify({ productId: store.product.id, productName: '울 코트' }),
      amount,
    ],
  )
}

function metrics(caller: TestCaller, query = '') {
  return client(caller).request({
    path: `/admin/dashboard/metrics${query}`,
    schema: dashboardMetricsResponseSchema,
  })
}

function pending(caller: TestCaller) {
  return client(caller).request({
    path: '/admin/dashboard/pending',
    schema: dashboardPendingResponseSchema,
  })
}

function system(caller: TestCaller) {
  return client(caller).request({
    path: '/admin/dashboard/system',
    schema: dashboardSystemResponseSchema,
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

describe('지표 (F1)', () => {
  it('sums every store’s sales, not one store’s', async () => {
    await seed({ sellerId, amount: 10_000 })
    await seed({ sellerId: otherSellerId, amount: 25_000 })

    const answer = await metrics(operator)

    expect(answer.current).toMatchObject({
      salesAmount: 35_000,
      orderCount: 2,
      activeSellers: 2,
    })
  })

  /** 결제를 기다리는 것과 실패한 것은 판매가 아니다. */
  it('leaves out what was never paid for', async () => {
    await seed({ status: 'PAID', amount: 10_000 })
    await seed({ status: 'PAYMENT_PENDING', amount: 999_000 })

    expect((await metrics(operator)).current.salesAmount).toBe(10_000)
  })

  /**
   * **「활성 판매자」는 판 스토어다.** 등록된 스토어 수가 아니다 — 그 수는 한 번
   * 오르면 안 내려가므로 어느 날 전부 장사를 접어도 그대로다.
   */
  it('counts a store as active only when it sold something in the window', async () => {
    await seed({ sellerId, amount: 10_000 })

    // 두 스토어가 등록돼 있지만 판 곳은 하나다.
    expect((await metrics(operator)).current.activeSellers).toBe(1)
  })

  /**
   * 데모 계정은 **가입이 아니다.** 버튼 한 번에 발급되는 것이라 함께 세면 「신규
   * 가입」이 데모를 눌러 본 횟수가 되고, 진짜 가입은 그 안에 묻힌다.
   */
  it('does not count a demo account as a sign-up', async () => {
    const before = (await metrics(operator)).current.newUsers

    // **`createdAt` is the fact this test is about.** The metric counts sign-ups
    // inside a KST day range taken from the injected clock, so the accounts have
    // to be stamped by that same clock — left to the database they land wherever
    // the wall clock is, and fall outside the range the moment the calendar
    // moves past `NOW` (TASK-0122).
    await createUser(db, { isDemo: true, createdAt: NOW })

    expect((await metrics(operator)).current.newUsers).toBe(before)

    await createUser(db, { createdAt: NOW })

    expect((await metrics(operator)).current.newUsers).toBe(before + 1)
  })

  it('puts each day in its own KST bucket and fills the gaps', async () => {
    // KST 로 9월 8일 오전 0시 30분 = UTC 9월 7일 15시 30분.
    await seed({ createdAt: '2026-09-07T15:30:00.000Z', amount: 7_000 })
    await seed({ createdAt: NOW, amount: 3_000 })

    const answer = await metrics(operator, '?from=2026-09-07&to=2026-09-09')
    const byDate = new Map(answer.days.map((day) => [day.date, day.salesAmount]))

    expect(answer.days).toHaveLength(3)
    expect(byDate.get('2026-09-07')).toBe(0)
    expect(byDate.get('2026-09-08')).toBe(7_000)
    expect(byDate.get('2026-09-09')).toBe(3_000)
  })
})

describe('증감 (F3)', () => {
  /**
   * **직전 같은 길이 기간**이다. 「지난달」이 아닌 이유는 기간을 사람이 고르기
   * 때문이다 — 7일을 보는 사람에게 지난달과의 비교를 내밀면 그 수는 화면의 어느
   * 것과도 짝이 맞지 않는다.
   */
  it('compares against the same number of days immediately before', async () => {
    await seed({ createdAt: '2026-09-09T01:00:00.000Z', amount: 10_000 })
    // 하루 전 = 직전 기간.
    await seed({ createdAt: '2026-09-08T01:00:00.000Z', amount: 4_000 })

    const answer = await metrics(operator, '?from=2026-09-09&to=2026-09-09')

    expect(answer.current.salesAmount).toBe(10_000)
    expect(answer.previous.salesAmount).toBe(4_000)
  })

  it('answers zero rather than nothing when the previous period was empty', async () => {
    await seed({ createdAt: '2026-09-09T01:00:00.000Z' })

    const answer = await metrics(operator, '?from=2026-09-09&to=2026-09-09')

    expect(answer.previous).toEqual({
      salesAmount: 0,
      orderCount: 0,
      newUsers: 0,
      activeSellers: 0,
    })
  })
})

describe('순위', () => {
  it('ranks stores by what they sold', async () => {
    await seed({ sellerId, amount: 5_000 })
    await seed({ sellerId: otherSellerId, amount: 30_000 })

    const [top] = (await metrics(operator)).topSellers

    expect(top).toMatchObject({ sellerId: otherSellerId, salesAmount: 30_000 })
  })

  /** 이름은 **팔릴 때의 것**이다. 지워진 상품도 순위에 남는다. */
  it('names a product from the snapshot the order kept', async () => {
    await seed({ amount: 12_000 })
    await db.execute(`UPDATE "Product" SET "name" = '이름이 바뀐 상품' WHERE "id" = $1`, [
      store.product.id,
    ])

    const [top] = (await metrics(operator)).topProducts

    expect(top).toMatchObject({ name: '울 코트', salesAmount: 12_000 })
  })
})

describe('처리 대기 (F2)', () => {
  it('counts what is waiting for a person, each in its own bucket', async () => {
    await db.execute(`UPDATE "Seller" SET "status" = 'PENDING'::"SellerStatus" WHERE "id" = $1`, [
      sellerId,
    ])

    const answer = await pending(operator)

    expect(answer.sellerApplications).toBe(1)
    expect(answer).toMatchObject({ reports: 0, settlements: 0, claims: 0 })
  })

  /**
   * **기간을 받지 않는다.** 3주 전에 들어온 신청도 아직 안 봤으면 오늘의 할 일이다 —
   * 기간을 받으면 그 기간 밖의 밀린 일이 화면에서 사라지고, 이 화면이 존재하는 이유가
   * 사라진다.
   */
  it('still counts an application that has been waiting for weeks', async () => {
    await db.execute(
      `UPDATE "Seller" SET "status" = 'PENDING'::"SellerStatus",
                           "createdAt" = $2::timestamptz WHERE "id" = $1`,
      [sellerId, '2026-06-01T00:00:00.000Z'],
    )

    expect((await pending(operator)).sellerApplications).toBe(1)
  })
})

describe('시스템 상태 (F4)', () => {
  it('reports every scheduler, and says which never ran', async () => {
    const answer = await system(operator)

    expect(answer.schedulers.length).toBeGreaterThan(0)
    // 아무것도 안 돌린 상태다. **`never` 이지 `stale` 이 아니다** — 갓 뜬 프로세스의
    // 정상 상태를 사고와 같은 색으로 칠하면 사람이 그 색을 안 믿게 된다.
    expect(answer.schedulers.every((row) => row.status === 'never')).toBe(true)
    expect(answer.schedulers.every((row) => row.lastRunAt === null)).toBe(true)
  })

  it('turns a recent run into ok', async () => {
    await db.execute(`INSERT INTO "AppMeta" ("key", "value", "updatedAt") VALUES ($1, $2, now())`, [
      SWEEP_LAST_RUN_KEY,
      NOW,
    ])

    const row = (await system(operator)).schedulers.find(
      (entry) => entry.key === SWEEP_LAST_RUN_KEY,
    )

    expect(row).toMatchObject({ status: 'ok', lastRunAt: NOW })
  })

  /** **이 검사가 이 섹션이 있는 이유다** — 조용히 멈춘 배치를 화면이 말해야 한다. */
  it('turns a run that stopped moving into stale', async () => {
    const stopped = new Date(Date.parse(NOW) - DEMO_CLEANUP_STALE_AFTER_MS - 60_000)

    await db.execute(`INSERT INTO "AppMeta" ("key", "value", "updatedAt") VALUES ($1, $2, now())`, [
      DEMO_CLEANUP_LAST_RUN_KEY,
      stopped.toISOString(),
    ])

    const row = (await system(operator)).schedulers.find(
      (entry) => entry.key === DEMO_CLEANUP_LAST_RUN_KEY,
    )

    expect(row?.status).toBe('stale')
  })

  /**
   * **`demoExpiresAt` 은 시간대가 없는 `timestamp` 다.**
   *
   * 그래서 심는 쪽과 읽는 쪽이 같은 규약을 써야 한다. 서비스는 청소기와 같이 Prisma
   * 로 읽고(그쪽은 그 값을 UTC 로 해석한다), `createUser` 는 `pg` 에 `Date` 를 넘겨
   * **세션 시간대로** 적는다 — 그 둘을 섞으면 이 검사가 KST 머신에서 9시간 어긋난다.
   * 그래서 여기서는 시간대 없는 문자열을 그대로 적어 Prisma 가 읽을 값을 못 박는다
   * (`demo.integration.spec.ts` 가 같은 함정을 반대 방향으로 적어 두었다).
   */
  it('counts the demo accounts that are about to expire', async () => {
    async function demoExpiringAt(naive: string): Promise<void> {
      const user = await createUser(db, { isDemo: true })

      await db.execute(`UPDATE "User" SET "demoExpiresAt" = $2::timestamp WHERE "id" = $1`, [
        user.id,
        naive,
      ])
    }

    // NOW 는 2026-09-09T05:00:00Z 다.
    await demoExpiringAt('2026-09-09 05:30:00')
    await demoExpiringAt('2026-09-09 10:00:00')

    expect((await system(operator)).demo).toEqual({ activeAccounts: 2, expiringWithinHour: 1 })
  })
})

describe('권한 (F6)', () => {
  /** 구매자는 `order.read:own` 이라 **전체를 읽는 이 문**을 지나지 못한다. */
  it.each([
    ['metrics', () => metrics(buyer)],
    ['pending', () => pending(buyer)],
    ['system', () => system(buyer)],
  ])('refuses a buyer at /%s', async (_route, call) => {
    expect(await failure(call())).toBe(403)
  })

  it('lets a demo admin read, because reading is not writing', async () => {
    const demoAdmin: TestCaller = {
      userId: (await createUser(db, { isDemo: true })).id,
      roles: ['DEMO_ADMIN'],
    }

    await expect(metrics(demoAdmin)).resolves.toBeDefined()
  })
})
