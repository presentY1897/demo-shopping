import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import { cartResponseSchema, orderResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { RESERVATION_TTL_MS } from '../../src/reservation/reservation-rules.js'
import type { Reservation } from '../../src/reservation/reservation.service.js'
import { ReservationService } from '../../src/reservation/reservation.service.js'
import {
  SWEEP_BATCH_LIMIT,
  SWEEP_LAST_RELEASED_KEY,
  SWEEP_LAST_RUN_KEY,
  SWEEP_LOCK_KEY,
} from '../../src/reservation/reservation-sweeper.js'
import { ReservationSweeperService } from '../../src/reservation/reservation-sweeper.service.js'
import { useApiApp } from '../support/api-app.js'
import { DEFAULT_TEST_INSTANT, fixedClock } from '../support/clock.js'
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

/**
 * 예약 만료 스케줄러 (TASK-0051), 실제 데이터베이스에 대고.
 *
 * **이 스케줄러가 멈추면 재고가 잠긴다.** TASK-0048 이 15분짜리 예약을 만들었지만
 * 그것을 도로 놓아 주는 것은 아무도 하지 않는다 — 잡아 둔 재고가 영영 풀리지 않고,
 * 아무도 그것을 살 수 없으며, **아무것도 실패하지 않는다.** 판매자는 팔리지 않는
 * 이유를 영원히 알 수 없고 화면 어디에도 빨간 글씨가 뜨지 않는다. 그 침묵이 아래의
 * 단언들이 지키는 것이다.
 *
 * 그래서 여기서 가장 값진 검사는 긍정형이 아니라 **부정형**이다. 전부 풀어 버리는
 * 청소도 F1 을 똑같이 통과하고, 확정분까지 풀어 주는 청소는 이미 팔린 재고를
 * 되살린다. 만료되지 않은 예약과 `CONFIRMED` 예약을 그냥 두는지가 그래서 F1·F2 와
 * 나란히 있다.
 *
 * 시각은 전부 **주입된 시계**다(`clock-injection.spec.ts`). 벽시계로 만료를 재면
 * 이 스펙의 「아직 안 지났다」가 실행하는 날짜에 따라 뒤집히고, 그것은 초록과 빨강을
 * 오가는 실패가 아니라 **조용히 틀린 초록**이다.
 */

const db = useDatabase()
const clock = fixedClock(DEFAULT_TEST_INSTANT)
const api = useApiApp({ database: db, authenticate: true, clock })

/** F8 이 쌓아 두는 만료 예약의 수. 배치 상한의 정확히 다섯 배다. */
const BULK_EXPIRED = 5 * SWEEP_BATCH_LIMIT

/** F4 의 두 청소가 나눠 갖는 만료 예약. 한 배치 안에 들어가는 수다. */
const CONTENDED_EXPIRED = 150

let buyer: TestCaller
let buyerId: string
let addressId: string
let categoryId: number

beforeEach(async () => {
  // 시계는 매 테스트 같은 자리에서 시작한다. 앞 테스트가 옮겨 둔 시각을 물려받으면
  // 「아직 안 지났다」가 실행 순서에 따라 달라진다.
  clock.set(DEFAULT_TEST_INSTANT)

  const account = await createUser(db, {})

  buyerId = account.id
  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

function sweeper(): ReservationSweeperService {
  return api.resolve<ReservationSweeperService>(ReservationSweeperService)
}

function reservations(): ReservationService {
  return api.resolve<ReservationService>(ReservationService)
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

/** 팔 수 있는 상품 하나. 주문까지 가려면 `ACTIVE` 에 `minPrice` 가 있어야 한다. */
async function listing(stock: number): Promise<{ variantId: string }> {
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

  return { variantId: variant.id }
}

/** 표에서 바로 읽은 실물 재고와 예약분. */
async function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

/**
 * 한 건 잡는다.
 *
 * `ttlMs` 에 음수를 주면 **기다리지 않고** 이미 만료된 예약이 된다 —
 * `reservation.integration.spec.ts` 가 쓰는 방법과 같다.
 */
function hold(
  variantId: string,
  quantity: number,
  options: { readonly checkoutId?: string; readonly ttlMs?: number } = {},
): Promise<Reservation> {
  return reservations().hold({
    variantId,
    quantity,
    userId: buyerId,
    checkoutId: options.checkoutId ?? randomUUID(),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  })
}

interface ReservationRow {
  readonly status: string
  readonly settled: boolean
}

async function reservationRow(reservationId: string): Promise<ReservationRow> {
  return db.one<ReservationRow>(
    `SELECT "status"::text AS "status", ("settledAt" IS NOT NULL) AS "settled"
       FROM "StockReservation" WHERE "id" = $1`,
    [reservationId],
  )
}

/** 이 상태의 예약이 몇 줄인가. 「누락 0건」은 결국 이 수다. */
async function countByStatus(status: string): Promise<number> {
  const row = await db.one<{ count: number }>(
    `SELECT count(*)::int AS "count" FROM "StockReservation" WHERE "status" = $1::"ReservationStatus"`,
    [status],
  )

  return row.count
}

/** 담고 그 줄의 id 를 돌려준다. */
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

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  return line.id
}

/**
 * `PAYMENT_PENDING` 인 판매자 몫 하나와, 그것이 잡고 있는 예약.
 *
 * 손으로 행을 넣지 않고 실제 주문 경로를 지나는 이유는 스케줄러가 예약에서 주문으로
 * 건너가는 길이 `Order.checkoutId` 하나뿐이기 때문이다 — 그 연결을 테스트가 직접
 * 이어 주면 정작 재는 것이 없어진다.
 */
async function pendingOrder(): Promise<{ sellerOrderId: string; variantId: string }> {
  const { variantId } = await listing(10)
  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [await add(variantId, 2)], addressId },
    schema: orderResponseSchema,
  })

  return { sellerOrderId: order.sellerOrders[0]?.id ?? '', variantId }
}

