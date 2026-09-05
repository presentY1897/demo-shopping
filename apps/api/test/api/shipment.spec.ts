import { randomBytes, randomUUID } from 'node:crypto'

import type { ApiClient, ShipmentResponse } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  demoCarrierNames,
  orderResponseSchema,
  sellerOrderTransitionResponseSchema,
  shipmentResponseSchema,
  TRACKING_NUMBER_PREFIX,
} from '@shopping/shared'
import { DatabaseError } from 'pg'
import { beforeEach, describe, expect, it } from 'vitest'

import { ShipmentService } from '../../src/shipping/shipment.service.js'
import {
  hasDemoTrackingFormat,
  TRACKING_NUMBER_DIGITS,
  TRACKING_NUMBER_PATTERN,
  trackingNumberFrom,
} from '../../src/shipping/shipment-rules.js'
import { useApiApp } from '../support/api-app.js'
import { concurrently, fulfilled } from '../support/concurrently.js'
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
import { callers } from '../support/principal.js'

/**
 * 가상 배송 (TASK-0061), 이 워커의 실제 데이터베이스에 대고.
 *
 * **이 파일이 지키는 것은 「발송했다는데 운송장이 없는 상태가 만들어질 수 없다」이다.**
 * 그 문장은 두 조각으로 나뉘고, 조각마다 지키는 것이 다르다.
 *
 * - **발급과 전이가 갈라지지 않는다** — 한 트랜잭션이다. 그래서 발송할 수 없는
 *   주문에 발송을 걸면 운송장도 이벤트도 **남지 않는다**. 아래에서 상태만 보지 않고
 *   `Shipment` 의 행 수를 함께 세는 이유다.
 * - **번호의 사본이 원본과 갈라지지 않는다** — 복합 외래키다. 그 제약을 SQL 로 직접
 *   때려 보는 검사가 S5 이고, 그것이 「단일 출처를 옮겼다」는 말의 유일한 증거다.
 *
 * 번호의 형식과 운송사 목록은 `src/shipping/shipment-rules.spec.ts` 가 순수 함수로
 * 재고, 여기서 재는 것은 **그 규칙이 실제 행과 응답에 적용되는가**다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 번호 1,000개를 뽑는 F3 검사의 표본 수. */
const NUMBER_SAMPLES = 1_000

/** A1. 로컬 부하 측정 p95. */
const P95_BUDGET_MS = 300

/** 표본 루프 전체의 예산. 실패가 「p95 초과」로 보고돼야지 타임아웃으로 나오면 안 된다. */
const SAMPLING_BUDGET_MS = 120_000

const SAMPLES = 20

let buyer: TestCaller
let stranger: TestCaller
let addressId: string
let categoryId: number
let placed: Placed

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly seller: TestCaller
}

interface ShipmentRow {
  readonly id: string
  readonly trackingNumber: string
  readonly carrierCode: string
  readonly status: string
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

/** 팔 수 있는 조합 하나와 그 가게의 주인. */
async function listing(): Promise<{ variantId: string; seller: TestCaller }> {
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
    stock: 10,
    isActive: true,
  })

  return {
    variantId: variant.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id },
  }
}

/** 진짜 주문 하나. 장바구니 → 주문. */
async function place(): Promise<Placed> {
  const store = await listing()
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId: store.variantId, quantity: 1 },
    schema: cartResponseSchema,
  })
  const line = cart.groups.flatMap((group) => group.items).at(0)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [line.id], addressId },
    schema: orderResponseSchema,
  })
  const sellerOrderId = order.sellerOrders.at(0)?.id

  if (sellerOrderId === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  return { orderId: order.id, sellerOrderId, seller: store.seller }
}

/**
 * 이 몫을 발송 직전 상태로 옮긴다.
 *
 * 문을 지나지 않고 SQL 로 쓰는 이유는 여기서 재는 것이 **발송**이기 때문이다.
 * 결제·판매자 확인까지 실제로 지나가면 이 파일은 그 두 TASK 의 검사가 되고, 그것들이
 * 깨질 때 배송 검사가 함께 빨개진다.
 */
