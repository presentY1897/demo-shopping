import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import {
  adminOrderSearchResponseSchema,
  adminSellerListResponseSchema,
  dashboardMetricsResponseSchema,
  dashboardPendingResponseSchema,
  dashboardSystemResponseSchema,
} from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 관리자 콘솔의 A1·A5 (TASK-0092 F5 · TASK-0094 · TASK-0095 §6.2 3장).
 *
 * ## 왜 이 화면인가
 *
 * 대시보드는 **플랫폼 전체를 가로질러** 세는 유일한 화면이다. 다른 화면은 한 사람이나
 * 한 스토어로 좁혀져 있어 데이터가 늘어도 각자의 몫만 늘지만, 여기는 전부를 센다 —
 * 느려진다면 여기가 먼저다. 그리고 느려진 것을 **아무도 신고하지 않는다**: 관리자
 * 한 명이 하루에 몇 번 여는 화면이라 그 사람이 참는다.
 *
 * ## 두 가지를 잰다
 *
 * 시간(A1)은 기준표가 요구한 것이고, **문장 수**(A5)는 그 시간이 왜 그런지를 말한다.
 * 시간만 재면 「빠른 기계에서 통과하는 잘못된 구현」을 못 잡는다 — 주문이 늘 때마다
 * 조회가 하나씩 늘어도 500건에서는 여전히 빠를 수 있다.
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

/** 2026-09-20 05:00 UTC = KST 14:00. */
const NOW = '2026-09-20T05:00:00.000Z'

/** 기준표가 말하는 규모. */
const ORDERS = 500

let operator: TestCaller

beforeEach(async () => {
  api.clock.set(NOW)
  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
})

function client(): ApiClient {
  return api.clientAs(operator)
}

/**
 * 주문 500건을 **한 번에** 심는다.
 *
 * 한 건씩 서비스를 지나면 이 준비만 몇 분이고, 재는 것은 읽기이므로 쓰기 경로를 지날
 * 이유가 없다. 스토어를 다섯 곳으로 나누는 것은 순위와 「활성 판매자」가 한 곳짜리
 * 데이터에서는 아무 일도 안 하기 때문이다.
 */