async function sellerOrderStatus(sellerOrderId: string): Promise<string> {
  const row = await db.one<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "id" = $1`,
    [sellerOrderId],
  )

  return row.status
}

interface HistoryRow {
  readonly fromStatus: string | null
  readonly toStatus: string
  readonly reason: string | null
  readonly actorId: string | null
}

async function historyOf(sellerOrderId: string): Promise<HistoryRow[]> {
  return db.query<HistoryRow>(
    `SELECT "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
            "reason", "actorId"
       FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1 ORDER BY "createdAt"`,
    [sellerOrderId],
  )
}

/**
 * 만료된 예약 `count` 건을 표에 직접 넣는다.
 *
 * **서비스로 만들지 않는 것은 시간 때문이다.** 둘 다 재 봤다: `ReservationService.hold()`
 * 는 한 건이 한 트랜잭션이라 천 건에 **7.8초**가 걸리고, 이 한 문장은 **59ms** 다.
 * 재고 잠김을 지키자고 만든 스펙이 그 차이만큼 스위트에서 가장 느린 파일이 될 이유가
 * 없다. **푸는 쪽은 그대로 서비스가 돈다** — 재는 것은 청소이지 예약을 잡는 길이 아니고,
 * 청소가 읽는 것은 어느 쪽으로 넣었든 같은 행이다.
 *
 * `expiresAt` 을 한 건씩 어긋내는 이유는 F8 이 순서도 함께 재기 때문이다: 가장 오래
 * 잠겨 있던 재고가 먼저 풀려야 한다.
 */
async function bulkExpiredHolds(variantId: string, count: number): Promise<void> {
  const now = clock.now().toISOString()

  await db.query(
    `INSERT INTO "StockReservation"
       ("id", "variantId", "userId", "checkoutId", "quantity", "expiresAt", "createdAt", "updatedAt")
     SELECT gen_random_uuid(), $1, $2, gen_random_uuid(), 1,
            $3::timestamp - (n || ' seconds')::interval, $3::timestamp, $3::timestamp
       FROM generate_series(1, $4) AS n`,
    [variantId, buyerId, now, count],
  )
  // 캐시도 함께 올린다. 행만 넣으면 청소가 되돌릴 것이 없고, 검사는 0을 0과
  // 비교하며 통과한다.
  await db.query(`UPDATE "ProductVariant" SET "reserved" = "reserved" + $2 WHERE "id" = $1`, [
    variantId,
    count,
  ])
}

describe('만료 해제 (F1)', () => {
  it('releases an expired hold and hands the quantity back to the shelf', async () => {
    const { variantId } = await listing(10)
    const held = await hold(variantId, 3, { ttlMs: -1_000 })

    const result = await sweeper().sweep()

    expect(result).toEqual({ released: 1, failedOrders: 0, skipped: false })
    expect(await reservationRow(held.id)).toEqual({ status: 'RELEASED', settled: true })
    // `stock` 은 움직이지 않는다. 예약은 원장을 지나지 않았으므로 되돌릴 차감도 없다.
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('makes the freed quantity buyable again, which is the whole point', async () => {
    const { variantId } = await listing(10)

    await hold(variantId, 10, { ttlMs: -1_000 })
    // 풀리기 전에는 한 개도 못 산다 — 이것이 「재고가 잠긴다」의 실제 모양이다.
    await expect(hold(variantId, 1)).rejects.toThrow()

    await sweeper().sweep()

    await expect(hold(variantId, 10)).resolves.toMatchObject({ quantity: 10 })
  })

  it('leaves a hold whose deadline the injected clock has not reached', async () => {
    const { variantId } = await listing(10)
    const held = await hold(variantId, 3)

    // 대조군이다. 전부 풀어 버리는 청소도 위의 F1 은 그대로 통과한다.
    //
    // 이 예약의 만료는 `DEFAULT_TEST_INSTANT + 15분` 이고, **벽시계는 그 시각을
    // 이미 한참 지났다.** 그러니 `now()` 나 `new Date()` 로 만료를 재는 구현은
    // 여기서 이 예약을 풀어 버린다 — 주입된 시계를 읽는지가 이 한 줄로 갈린다.
    const result = await sweeper().sweep()

    expect(result.released).toBe(0)
    expect(await reservationRow(held.id)).toEqual({ status: 'HELD', settled: false })
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 3 })
  })

  it('releases that same hold the moment the injected clock passes its deadline', async () => {
    const { variantId } = await listing(10)
    const held = await hold(variantId, 3)

    clock.advance(RESERVATION_TTL_MS + 1)

    expect((await sweeper().sweep()).released).toBe(1)
    expect(await reservationRow(held.id)).toEqual({ status: 'RELEASED', settled: true })
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('does not release the same hold twice', async () => {
    const { variantId } = await listing(10)

    await hold(variantId, 3, { ttlMs: -1_000 })

    expect((await sweeper().sweep()).released).toBe(1)
    // 두 번째로 돌려주면 `reserved` 가 음수가 되고, `ProductVariant_reserved_check`
    // 가 그 트랜잭션을 통째로 거절한다 — 그날 만료된 나머지도 함께 안 풀린다.
    expect((await sweeper().sweep()).released).toBe(0)
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
  })
})

describe('확정 보호 (F2)', () => {
  it('leaves a confirmed reservation alone even though its deadline has passed', async () => {
    const { variantId } = await listing(10)
    const held = await hold(variantId, 3, { ttlMs: -1_000 })

    await reservations().confirmHold(held.id)

    const result = await sweeper().sweep()

    expect(result.released).toBe(0)
    expect(await reservationRow(held.id)).toEqual({ status: 'CONFIRMED', settled: true })
    // 확정분은 이미 `reserved` 에서 빠졌고 실제로 팔렸다. 되돌리면 없는 재고를
    // 되살리는 일이고, 그 몫은 다음 사람에게 두 번 팔린다.
    expect(await levelsOf(variantId)).toEqual({ stock: 7, reserved: 0 })
  })

  it('sweeps the expired hold sitting next to a confirmed one', async () => {
    const { variantId } = await listing(10)
    const sold = await hold(variantId, 3, { ttlMs: -1_000 })
    const abandoned = await hold(variantId, 2, { ttlMs: -1_000 })

    await reservations().confirmHold(sold.id)

    expect((await sweeper().sweep()).released).toBe(1)
    expect(await reservationRow(sold.id)).toMatchObject({ status: 'CONFIRMED' })
    expect(await reservationRow(abandoned.id)).toMatchObject({ status: 'RELEASED' })
    // 거르는 기준이 상태이지 조합이 아니라는 것 — 확정된 예약 하나가 같은 variant
    // 의 만료분을 덮어 주면 그 재고는 영영 잠긴다.
    expect(await levelsOf(variantId)).toEqual({ stock: 7, reserved: 0 })
  })
})

describe('주문 전이 (F3)', () => {
  it('fails a payment-pending seller order once its checkout has expired', async () => {
    const { sellerOrderId, variantId } = await pendingOrder()

    clock.advance(RESERVATION_TTL_MS + 1)

    const result = await sweeper().sweep()

    expect(result.failedOrders).toBe(1)
    expect(result.released).toBe(1)
    expect(await sellerOrderStatus(sellerOrderId)).toBe('PAYMENT_FAILED')
    // 재고도 함께 풀린다. 주문만 실패로 적고 예약을 남기면 결제도 못 받고 재고도
    // 못 파는 최악의 조합이 된다.
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('records who moved it, which is nobody', async () => {
    const { sellerOrderId } = await pendingOrder()

    clock.advance(RESERVATION_TTL_MS + 1)
    await sweeper().sweep()

    const history = await historyOf(sellerOrderId)
    const last = history.at(-1)

    expect(last).toMatchObject({ fromStatus: 'PAYMENT_PENDING', toStatus: 'PAYMENT_FAILED' })
    // 옮긴 것이 사람이 아니라 스케줄러다. 없는 사람을 지어내는 것보다 비어 있는
    // 편이 사실이고, 나중에 「누가 취소했나」를 묻는 사람에게 답이 된다.
    expect(last?.actorId).toBeNull()
    expect(last?.reason).toBeTruthy()
  })

  it('leaves the order alone while its holds are still live', async () => {
    const { sellerOrderId } = await pendingOrder()

    const result = await sweeper().sweep()

    expect(result).toEqual({ released: 0, failedOrders: 0, skipped: false })
    expect(await sellerOrderStatus(sellerOrderId)).toBe('PAYMENT_PENDING')
  })

  it('fails no order for an expired hold that belongs to none', async () => {
    const { variantId } = await listing(10)

    await hold(variantId, 3, { ttlMs: -1_000 })

    // 주문서만 열고 이탈한 사람의 예약이다. 풀 것은 있고 실패시킬 주문은 없다 —
    // 두 수가 같은 수가 아니라는 것이 여기서 갈린다.
    expect(await sweeper().sweep()).toEqual({ released: 1, failedOrders: 0, skipped: false })
  })

  it('leaves a seller order that is no longer waiting for payment', async () => {
    const { sellerOrderId } = await pendingOrder()

    // 결제가 승인돼 이미 옮겨 간 몫이다. 전이를 `PAYMENT_PENDING` 조건 없이 쓰면
    // 결제된 주문이 결제 실패로 뒤집히고, 그 다음에 일어나는 일은 환불이 아니라
    // 배송이 멈추는 것이다.
    await db.query(`UPDATE "SellerOrder" SET "status" = 'PAID' WHERE "id" = $1`, [sellerOrderId])
    clock.advance(RESERVATION_TTL_MS + 1)

    const result = await sweeper().sweep()

    expect(result.failedOrders).toBe(0)
    expect(await sellerOrderStatus(sellerOrderId)).toBe('PAID')
    // 이력에는 주문이 생겼을 때의 한 줄만 있다. 상태를 안 옮겼다면 이력도 없어야
    // 한다 — 「기록만 남기고 상태는 그대로」는 나중에 읽는 사람을 속인다.
    expect(await historyOf(sellerOrderId)).toEqual([
      { fromStatus: null, toStatus: 'PAYMENT_PENDING', reason: null, actorId: null },
    ])
  })
})

describe('중복 방지 (F4)', () => {
  it('skips its turn while another instance holds the lock', async () => {
    const { variantId } = await listing(10)
    const held = await hold(variantId, 3, { ttlMs: -1_000 })

    // **겹침을 주선한다.** 「하나만 건너뛰었다」를 두 청소를 동시에 던져서 재면,
    // 둘이 실제로는 앞뒤로 돌았을 때에도 초록이 된다 (`support/concurrently.ts`).
    // 다른 인스턴스인 척 같은 열쇠를 트랜잭션 락으로 붙잡고 있는 **동안에만**
    // 청소를 부르면, 겹침은 희망이 아니라 배치가 된다.
    const skipped = await db.withConnection(async (connection) => {
      await connection.query('BEGIN')
      await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [SWEEP_LOCK_KEY])

      const result = await sweeper().sweep()

      await connection.query('ROLLBACK')
      return result
    })

    expect(skipped).toEqual({ released: 0, failedOrders: 0, skipped: true })
    expect(await reservationRow(held.id)).toEqual({ status: 'HELD', settled: false })
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 3 })
    // 건너뛴 것을 「돌았다」로 적으면 헬스체크가 멈춘 스케줄러를 건강하다고 답한다.
    expect(await sweeper().lastRunAt()).toBeNull()

    // 락이 풀리면 다음 주기가 가져간다. 건너뛴 것은 잊히는 것이 아니다.
    expect((await sweeper().sweep()).released).toBe(1)
  })

  it('never processes a hold twice when two sweeps run at the same instant', async () => {
    const { variantId } = await listing(CONTENDED_EXPIRED)

    await bulkExpiredHolds(variantId, CONTENDED_EXPIRED)

    const results = await concurrently(2, () => sweeper().sweep())

    // 「하나만 성공했다」가 아니다. F4 가 요구하는 것은 **처리 중복 0건**이고,
    // 그것은 둘이 푼 것의 합이 만료 건수와 정확히 같다는 뜻이다 — 한쪽이 앞뒤로
    // 돌아 0건을 풀었더라도 참이어야 하는 등식이다.
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(fulfilled(results).reduce((sum, result) => sum + result.released, 0)).toBe(
      CONTENDED_EXPIRED,
    )
    expect(await levelsOf(variantId)).toEqual({ stock: CONTENDED_EXPIRED, reserved: 0 })
    expect(await countByStatus('HELD')).toBe(0)
    expect(await countByStatus('RELEASED')).toBe(CONTENDED_EXPIRED)
  })
})

describe('정합성 점검 (F7 · R2)', () => {
  it('finds nothing after a sweep has done its work', async () => {
    const { variantId } = await listing(20)
    const sold = await hold(variantId, 3, { ttlMs: -1_000 })

    await hold(variantId, 2, { ttlMs: -1_000 })
    await hold(variantId, 4)
    await reservations().confirmHold(sold.id)
    await sweeper().sweep()

    // 재는 등식은 `reserved` = 살아 있는 `HELD` 의 합이다. 남은 `HELD` 가 없으면
    // 0 = 0 으로만 참이 되어 아무것도 재지 않으므로, 아직 유효한 예약을 하나 남긴다.
    expect(await levelsOf(variantId)).toEqual({ stock: 17, reserved: 4 })
    expect(await sweeper().reconcile()).toEqual([])
  })

  it('catches a cache deliberately knocked out of true', async () => {
    const { variantId } = await listing(20)

    await hold(variantId, 4)
    await sweeper().sweep()
    await db.query(`UPDATE "ProductVariant" SET "reserved" = "reserved" + 1 WHERE "id" = $1`, [
      variantId,
    ])

    // 대조군이 없으면 위의 빈 배열은 「점검이 아무것도 안 한다」와 구별되지 않는다.
    expect(await sweeper().reconcile()).toEqual([{ variantId, reserved: 5, heldQuantity: 4 }])
  })

  it('reports the fault without correcting it', async () => {
    const { variantId } = await listing(20)

    await hold(variantId, 4)
    await db.query(`UPDATE "ProductVariant" SET "reserved" = "reserved" + 1 WHERE "id" = $1`, [
      variantId,
    ])
    await sweeper().reconcile()

    // R2. 원인을 모르는 채 값을 고치면 문제가 숨는다 — 어긋남이 사라지고 그것을
    // 만든 결함만 남는다. 검출과 기록까지가 이 잡의 일이다.
    expect(await levelsOf(variantId)).toEqual({ stock: 20, reserved: 5 })
  })
})

describe('대량 처리 (F8)', () => {
  it(
    'clears a thousand expired holds in capped batches, losing none',
    { timeout: 60_000 },
    async () => {
      const { variantId } = await listing(BULK_EXPIRED)

      await bulkExpiredHolds(variantId, BULK_EXPIRED)

      const first = await sweeper().sweep()

      // 상한이 있는 이유는 청소가 장애를 만들지 않기 위해서다. 천 건을 한
      // 트랜잭션으로 풀면 그동안 그 variant 의 행이 잠겨 담기와 주문이 함께 멈춘다.
      expect(first.released).toBe(SWEEP_BATCH_LIMIT)

      // 가장 오래 잠겨 있던 재고가 먼저 풀린다. 순서가 없으면 운 나쁜 예약 하나가
      // 계속 뒤로 밀려 몇 주기가 지나도 안 풀릴 수 있다.
      const boundary = await db.one<{ newestReleased: Date; oldestHeld: Date }>(
        `SELECT max("expiresAt") FILTER (WHERE "status" = 'RELEASED') AS "newestReleased",
                min("expiresAt") FILTER (WHERE "status" = 'HELD')     AS "oldestHeld"
           FROM "StockReservation"`,
      )

      expect(boundary.newestReleased.getTime()).toBeLessThan(boundary.oldestHeld.getTime())

      const batches = [first.released]

      // 다음 주기들이 나머지를 가져간다. 여덟 번은 넉넉한 상한이다 — 다섯 번 안에
      // 끝나지 않으면 그것 자체가 결함이고, 무한 루프로 감출 일이 아니다.
      for (let round = 0; round < 8; round += 1) {
        const { released } = await sweeper().sweep()

        if (released === 0) break
        batches.push(released)
      }

      expect(batches).toEqual(Array.from({ length: 5 }, () => SWEEP_BATCH_LIMIT))
      // 누락 0건. 남은 `HELD` 가 하나라도 있으면 그 재고는 아무도 못 산다.
      expect(await countByStatus('HELD')).toBe(0)
      expect(await countByStatus('RELEASED')).toBe(BULK_EXPIRED)
      expect(await levelsOf(variantId)).toEqual({ stock: BULK_EXPIRED, reserved: 0 })
    },
  )
})

describe('돌았다는 기록 (R1)', () => {
  it('answers null and zero before it has ever run', async () => {
    // 「아직 안 돌았다」와 「멈췄다」를 밖에서 구분할 방법은 없다. 여기서 0시각을
    // 지어내면 헬스체크는 부팅 직후를 영원히 건강하다고 답한다.
    expect(await sweeper().lastRunAt()).toBeNull()
    expect(await sweeper().lastReleased()).toBe(0)
  })

  it('records when it ran and how many it released', async () => {
    const { variantId } = await listing(10)

    await hold(variantId, 3, { ttlMs: -1_000 })
    await hold(variantId, 2, { ttlMs: -1_000 })
    await sweeper().sweep()

    expect((await sweeper().lastRunAt())?.toISOString()).toBe(clock.now().toISOString())
    expect(await sweeper().lastReleased()).toBe(2)

    // `AppMeta` 의 행인 것이 중요하다. 서비스의 필드였다면 재시작으로 사라지고
    // 인스턴스마다 다른 답을 내놓는다.
    const keys = await db.query<{ key: string }>(
      `SELECT "key" FROM "AppMeta" WHERE "key" = ANY($1::text[]) ORDER BY "key"`,
      [[SWEEP_LAST_RUN_KEY, SWEEP_LAST_RELEASED_KEY]],
    )

    expect(keys).toHaveLength(2)
  })

  it('records a run that found nothing to do', async () => {
    await sweeper().sweep()

    // 「할 일이 없었다」와 「멈췄다」는 다른 일이고, 헬스체크가 보는 것은 그 차이다.
    // 빈 주기에 기록을 건너뛰면 한가한 새벽이 장애처럼 보인다.
    expect((await sweeper().lastRunAt())?.toISOString()).toBe(clock.now().toISOString())
    expect(await sweeper().lastReleased()).toBe(0)
  })
})