function moveTo(status: string): Promise<unknown> {
  return db.query(
    `WITH cleared AS (DELETE FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1)
     UPDATE "SellerOrder" SET "status" = $2::"SellerOrderStatus" WHERE "id" = $1`,
    [placed.sellerOrderId, status],
  )
}

/** 사건을 적는 자리는 HTTP 로 열려 있지 않다 — 부르는 것은 우리 코드뿐이다 (F6). */
function shipments(): ShipmentService {
  return api.resolve<ShipmentService>(ShipmentService)
}

function shipOver(caller: TestCaller, body: unknown = {}): Promise<ShipmentResponse> {
  return client(caller).request({
    path: `/seller-orders/${placed.sellerOrderId}/shipment`,
    method: 'POST',
    body,
    schema: shipmentResponseSchema,
  })
}

function readOver(caller: TestCaller, sellerOrderId = placed.sellerOrderId) {
  return client(caller).request({
    path: `/seller-orders/${sellerOrderId}/shipment`,
    method: 'GET',
    schema: shipmentResponseSchema,
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

/** DB 가 거부한 것이 맞는지, 그리고 어느 제약이 거부했는지 (S5). */
async function refusal(work: Promise<unknown>): Promise<DatabaseError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof DatabaseError)) {
    throw new Error(`DB 가 거부할 것으로 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return error
}

function shipmentsOf(): Promise<ShipmentRow[]> {
  return db.query<ShipmentRow>(
    `SELECT "id", "trackingNumber", "carrierCode", "status"::text AS "status"
       FROM "Shipment" WHERE "sellerOrderId" = $1`,
    [placed.sellerOrderId],
  )
}

function orderState(): Promise<{ status: string; trackingNumber: string | null; history: number }> {
  return db.one(
    `SELECT "status"::text AS "status", "trackingNumber",
            (SELECT count(*)::int FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1) AS "history"
       FROM "SellerOrder" WHERE "id" = $1`,
    [placed.sellerOrderId],
  )
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

function eventCount(): Promise<number> {
  return db
    .one<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "ShipmentTrackingEvent" e
         JOIN "Shipment" s ON s."id" = e."shipmentId"
        WHERE s."sellerOrderId" = $1`,
      [placed.sellerOrderId],
    )
    .then((row) => row.count)
}

beforeEach(async () => {
  api.clock.set('2026-09-03T00:00:00.000Z')

  const account = await createUser(db, {})
  const other = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  stranger = { userId: other.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  placed = await place()
  await moveTo('PREPARING')
})

/** 제약을 때려 보는 INSERT. Prisma 를 지나면 애플리케이션이 먼저 답한다. */
function insertShipment(
  overrides: Partial<{ sellerOrderId: string; carrierCode: string; trackingNumber: string }>,
): Promise<unknown> {
  return db.query(
    `INSERT INTO "Shipment"
       ("id", "sellerOrderId", "carrierCode", "carrierName", "trackingNumber", "shippedAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, '가온물류', $3, now(), now())`,
    [
      overrides.sellerOrderId ?? placed.sellerOrderId,
      overrides.carrierCode ?? 'GA',
      overrides.trackingNumber ?? 'DEMO-GA-000000000002',
    ],
  )
}

describe('발송 처리 (F1)', () => {
  it('issues a waybill, moves the order and records the first tracking event together', async () => {
    const { shipment } = await shipOver(placed.seller)

    expect(shipment.sellerOrderId).toBe(placed.sellerOrderId)
    expect(shipment.status).toBe('READY')
    expect(shipment.shippedAt).toBe('2026-09-03T00:00:00.000Z')
    expect(shipment.deliveredAt).toBeNull()
    expect(shipment.carrierName).toBe(demoCarrierNames[shipment.carrierCode])

    // **첫 줄은 집화다.** 운송장만 나오고 이력이 비어 있으면 추적 화면은 「배송
    // 중」이라고 말해 놓고 아무것도 보여 주지 못한다.
    expect(shipment.events).toHaveLength(1)
    expect(shipment.events.at(0)).toMatchObject({ kind: 'PICKED_UP' })
    expect(shipment.events.at(0)?.location.length).toBeGreaterThan(0)
    expect(shipment.events.at(0)?.description.length).toBeGreaterThan(0)
    expect(shipment.events.at(0)?.occurredAt).toBe(shipment.shippedAt)

    // 셋이 **함께** 만들어졌다: 전이(이력 한 줄) · 운송장 · 이벤트.
    expect(await orderState()).toEqual({
      status: 'SHIPPED',
      trackingNumber: shipment.trackingNumber,
      history: 1,
    })
    expect(await eventCount()).toBe(1)
  })

  it('writes the transition through the state machine, with the seller as its actor', async () => {
    await shipOver(placed.seller)

    const history = await db.one<{ fromStatus: string; toStatus: string; actor: string }>(
      `SELECT "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
              "actor"::text AS "actor"
         FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1`,
      [placed.sellerOrderId],
    )

    // 상태를 직접 쓰지 않고 문을 지났다는 증거다. 직접 썼다면 이력이 없다.
    expect(history).toMatchObject({ fromStatus: 'PREPARING', toStatus: 'SHIPPED', actor: 'SELLER' })
  })

  it('honours the carrier the seller picked', async () => {
    const { shipment } = await shipOver(placed.seller, { carrierCode: 'NR' })

    expect(shipment.carrierCode).toBe('NR')
    expect(shipment.carrierName).toBe(demoCarrierNames.NR)
    // 번호 가운데 칸은 운송사와 **같은 것을 말해야** 한다. DB 의 CHECK 도 같은 것을 본다.
    expect(shipment.trackingNumber.startsWith('DEMO-NR-')).toBe(true)
  })

  it('answers the retry with the same waybill and leaves the history alone', async () => {
    const first = await shipOver(placed.seller)
    const second = await shipOver(placed.seller)

    // 두 번 누른 판매자에게 오류를 보이지 않는다 — 그 사람이 원한 결과는 이미 있다.
    expect(second.shipment.id).toBe(first.shipment.id)
    expect(second.shipment.trackingNumber).toBe(first.shipment.trackingNumber)
    expect(await shipmentsOf()).toHaveLength(1)
    expect(await eventCount()).toBe(1)
    expect((await orderState()).history).toBe(1)
  })

  it('refuses an order that cannot ship, and leaves no waybill behind', async () => {
    await moveTo('PAID')

    const refused = await failure(shipOver(placed.seller))

    expect(refused).toMatchObject({ status: 409, code: 'ORDER_TRANSITION_UNDEFINED' })
    // **한 트랜잭션이라는 말의 값이 이 두 줄이다.** 갈라져 있으면 발송되지 않은
    // 주문에 운송장이 남고, 그 번호는 아무 배송도 가리키지 않는다.
    expect(await shipmentsOf()).toEqual([])
    expect(await orderState()).toMatchObject({ status: 'PAID', trackingNumber: null, history: 0 })
  })

  it('refuses the buyer who ordered it', async () => {
    // 발송은 파는 쪽의 일이다 (`state-machines.md` 1장). 산 사람에게는 스토어
    // 소유권이 없으므로 문 앞에서 끝난다.
    expect(await failure(shipOver(buyer))).toMatchObject({ status: 403 })
    expect(await shipmentsOf()).toEqual([])
  })

  it('refuses another store', async () => {
    expect(await failure(shipOver(callers.seller))).toMatchObject({ status: 403 })
    expect(await shipmentsOf()).toEqual([])
  })

  it('answers 401 to a caller with no session', async () => {
    const refused = await failure(
      api.client.request({
        path: `/seller-orders/${placed.sellerOrderId}/shipment`,
        method: 'POST',
        body: {},
        schema: shipmentResponseSchema,
      }),
    )

    expect(refused.status).toBe(401)
  })

  it('refuses a carrier nobody has heard of', async () => {
    // A2. 목록에 없는 운송사를 받아 주면 번호 가운데 칸에 아무 글자나 들어가고,
    // 그 순간 「번호를 보면 운송사를 안다」가 거짓이 된다.
    const refused = await failure(shipOver(placed.seller, { carrierCode: 'ZZ' }))

    expect(refused.status).toBe(400)
    expect(await shipmentsOf()).toEqual([])
  })

  it('issues one waybill when two ship requests race (A7)', async () => {
    const results = await concurrently(2, () => shipOver(placed.seller))
    const issued = fulfilled(results)

    // 둘 다 성공하되 **같은 배송**이다. 잠금이 없으면 뒤에 온 쪽이 유니크 위반으로
    // 500 을 받는데, 그것은 사용자가 볼 이유가 없는 오류다.
    expect(issued).toHaveLength(2)
    expect(new Set(issued.map((result) => result.shipment.id)).size).toBe(1)
    expect(await shipmentsOf()).toHaveLength(1)
    expect(await eventCount()).toBe(1)
    expect((await orderState()).history).toBe(1)
  })
})

describe('운송장 번호 (F2 · F3)', () => {
  it('is distinguishable from a real waybill', async () => {
    const { shipment } = await shipOver(placed.seller)

    // R1. 화면의 「가상 배송 정보」 안내는 스크린샷 한 장이 지나가는 순간 사라지지만
    // 번호는 남는다. 남는 쪽이 스스로 「진짜가 아니다」를 말해야 한다.
    expect(shipment.trackingNumber.startsWith(`${TRACKING_NUMBER_PREFIX}-`)).toBe(true)
    expect(shipment.trackingNumber).toMatch(TRACKING_NUMBER_PATTERN)
    expect(hasDemoTrackingFormat(shipment.trackingNumber)).toBe(true)
  })

  it('never repeats itself over a thousand draws (F3)', () => {
    // 1,000건을 실제로 발급하면 1,000번의 왕복이고, 재는 것은 결국 난수다. 마지막
    // 방어선인 유니크 인덱스는 아래에서 따로 때려 본다.
    const numbers = new Set(
      Array.from({ length: NUMBER_SAMPLES }, () =>
        trackingNumberFrom('GA', randomBytes(TRACKING_NUMBER_DIGITS)),
      ),
    )

    expect(numbers.size).toBe(NUMBER_SAMPLES)
  })

  it('is refused by the database when it does not match the format (S5)', async () => {
    const error = await refusal(insertShipment({ trackingNumber: '1234567890' }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Shipment_trackingNumber_format_check')
  })

  it('is refused by the database when its carrier disagrees with the column (S5)', async () => {
    // 번호와 컬럼이 다른 운송사를 가리키면 조회 화면이 한 배송에 대해 두 가지를
    // 말하게 되고, 어느 쪽이 맞는지 아무도 모른다.
    const error = await refusal(
      insertShipment({ carrierCode: 'GA', trackingNumber: 'DEMO-HD-000000000001' }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Shipment_trackingNumber_format_check')
  })

  it('is refused by the database when the same number is issued twice (S5)', async () => {
    const { shipment } = await shipOver(placed.seller)
    const another = await place()

    const error = await refusal(
      db.query(
        `INSERT INTO "Shipment"
           ("id", "sellerOrderId", "carrierCode", "carrierName", "trackingNumber", "shippedAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, '가온물류', $3, now(), now())`,
        [another.sellerOrderId, shipment.carrierCode, shipment.trackingNumber],
      ),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('Shipment_trackingNumber_key')
  })

  it('is refused by the database when one seller order gets a second shipment (S5)', async () => {
    await shipOver(placed.seller)

    const error = await refusal(insertShipment({}))

    expect(error.code).toBe('23505')
    // 1:1 이다. 분할 배송을 여는 것은 이 인덱스를 푸는 마이그레이션이지 코드가 아니다.
    expect(error.constraint).toBe('Shipment_sellerOrderId_key')
  })
})

describe('배송 행이 지켜야 하는 것 (S5)', () => {
  it('refuses a delivered shipment with no delivery time', async () => {
    // 한쪽만 있는 행은 「끝났는데 언제 끝났는지 모르는 배송」이다. 시뮬레이터
    // (TASK-0062)가 상태만 옮기고 시각을 빠뜨리는 것이 정확히 이 모양이다.
    await shipOver(placed.seller)

    const error = await refusal(
      db.query(`UPDATE "Shipment" SET "status" = 'DELIVERED' WHERE "sellerOrderId" = $1`, [
        placed.sellerOrderId,
      ]),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Shipment_delivered_check')
  })

  it('refuses a delivery that happened before the shipment left', async () => {
    await shipOver(placed.seller)

    const error = await refusal(
      db.query(
        `UPDATE "Shipment"
            SET "status" = 'DELIVERED', "deliveredAt" = "shippedAt" - interval '1 hour'
          WHERE "sellerOrderId" = $1`,
        [placed.sellerOrderId],
      ),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Shipment_deliveredAt_check')
  })

  it('allows a delivery recorded with its time', async () => {
    // 제약이 거꾸로 적히면 이쪽이 막힌다. 거절만 재면 그 실수를 못 잡는다.
    const { shipment } = await shipOver(placed.seller)

    await db.query(
      `UPDATE "Shipment"
          SET "status" = 'DELIVERED', "deliveredAt" = "shippedAt" + interval '1 day'
        WHERE "sellerOrderId" = $1`,
      [placed.sellerOrderId],
    )

    const read = await readOver(buyer)

    expect(read.shipment.id).toBe(shipment.id)
    expect(read.shipment.status).toBe('DELIVERED')
    expect(read.shipment.deliveredAt).toBe('2026-09-04T00:00:00.000Z')
  })

  it('refuses a tracking event with nothing written in it', async () => {
    // 「언제·어디서·무슨 일」 셋에 답하지 못하는 줄은 이력이 아니라 빈 칸이다.
    const { shipment } = await shipOver(placed.seller)

    const error = await refusal(
      db.query(
        `INSERT INTO "ShipmentTrackingEvent"
           ("id", "shipmentId", "kind", "location", "description", "occurredAt")
         VALUES (gen_random_uuid(), $1, 'IN_TRANSIT', '  ', '이동했어요.', now())`,
        [shipment.id],
      ),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ShipmentTrackingEvent_text_check')
  })
})

describe('번호의 단일 출처 (TASK-0059 가 예고한 이동)', () => {
  it('refuses a tracking number that no shipment of this order carries (S5)', async () => {
    // **이 검사가 「단일 출처를 옮겼다」의 증거다.** 몫의 컬럼은 배송 행의 사본이고,
    // 사본만 손으로 적는 길이 남아 있으면 「발송했다는데 운송장이 없다」가 여전히
    // 가능하다 — 시드든 백필이든, 앞으로 쓰일 어떤 코드든.
    const error = await refusal(
      db.query(`UPDATE "SellerOrder" SET "trackingNumber" = $2 WHERE "id" = $1`, [
        placed.sellerOrderId,
        'DEMO-GA-000000000001',
      ]),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('SellerOrder_trackingNumber_shipment_fkey')
  })

  it("refuses another order's number even though that number exists", async () => {
    const { shipment } = await shipOver(placed.seller)
    const another = await place()

    const error = await refusal(
      db.query(`UPDATE "SellerOrder" SET "trackingNumber" = $2 WHERE "id" = $1`, [
        another.sellerOrderId,
        shipment.trackingNumber,
      ]),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('SellerOrder_trackingNumber_shipment_fkey')
  })

  it('refuses to delete a shipment the order still points at', async () => {
    await shipOver(placed.seller)

    const error = await refusal(
      db.query(`DELETE FROM "Shipment" WHERE "sellerOrderId" = $1`, [placed.sellerOrderId]),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('SellerOrder_trackingNumber_shipment_fkey')
  })

  it('lets an order with no shipment keep an empty column', async () => {
    // 제약이 거꾸로 적히면 이쪽이 막힌다 — 발송 전의 주문이 저장되지 않는 것이고,
    // 그것은 주문을 아예 만들 수 없다는 뜻이다. 거절만 재면 그 실수를 못 잡는다.
    await db.query(`UPDATE "SellerOrder" SET "trackingNumber" = NULL WHERE "id" = $1`, [
      placed.sellerOrderId,
    ])

    expect(await orderState()).toMatchObject({ trackingNumber: null })
  })
})

describe('조회 (F4 · F5)', () => {
  it('answers the buyer who ordered it', async () => {
    const { shipment } = await shipOver(placed.seller)
    const read = await readOver(buyer)

    expect(read.shipment.id).toBe(shipment.id)
    expect(read.shipment.events).toHaveLength(1)
  })

  it('answers the seller who shipped it', async () => {
    const { shipment } = await shipOver(placed.seller)

    // 둘이 **같은 모양**을 본다. 화면마다 다른 모양을 주면 그 차이를 메우는 두 번째
    // 조회가 반드시 따라온다.
    expect(await readOver(placed.seller)).toEqual({ shipment })
  })

  it('refuses a buyer who did not order it', async () => {
    await shipOver(placed.seller)

    expect(await failure(readOver(stranger))).toMatchObject({ status: 403 })
  })

  it('refuses a seller who did not sell it', async () => {
    await shipOver(placed.seller)

    expect(await failure(readOver(callers.seller))).toMatchObject({ status: 403 })
  })

  it('answers 404 before anything has been shipped', async () => {
    expect(await failure(readOver(buyer))).toMatchObject({ status: 404 })
  })

  it('answers 401 to a caller with no session', async () => {
    await shipOver(placed.seller)

    const refused = await failure(
      api.client.request({
        path: `/seller-orders/${placed.sellerOrderId}/shipment`,
        method: 'GET',
        schema: shipmentResponseSchema,
      }),
    )

    expect(refused.status).toBe(401)
  })
})

describe('추적 이력의 순서', () => {
  it('breaks a tie by id, and answers the same order every time', async () => {
    const { shipment } = await shipOver(placed.seller)
    const pickedUp = shipment.events.at(0)?.id
    // 오름차순으로 정렬해 두고 **거꾸로 넣는다.** 시각만으로 정렬하는 구현은
    // PostgreSQL 이 돌려주는 물리적 순서 — 즉 넣은 순서 — 를 그대로 내보내므로,
    // 그렇게 해야 「타이브레이커가 없다」가 반드시 빨개진다. 무작위 id 셋을 넣고
    // 우연에 기대면 이 검사는 여섯 번 중 한 번 통과한다.
    const tiedIds = [randomUUID(), randomUUID(), randomUUID()].sort()
    // 발송 시각보다 **뒤**의 한 순간. 집화 줄까지 동률에 넣으면 그 줄의 id 는
    // 서비스가 만든 것이라 우리가 순서를 정할 수 없다.
    const tiedAt = '2026-09-03T05:00:00.000Z'

    for (const id of [...tiedIds].reverse()) {
      await db.query(
        `INSERT INTO "ShipmentTrackingEvent"
           ("id", "shipmentId", "kind", "location", "description", "occurredAt")
         VALUES ($1, $2, 'IN_TRANSIT', '가온물류 중부터미널', '이동하고 있어요.', $3)`,
        [id, shipment.id, tiedAt],
      )
    }

    const first = await readOver(buyer)
    const again = await readOver(placed.seller)

    // 시뮬레이터(TASK-0062)가 한 트랜잭션에서 여러 줄을 적으면 실제로 같은
    // 밀리초다. 그때 화면이 새로고침마다 다른 이력을 보여 주면 읽는 사람이 기록을
    // 믿지 못한다 — 이 저장소가 환불 목록에서 한 번 물린 자리다.
    expect(first.shipment.events.map((event) => event.id)).toEqual([pickedUp, ...tiedIds])
    expect(again.shipment.events).toEqual(first.shipment.events)
  })

  it('puts a later event after an earlier one', async () => {
    const { shipment } = await shipOver(placed.seller)

    await db.query(
      `INSERT INTO "ShipmentTrackingEvent"
         ("id", "shipmentId", "kind", "location", "description", "occurredAt")
       VALUES ($1, $2, 'DELIVERED', '받는 곳', '배송 완료됐어요.', $3)`,
      // 시각이 뒤인데 id 는 앞이다. **정렬의 첫 열쇠가 시각이라는 것**이 이 줄로
      // 드러난다 — id 만으로 줄을 세우는 구현은 여기서 뒤집힌다.
      ['00000000-0000-7000-8000-000000000000', shipment.id, '2026-09-04T00:00:00.000Z'],
    )

    const read = await readOver(buyer)

    expect(read.shipment.events.map((event) => event.occurredAt)).toEqual([
      '2026-09-03T00:00:00.000Z',
      '2026-09-04T00:00:00.000Z',
    ])
  })
})

describe('추적 사건이 주문을 움직인다 (F6)', () => {
  /** 발송해 두고, 사건을 적을 배송 하나. */
  async function shipped(): Promise<string> {
    const { shipment } = await shipOver(placed.seller)

    api.clock.advance(60 * 60_000)

    return shipment.id
  }

  it('moves the shipment and the order together when the parcel arrives', async () => {
    const shipmentId = await shipped()

    const { shipment } = await shipments().recordTrackingEvent({
      shipmentId,
      kind: 'DELIVERED',
      location: '받는 곳',
    })

    // 셋이 **함께** 움직인다: 이력 한 줄 · 배송 상태 · 주문 상태.
    expect(shipment.status).toBe('DELIVERED')
    expect(shipment.deliveredAt).toBe('2026-09-03T01:00:00.000Z')
    expect(shipment.events.map((event) => event.kind)).toEqual(['PICKED_UP', 'DELIVERED'])
    expect(await orderState()).toMatchObject({ status: 'DELIVERED', history: 2 })

    const last = await db.one<{ toStatus: string; actor: string; actorId: string | null }>(
      `SELECT "toStatus"::text AS "toStatus", "actor"::text AS "actor", "actorId"
         FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1
        ORDER BY "id" DESC LIMIT 1`,
      [placed.sellerOrderId],
    )

    // **주체는 `SYSTEM` 이다.** 운송사가 알려 준 사실이지 사람이 누른 것이 아니고,
    // 사람이 없는 전이는 사람을 지어내지 않는다.
    expect(last).toEqual({ toStatus: 'DELIVERED', actor: 'SYSTEM', actorId: null })
  })

  it.each(['IN_TRANSIT', 'OUT_FOR_DELIVERY'] as const)(
    'moves only the shipment on a %s event',
    async (kind) => {
      const shipmentId = await shipped()

      const { shipment } = await shipments().recordTrackingEvent({ shipmentId, kind })

      expect(shipment.status).toBe(kind)
      // 주문은 `SHIPPED` 그대로다. 중간 사건까지 주문 상태를 흔들면 정산·클레임이
      // 읽는 상태가 택배 진행에 따라 움직인다.
      expect(await orderState()).toMatchObject({ status: 'SHIPPED', history: 1 })
    },
  )

  it('leaves no event behind when the order refuses the transition', async () => {
    const shipmentId = await shipped()

    // 취소된 주문에 배송완료가 도착한 경우. `CANCELED → DELIVERED` 는 표에 없다.
    await db.query(
      `UPDATE "SellerOrder" SET "status" = 'CANCELED'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )

    await expect(
      shipments().recordTrackingEvent({ shipmentId, kind: 'DELIVERED' }),
    ).rejects.toThrow()

    // 발송에서 지킨 성질과 같은 것이다 — 사건만 남으면 「배송완료라고 적혀 있는데
    // 주문은 취소」가 되고, 그 둘 중 무엇이 참인지 아무도 모른다.
    expect(await eventCount()).toBe(1)
    expect((await shipmentsOf()).at(0)?.status).toBe('READY')
  })

  it('records a late event but does not walk the status back', async () => {
    const shipmentId = await shipped()

    await shipments().recordTrackingEvent({ shipmentId, kind: 'DELIVERED' })
    api.clock.advance(60_000)

    const { shipment } = await shipments().recordTrackingEvent({
      shipmentId,
      kind: 'IN_TRANSIT',
      location: '한들택배 중부터미널',
    })

    // 사건은 일어난 사실이라 남긴다. 요약만 사다리를 지킨다.
    expect(shipment.events.map((event) => event.kind)).toEqual([
      'PICKED_UP',
      'DELIVERED',
      'IN_TRANSIT',
    ])
    expect(shipment.status).toBe('DELIVERED')
    expect(shipment.deliveredAt).toBe('2026-09-03T01:00:00.000Z')
    expect(await orderState()).toMatchObject({ status: 'DELIVERED', history: 2 })
  })

  it('keeps the first delivery time when the same event arrives twice', async () => {
    const shipmentId = await shipped()

    await shipments().recordTrackingEvent({ shipmentId, kind: 'DELIVERED' })
    api.clock.advance(60_000)

    const { shipment } = await shipments().recordTrackingEvent({ shipmentId, kind: 'DELIVERED' })

    // 줄은 둘이 된다 — 「몇 번 왔는가」는 조사에서 가장 먼저 묻는 질문이고, 유니크로
    // 막으면 두 번째 도착이 기록에서 사라진다 (TASK-0056 의 판단).
    expect(shipment.events.filter((event) => event.kind === 'DELIVERED')).toHaveLength(2)
    // 상태는 한 번만 움직인다: 완료 시각은 처음 도착한 것이고 주문 이력도 늘지 않는다.
    expect(shipment.deliveredAt).toBe('2026-09-03T01:00:00.000Z')
    expect(await orderState()).toMatchObject({ status: 'DELIVERED', history: 2 })
  })

  it('is not reachable over HTTP', async () => {
    const shipmentId = await shipped()

    // 라우트를 열면 사람이 「운송사가 알려 준 사실」을 주장하게 되고, 그 순간 이력의
    // `SYSTEM` 이 거짓이 된다. 판매자가 배송완료를 찍는 길은 전이 라우트로 따로 있다.
    const refused = await failure(
      client(placed.seller).request({
        path: `/shipments/${shipmentId}/events`,
        method: 'POST',
        body: { kind: 'DELIVERED' },
        schema: shipmentResponseSchema,
      }),
    )

    expect(refused.status).toBe(404)
  })

  it('lets the seller finish the delivery through the transition route instead', async () => {
    await shipped()

    const moved = await client(placed.seller).request({
      path: `/seller-orders/${placed.sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'DELIVERED' },
      schema: sellerOrderTransitionResponseSchema,
    })

    // 그 길의 이력에는 `SELLER` 가 남는다. 두 사실을 같은 주체로 적지 않는 것이
    // TASK-0059 가 `actor` 를 만든 이유다.
    expect(moved).toMatchObject({ status: 'DELIVERED', changed: true })
    expect(
      await db.one<{ actor: string }>(
        `SELECT "actor"::text AS "actor" FROM "OrderStatusHistory"
          WHERE "sellerOrderId" = $1 ORDER BY "id" DESC LIMIT 1`,
        [placed.sellerOrderId],
      ),
    ).toEqual({ actor: 'SELLER' })
  })
})

describe('응답 시간 (A1)', () => {
  it('answers a tracking read inside the budget', { timeout: SAMPLING_BUDGET_MS }, async () => {
    await shipOver(placed.seller)

    const durations: number[] = []

    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const started = performance.now()

      await readOver(buyer)
      durations.push(performance.now() - started)
    }

    // 한 번에 읽는 질의라 배송·이력·소유권이 각각 왕복하지 않는다(A5). 그것이
    // 무너지면 먼저 나타나는 곳이 이 숫자다.
    expect(p95Of(durations)).toBeLessThanOrEqual(P95_BUDGET_MS)
  })
})

describe('TASK-0059 F4 회귀 — 운송장 없이 발송할 수 없다', () => {
  it('still refuses SHIPPED on an order that has no shipment', async () => {
    const refused = await failure(
      client(placed.seller).request({
        path: `/seller-orders/${placed.sellerOrderId}/transitions`,
        method: 'POST',
        body: { to: 'SHIPPED' },
        schema: sellerOrderTransitionResponseSchema,
      }),
    )

    // 출처를 옮겨도 상태 머신의 판단은 그대로 선다. 채우면 되는 유일한 거절이라
    // 무엇을 채워야 하는지가 입력 이름으로 나간다.
    expect(refused).toMatchObject({ status: 409, code: 'ORDER_TRANSITION_REQUIREMENT' })
    expect(refused.details).toContainEqual(
      expect.objectContaining({ field: 'trackingNumber', code: 'ORDER_TRANSITION_REQUIREMENT' }),
    )
    expect(await orderState()).toMatchObject({ status: 'PREPARING', history: 0 })
  })

  it('lets the same transition through once the waybill has been issued', async () => {
    await shipOver(placed.seller)

    const again = await client(placed.seller).request({
      path: `/seller-orders/${placed.sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'SHIPPED' },
      schema: sellerOrderTransitionResponseSchema,
    })

    // 이미 그 상태라 아무것도 옮기지 않는다. 발송 라우트를 거친 몫은 전이 라우트에서
    // 보아도 같은 사실 위에 있다.
    expect(again).toMatchObject({ status: 'SHIPPED', changed: false })
  })
})