async function fill(): Promise<void> {
  const store = await createSellableVariant(db, { stock: 1_000 })
  const buyerId = (await createUser(db)).id
  const sellerIds = [store.seller.id]

  for (let index = 0; index < 4; index += 1) {
    sellerIds.push((await createSeller(db, { userId: (await createUser(db)).id })).id)
  }

  const orderIds = Array.from({ length: ORDERS }, () => randomUUID())
  const sellerOrderIds = Array.from({ length: ORDERS }, () => randomUUID())

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "createdAt", "updatedAt")
     SELECT id,
            '20260920-' || lpad(ordinality::text, 8, '0'),
            $2::uuid, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
            10000, 10000,
            -- 30일에 고르게 흩는다. 하루에 몰아 두면 일별 집계가 한 줄만 만든다.
            $3::timestamptz - make_interval(days => (ordinality % 30)::int),
            now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)`,
    [orderIds, buyerId, NOW],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "createdAt", "updatedAt")
     SELECT so.id, o.id, ($3::uuid[])[1 + (o.ordinality % 5)],
            'CONFIRMED'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0,
            ord."createdAt", now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS so(id, ordinality)
       JOIN unnest($2::uuid[]) WITH ORDINALITY AS o(id, ordinality)
         ON o.ordinality = so.ordinality
       JOIN "Order" ord ON ord."id" = o.id`,
    [sellerOrderIds, orderIds, sellerIds],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "commissionRateBp", "updatedAt")
     SELECT gen_random_uuid(), so.id, pv."id", pv."productId",
            jsonb_build_object('productName', '울 코트'), 10000, 1, 10000, 1000, now()
       FROM unnest($1::uuid[]) AS so(id), "ProductVariant" pv
      WHERE pv."id" = $2::uuid`,
    [sellerOrderIds, store.variant.id],
  )
}

function metrics(): Promise<unknown> {
  return client().request({
    path: '/admin/dashboard/metrics',
    schema: dashboardMetricsResponseSchema,
  })
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

describe('응답 시간 (A1 · F5)', () => {
  it('answers the headline metrics well inside 500ms at p95 over 500 orders', async () => {
    await fill()

    const durations: number[] = []

    for (let index = 0; index < 20; index += 1) {
      const started = performance.now()

      await metrics()
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(500)
  })

  /**
   * 처리 대기는 **자주 다시 읽히는 답**이다 (화면이 돌아올 때마다). 지표보다 훨씬
   * 가벼워야 하고, 그렇지 않으면 「할 일 몇 건」을 보려고 전체 집계만큼을 기다린다.
   */
  it('answers the queue much faster than the metrics', async () => {
    await fill()

    const started = performance.now()

    await client().request({
      path: '/admin/dashboard/pending',
      schema: dashboardPendingResponseSchema,
    })

    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('주문이 늘어도 질의는 늘지 않는다 (A5)', () => {
  /**
   * **기울기 0이 이 검사의 전부다.**
   *
   * 시간만 재면 주문마다 조회가 하나씩 느는 구현도 500건에서는 통과할 수 있다 —
   * 그리고 그 구현은 5,000건에서 무너지는데, 그때는 이미 운영 중이다.
   */
  it('costs the same number of statements with no orders and with five hundred', async () => {
    // 빈 상태에서 한 번, 500건에서 한 번. 두 끝을 견주는 것이 기울기를 재는 가장
    // 싼 방법이고, 중간 지점은 그 사이를 지날 수밖에 없다.
    const few = await recordStatements(statements, () => metrics())

    await fill()

    const many = await recordStatements(statements, () => metrics())

    expect(many.length).toBe(few.length)
  })
})

describe('스토어가 늘어도 질의는 늘지 않는다 (TASK-0094 A5)', () => {
  /**
   * **4.4 가 걱정한 것이 정확히 이것이다.**
   *
   * 스토어마다 매출·클레임·상품 수를 따로 물으면 스무 곳일 때 조회가 예순 번이다 —
   * 그리고 그 회귀는 기능 검사를 **하나도** 빨갛게 만들지 않는다. 목록은 여전히 맞는
   * 수를 그리고, 다만 느려질 뿐이다.
   */
  it('costs the same number of statements for one store and for twenty', async () => {
    const stores = client().request({
      path: '/admin/stores?limit=100',
      schema: adminSellerListResponseSchema,
    })

    await stores

    const forFew = await recordStatements(statements, () =>
      client().request({ path: '/admin/stores?limit=100', schema: adminSellerListResponseSchema }),
    )

    for (let index = 0; index < 20; index += 1) {
      await createSeller(db, { userId: (await createUser(db)).id })
    }

    const forMany = await recordStatements(statements, () =>
      client().request({ path: '/admin/stores?limit=100', schema: adminSellerListResponseSchema }),
    )

    expect(forMany.length).toBe(forFew.length)
  })
})

describe('주문이 늘어도 묶음 조회는 한 번이다 (TASK-0095 A5)', () => {
  /**
   * 묶음을 주문마다 물으면 스무 줄이 스물한 번이 된다 (4.3). 화면은 맞게 그려지므로
   * 그 회귀도 조용하다.
   */
  it('reads every bundle in one statement, whatever the page holds', async () => {
    await fill()

    const seen = await recordStatements(statements, () =>
      client().request({
        path: '/admin/orders?limit=50',
        schema: adminOrderSearchResponseSchema,
      }),
    )
    const bundleReads = seen.filter((statement) =>
      /FROM\s+"public"\."SellerOrder"/iu.test(statement),
    )

    expect(bundleReads).toHaveLength(1)
  })
})

describe('인덱스가 질의를 받는다 (S3 · TASK-0097 F5)', () => {
  async function planOf(sql: string, values: readonly unknown[] = []): Promise<string> {
    const rows = await db.query<Record<string, string>>(`EXPLAIN ${sql}`, values)

    return rows.map((row) => Object.values(row).join(' ')).join('\n')
  }

  /**
   * **CS 가 가장 먼저 손에 쥐는 값이 주문번호다.** 그것을 훑어서 찾으면 주문이 쌓일수록
   * 느려지고, 그 느려짐은 「문의 전화를 받은 사람이 기다리는 시간」으로 나타난다.
   */
  it('plans a unique index scan for an order number', async () => {
    await fill()
    await db.execute(`ANALYZE "Order"`)

    const [order] = await db.query<{ orderNumber: string }>(
      `SELECT "orderNumber" FROM "Order" LIMIT 1`,
    )
    const plan = await planOf(`SELECT "id" FROM "Order" WHERE "orderNumber" = $1`, [
      order?.orderNumber,
    ])

    expect(plan).toContain('Order_orderNumber_key')
    expect(plan).not.toContain('Seq Scan')
  })

  /**
   * 주문의 묶음을 한 번에 읽는 질의 (`bundlesOf`).
   *
   * **표를 크게 만들어 놓고 잰다.** 500행짜리 표에서는 순차 스캔이 옳은 계획이라,
   * 작은 픽스처로 재면 그 검사는 인덱스가 아니라 **픽스처를 재는 것**이 된다 —
   * 상품 쪽 S3 검사가 같은 이유로 카테고리와 스토어를 흩어 놓는다.
   */
  it('plans an index scan for the bundles of a page of orders', async () => {
    // 스토어가 있어야 묶음이 만들어진다 — 없으면 아래 INSERT 가 0행을 넣고, 표가
    // 작아 순차 스캔이 옳은 계획이 되어 **검사가 픽스처를 재게 된다.**
    await fill()
    await db.execute(
      `INSERT INTO "Order"
         ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
          "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
       -- 주문번호는 형식을 DB 가 지킨다 (\`Order_orderNumber_format_check\`):
       -- 8자리 날짜 + Crockford base32 8자. 대량 행도 그 형식이어야 한다.
       SELECT gen_random_uuid(), '20260925-' || lpad(to_char(n, 'FM99999999'), 8, '0'),
              u."id", gen_random_uuid(),
              '홍길동', '010-0000-0000', '06234', '서울시 강남구', 10000, 10000, now()
         FROM generate_series(1, 20000) AS n,
              LATERAL (SELECT "id" FROM "User" LIMIT 1) AS u`,
    )
    await db.execute(
      `INSERT INTO "SellerOrder"
         ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
          "shippingFee", "updatedAt")
       SELECT gen_random_uuid(), o."id", s."id", 'CONFIRMED'::"SellerOrderStatus",
              '대량', 10000, 10000, 0, now()
         FROM "Order" o, LATERAL (SELECT "id" FROM "Seller" LIMIT 1) AS s
        WHERE o."orderNumber" LIKE '20260925-%'`,
    )
    await db.execute(`ANALYZE "SellerOrder"`)

    const ids = await db.query<{ id: string }>(
      `SELECT "id" FROM "Order" WHERE "orderNumber" LIKE '20260925-%' LIMIT 20`,
    )
    const plan = await planOf(`SELECT "id" FROM "SellerOrder" WHERE "orderId" = ANY($1::uuid[])`, [
      ids.map((row) => row.id),
    ])

    // `@@unique([orderId, sellerId])` 가 만드는 인덱스가 이것을 받는다. 없으면 한
    // 페이지를 그릴 때마다 판매자 몫 표 전체를 훑는다.
    expect(plan).toContain('SellerOrder_orderId_sellerId_key')
    expect(plan).not.toContain('Seq Scan on "SellerOrder"')
  })

  /**
   * **불려 놓은 표를 되돌린다.**
   *
   * 행은 다음 검사의 `beforeEach` 가 지우지만 **통계는 지우지 않는다** — 방금 돌린
   * `ANALYZE` 가 「이 표에 2만 행이 있다」를 남기고, 비어 있는 표에 그 통계가 붙어
   * 있으면 뒤따르는 질의가 엉뚱한 계획을 받는다. 시간을 재는 검사가 같은 워커를
   * 쓰므로(`--maxWorkers=1`) 그 대가는 **다른 파일의 p95** 로 나타나고, 그때는
   * 원인이 여기라는 것을 아무도 모른다.
   *
   * 이 저장소가 실제로 겪었다: 이 검사를 넣은 PR 에서 대시보드 p95 가 500ms 예산에
   * 702ms 로 걸렸고, 로컬에서는 통과했다.
   */
  afterAll(async () => {
    await db.execute(`TRUNCATE TABLE "SellerOrder", "Order" RESTART IDENTITY CASCADE`)
    await db.execute(`ANALYZE "SellerOrder"`)
    await db.execute(`ANALYZE "Order"`)
  })
})

describe('시스템 상태는 데이터 양과 무관하다', () => {
  /** 배치 표와 큐 깊이는 주문 수를 보지 않는다 — 늘어도 같은 값이어야 한다. */
  it('costs the same however many orders there are', async () => {
    const before = await recordStatements(statements, () =>
      client().request({ path: '/admin/dashboard/system', schema: dashboardSystemResponseSchema }),
    )

    await fill()

    const after = await recordStatements(statements, () =>
      client().request({ path: '/admin/dashboard/system', schema: dashboardSystemResponseSchema }),
    )

    expect(after.length).toBe(before.length)
  })
})
