import type { ApiClient, Shipment, TrackingEvent } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  orderResponseSchema,
  shipmentResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DELIVERY_LOCK_KEY,
  DELIVERY_STALE_AFTER_MS,
  DELIVERY_STEP_MS,
} from '../../src/shipping/delivery-simulator.js'
import { DeliverySimulatorService } from '../../src/shipping/delivery-simulator.service.js'
import { ShipmentService } from '../../src/shipping/shipment.service.js'
import { useApiApp } from '../support/api-app.js'
import { DEFAULT_TEST_INSTANT, fixedClock } from '../support/clock.js'
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
 * 배송 상태 자동 진행 (TASK-0062), 이 워커의 실제 데이터베이스에 대고.
 *
 * **이 파일이 지키는 것은 「발송된 주문이 혼자 힘으로 배송완료까지 간다」이다.**
 * 그 문장이 깨지는 방식은 전부 조용하다 — 배치가 멈추면 주문은 영영 `SHIPPED` 이고
 * 화면은 「배송중」이라고 정직하게 말하며, 그 뒤의 구매확정 · 정산 · 반품은 열리지
 * 않는데 **아무 요청도 실패하지 않는다.** 그래서 단언이 상태 하나로 끝나지 않고
 * 매번 **사슬 전체** — 배송 상태 · 추적 이력 · 주문 상태 · 주문 이력의 주체 — 를
 * 함께 본다.
 *
 * 시각은 전부 **주입된 시계**다. 이 잡의 단위가 분이라 벽시계로는 아예 잴 수 없고,
 * 잰다 해도 그것은 빨강과 초록을 오가는 실패가 아니라 **조용히 틀린 초록**이 된다.
 *
 * 사건 한 줄이 무엇을 일으키는지 — 이력 · 배송 상태 · 주문 전이가 한 트랜잭션 —
 * 는 `test/api/shipment.spec.ts` 가 이미 재고 있다 (TASK-0061 F6). 여기서 재는 것은
 * **그 문이 시간에 맞춰 두드려지는가**다.
 */

const db = useDatabase()
const clock = fixedClock(DEFAULT_TEST_INSTANT)
const api = useApiApp({ database: db, authenticate: true, clock })

/**
 * 느린 모드로 뜬 두 번째 앱.
 *
 * 같은 데이터베이스를 본다 — 발송은 위의 앱이 만들고, 진행만 이쪽이 돌린다. 축이
 * **실제로 갈리는지**는 이렇게 두 프로세스를 나란히 두어야 잴 수 있다: 값을 읽는
 * 코드만 확인하면 「환경변수 → `AppConfig` → 배치」 사이의 배선이 끊겼는지는 아무도
 * 모른다.
 */
const slowClock = fixedClock(DEFAULT_TEST_INSTANT)
const slowApi = useApiApp({
  database: db,
  clock: slowClock,
  config: { fulfillmentPace: 'realistic' },
})

/** 데모 모드의 한 단계. 이 파일의 시간은 전부 이 단위로 움직인다. */
const STEP_MS = DELIVERY_STEP_MS.demo

const NOTHING = { advanced: 0, delivered: 0, failed: 0, skipped: false } as const

let buyer: TestCaller
let stranger: TestCaller
let addressId: string
let categoryId: number

interface Shipped {
  readonly sellerOrderId: string
  readonly shipmentId: string
  readonly seller: TestCaller
}

interface HistoryRow {
  readonly toStatus: string
  readonly actor: string
  readonly actorId: string | null
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function simulator(): DeliverySimulatorService {
  return api.resolve<DeliverySimulatorService>(DeliverySimulatorService)
}

/** 팔 수 있는 조합 하나와 그 가게의 주인. 가게마다 새로 만들어 서로 간섭하지 않는다. */
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

/**
 * 발송까지 끝난 주문 하나.
 *
 * 결제와 판매자 확인을 SQL 로 건너뛰는 이유는 `shipment.spec.ts` 와 같다 — 여기서
 * 재는 것은 **발송 뒤**이고, 앞의 두 TASK 를 실제로 지나가면 그것들이 깨질 때 이
 * 파일이 함께 빨개진다. 발송만은 라우트를 지난다: 첫 사건(집화)과 운송장이 거기서
 * 나오고, 시뮬레이터의 시작점이 정확히 그 사건이기 때문이다.
 */
async function ship(): Promise<Shipped> {
  const store = await listing()
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId: store.variantId, quantity: 1 },
    schema: cartResponseSchema,
  })
  // **방금 담은 줄을 찾아 쓴다.** 한 테스트가 두 가게에서 사면 장바구니에 줄이
  // 여럿이고, 맨 앞을 집으면 남의 가게 주문을 자기 가게로 발송하려 들게 된다.
  const line = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === store.variantId)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [line.id], addressId },
    schema: orderResponseSchema,
  })
  const sellerOrderId = order.sellerOrders.at(0)?.id

  if (sellerOrderId === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  await db.query(
    `WITH cleared AS (DELETE FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1)
     UPDATE "SellerOrder" SET "status" = 'PREPARING'::"SellerOrderStatus" WHERE "id" = $1`,
    [sellerOrderId],
  )

  const { shipment } = await client(store.seller).request({
    path: `/seller-orders/${sellerOrderId}/shipment`,
    method: 'POST',
    body: {},
    schema: shipmentResponseSchema,
  })

  return { sellerOrderId, shipmentId: shipment.id, seller: store.seller }
}

/**
 * 배송과 그 이력을, **판매자가 보는 그대로.**
 *
 * 행을 직접 읽지 않는 이유는 두 가지다. 시각이 `timestamp` 라 `pg` 가 그것을
 * 로컬 시간으로 해석해 돌려주므로 주입된 시계와 비교하려면 매번 되돌려야 하고 —
 * 그 되돌리기가 틀리면 **검사만 조용히 틀린다** — 무엇보다 여기서 재려는 것은
 * 배치가 옮긴 결과를 **화면이 실제로 그렇게 받는가**이기 때문이다. 응답은
 * `createApiClient` 가 공용 zod 스키마로 파싱하므로 그 왕복 자체가 C3 다.
 */
async function track(shipped: Shipped): Promise<Shipment> {
  const { shipment } = await client(shipped.seller).request({
    path: `/seller-orders/${shipped.sellerOrderId}/shipment`,
    method: 'GET',
    schema: shipmentResponseSchema,
  })

  return shipment
}

function eventsOf(shipped: Shipped): Promise<readonly TrackingEvent[]> {
  return track(shipped).then((shipment) => shipment.events)
}

function kindsOf(shipped: Shipped): Promise<string[]> {
  return eventsOf(shipped).then((events) => events.map((event) => event.kind))
}

/** `DEFAULT_TEST_INSTANT` 에서 `ms` 만큼 뒤의 시각, 응답에 실리는 모양으로. */
function at(ms: number): string {
  return new Date(new Date(DEFAULT_TEST_INSTANT).getTime() + ms).toISOString()
}

function orderStatusOf(sellerOrderId: string): Promise<string> {
  return db
    .one<{ status: string }>(
      `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "id" = $1`,
      [sellerOrderId],
    )
    .then((row) => row.status)
}

function historyOf(sellerOrderId: string): Promise<HistoryRow[]> {
  return db.query<HistoryRow>(
    `SELECT "toStatus"::text AS "toStatus", "actor"::text AS "actor", "actorId"
       FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1 ORDER BY "id" ASC`,
    [sellerOrderId],
  )
}

function advanceOver(caller: TestCaller, sellerOrderId: string) {
  return client(caller).request({
    path: `/seller-orders/${sellerOrderId}/shipment/advance`,
    method: 'POST',
    body: {},
    schema: shipmentResponseSchema,
  })
}

interface HttpFailure {
  readonly status: number
  readonly code: string
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return { status: error.status ?? 0, code: error.body?.error.code ?? '' }
}

beforeEach(async () => {
  // 시계는 매 테스트 같은 자리에서 시작한다. 앞 테스트가 옮겨 둔 시각을 물려받으면
  // 「아직 때가 안 됐다」가 실행 순서에 따라 달라진다.
  clock.set(DEFAULT_TEST_INSTANT)
  slowClock.set(DEFAULT_TEST_INSTANT)
  vi.restoreAllMocks()

  const account = await createUser(db, {})
  const other = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  stranger = { userId: other.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

describe('시간이 지나면 한 단계씩 오른다 (F1)', () => {
  it('walks the shipment up one rung per step', async () => {
    const shipped = await ship()

    // 발송 직후는 집화 한 줄이고 상태는 `READY` 다 — 시뮬레이터가 만드는 첫
    // 사건은 그 **다음**이다 (TASK-0061 이 집화를 이미 적었다).
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP'])

    for (const [kind, status] of [
      ['IN_TRANSIT', 'IN_TRANSIT'],
      ['OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY'],
      ['DELIVERED', 'DELIVERED'],
    ] as const) {
      clock.advance(STEP_MS)

      await simulator().advanceDue()

      const shipment = await track(shipped)

      expect(shipment.events.at(-1)?.kind).toBe(kind)
      expect(shipment.status).toBe(status)
    }
  })

  it('counts the middle steps apart from the arrival', async () => {
    const shipped = await ship()

    clock.advance(STEP_MS)
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })

    clock.advance(STEP_MS)
    await simulator().advanceDue()
    clock.advance(STEP_MS)

    // 마지막 한 걸음만 다른 칸에 쌓인다 — 그 한 건이 구매확정 · 정산 · 반품을
    // 여는 사건이라, 합쳐 세면 「오늘 배송이 몇 건 끝났나」에 답할 수 없다.
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, delivered: 1 })
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('DELIVERED')
  })

  it('stamps each event at the moment it came due, not at the moment it ran', async () => {
    const shipped = await ship()

    // 주기가 단계보다 짧아 배치는 늘 조금 늦게 돈다. 그 늦음을 시각에 적으면
    // **다음 단계의 기준이 밀린 시각**이 되어 오차가 단계마다 쌓이고, 세 단계면
    // 데모의 6분이 9분이 된다 — F2 가 재는 바로 그 숫자다.
    clock.advance(STEP_MS + 30_000)
    await simulator().advanceDue()

    const events = await eventsOf(shipped)

    expect(events.at(1)?.occurredAt).toBe(at(STEP_MS))
  })

  it('moves one rung per cycle even when several are overdue', async () => {
    const shipped = await ship()

    // 세 단계가 한꺼번에 밀린 상태. 한 주기에 몰아 올리면 이력에 같은 밀리초의
    // 줄이 셋 쌓이고, 추적 화면은 「무슨 일이 있었나」 대신 「배치가 언제
    // 재시작했나」를 보여 준다.
    clock.advance(3 * STEP_MS)

    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP', 'IN_TRANSIT'])

    // 시계를 더 밀지 않아도 다음 주기가 곧바로 가져간다 — 사건 시각이 **때가 된
    // 시각**이라 밀린 만큼은 이미 지난 것으로 남아 있다.
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, delivered: 1 })
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('DELIVERED')
  })
})

describe('마지막 단계가 사슬 전체를 움직인다 (F3 · F5)', () => {
  it('lands the order in DELIVERED with the shipment and the history agreeing', async () => {
    const shipped = await ship()

    clock.advance(3 * STEP_MS)
    for (const _ of [0, 1, 2]) await simulator().advanceDue()

    const shipment = await track(shipped)
    const events = shipment.events
    const history = await historyOf(shipped.sellerOrderId)

    // ① 배송 표
    expect(shipment.status).toBe('DELIVERED')
    // 완료 시각은 마지막 사건의 시각이다. 「언제 받았나」의 답이 배치가 언제
    // 돌았는지에 따라 달라지면 그 칸은 아무 말도 못 한다.
    expect(shipment.deliveredAt).toBe(events.at(-1)?.occurredAt)

    // ② 추적 이력 — 네 줄이 제 간격으로.
    expect(events.map((event) => event.kind)).toEqual([
      'PICKED_UP',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ])
    expect(events.map((event) => event.occurredAt)).toEqual([
      at(0),
      at(STEP_MS),
      at(2 * STEP_MS),
      at(3 * STEP_MS),
    ])

    // ③ 주문과 그 이력. **주체가 `SYSTEM` 이고 사람이 없다** — 운송사가 알려 준
    // 사실이지 누가 누른 것이 아니고, 사람이 없는 전이는 사람을 지어내지 않는다.
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('DELIVERED')
    expect(history).toEqual([
      { toStatus: 'SHIPPED', actor: 'SELLER', actorId: shipped.seller.userId },
      { toStatus: 'DELIVERED', actor: 'SYSTEM', actorId: null },
    ])
  })

  it('leaves the order alone on the middle steps', async () => {
    const shipped = await ship()

    clock.advance(STEP_MS)
    await simulator().advanceDue()
    clock.advance(STEP_MS)
    await simulator().advanceDue()

    // 중간 사건까지 주문 상태를 흔들면 정산 · 클레임이 읽는 상태가 택배 진행에
    // 따라 움직인다.
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('SHIPPED')
    expect(await historyOf(shipped.sellerOrderId)).toHaveLength(1)
  })

  it('reaches delivery inside the demo budget (F2)', async () => {
    const shipped = await ship()

    // 발송에서 6분. 방문자가 한 자리에 앉아 배송완료를 보고 그 뒤의 흐름으로
    // 넘어갈 수 있다는 것이 이 TASK 의 존재 이유다.
    for (const _ of [0, 1, 2]) {
      clock.advance(STEP_MS)
      await simulator().advanceDue()
    }

    expect(clock.now().getTime() - new Date(DEFAULT_TEST_INSTANT).getTime()).toBeLessThanOrEqual(
      10 * 60_000,
    )
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('DELIVERED')
  })
})

describe('때가 안 된 배송은 건드리지 않는다', () => {
  it('leaves the timeline and the tables exactly as they were', async () => {
    const shipped = await ship()

    clock.advance(STEP_MS - 1)

    const before = await eventsOf(shipped)

    expect(await simulator().advanceDue()).toEqual(NOTHING)

    // 대역도 표도 그대로다. 「한 밀리초 일찍 움직인다」는 빨간 검사가 아니라
    // 화면에서 어긋난 시각으로만 보인다.
    expect(await eventsOf(shipped)).toEqual(before)
    expect((await track(shipped)).status).toBe('READY')
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('SHIPPED')
  })

  it('moves it the very millisecond the step is up', async () => {
    // 경계다. 「초과」로 잡으면 정확히 그 순간에 도는 주기가 한 번을 그냥 흘린다.
    const shipped = await ship()

    clock.advance(STEP_MS)

    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })
    expect((await track(shipped)).status).toBe('IN_TRANSIT')
  })

  it('does not touch a delivered shipment again', async () => {
    const shipped = await ship()

    clock.advance(3 * STEP_MS)
    for (const _ of [0, 1, 2]) await simulator().advanceDue()

    const arrived = await eventsOf(shipped)

    // 배송완료 뒤로 한참을 흘려 본다. 사다리의 끝을 모르는 구현은 여기서 매
    // 주기 새 줄을 쌓고, 그 화면은 도착한 뒤에도 계속 움직인다.
    clock.advance(10 * STEP_MS)

    expect(await simulator().advanceDue()).toEqual(NOTHING)
    expect(await eventsOf(shipped)).toEqual(arrived)
    expect(await historyOf(shipped.sellerOrderId)).toHaveLength(2)
  })

  it('leaves a shipment whose order already reached DELIVERED another way', async () => {
    const shipped = await ship()

    // 판매자가 전이 라우트로 주문만 옮긴 경우 — 배송 표는 `READY` 에 남는다
    // (`state-machines.md` 1장이 판매자에게 열어 둔 길이다). 그것을 계속 밀면
    // 이력에 「배송완료 뒤의 이동 중」이 남는다.
    await db.query(
      `UPDATE "SellerOrder" SET "status" = 'DELIVERED'::"SellerOrderStatus" WHERE "id" = $1`,
      [shipped.sellerOrderId],
    )
    clock.advance(3 * STEP_MS)

    expect(await simulator().advanceDue()).toEqual(NOTHING)
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP'])
  })
})

describe('느린 모드 (시간 압축의 축)', () => {
  it('waits hours instead of minutes when the pace says so', async () => {
    const shipped = await ship()

    // 데모 한 단계가 지나도 느린 모드는 움직이지 않는다. 이 한 줄이 「환경변수 →
    // AppConfig → 배치」 배선이 살아 있다는 증거다 — 값만 읽고 쓰지 않는 구현은
    // 여기서 빨개진다.
    slowClock.advance(STEP_MS)
    expect(
      await slowApi.resolve<DeliverySimulatorService>(DeliverySimulatorService).advanceDue(),
    ).toEqual(NOTHING)
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP'])

    slowClock.advance(DELIVERY_STEP_MS.realistic)
    expect(
      await slowApi.resolve<DeliverySimulatorService>(DeliverySimulatorService).advanceDue(),
    ).toEqual({ ...NOTHING, advanced: 1 })
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP', 'IN_TRANSIT'])
  })
})

describe('수동 진행 (F4)', () => {
  it('moves exactly one rung and leaves an honest source behind', async () => {
    const shipped = await ship()

    const { shipment } = await advanceOver(shipped.seller, shipped.sellerOrderId)

    // 한 단계만이다. 「즉시 배송완료」로 만들면 시연이 건너뛰는 것은 두 단계가
    // 아니라 **그 두 단계를 보여 주는 화면**이다.
    expect(shipment.status).toBe('IN_TRANSIT')

    const events = await eventsOf(shipped)
    const written = events.at(-1)

    // **이력이 거짓이 되지 않는다.** 배치가 적는 줄은 「운송사가 알려 왔다」인데,
    // 사람이 누른 것을 그 문장으로 적으면 그 순간 `SYSTEM` 과 `CARRIER` 가 둘 다
    // 거짓이 된다. 여기 남는 것은 판매자가 직접 확인한 사실이다.
    expect(written?.kind).toBe('IN_TRANSIT')
    expect(written?.description).toBe('판매자가 배송 중임을 확인했어요.')
    expect(written?.location).toBe('판매자 직접 확인')
    expect(written?.occurredAt).toBe(clock.now().toISOString())

    // 중간 단계라 주문은 그대로다.
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('SHIPPED')
  })

  it('records the person, not the system, when the last rung moves the order', async () => {
    const shipped = await ship()

    await advanceOver(shipped.seller, shipped.sellerOrderId)
    await advanceOver(shipped.seller, shipped.sellerOrderId)

    const { shipment } = await advanceOver(shipped.seller, shipped.sellerOrderId)

    expect(shipment.status).toBe('DELIVERED')
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('DELIVERED')

    // 사람이 누른 전이에 `SYSTEM` 이 남으면, 나중에 그 주문을 읽는 사람은
    // 「시뮬레이터가 배송을 끝냈다」고 읽는다 — 없는 사실이다.
    expect((await historyOf(shipped.sellerOrderId)).at(-1)).toEqual({
      toStatus: 'DELIVERED',
      actor: 'SELLER',
      actorId: shipped.seller.userId,
    })
  })

  it('records an admin as an admin, and still stops where the state machine does', async () => {
    const shipped = await ship()

    // 중간 두 단계는 관리자도 민다 — 배송 표만 움직이는 사건이라 주문의 전이표에
    // 물어볼 것이 없다.
    await advanceOver(callers.superAdmin, shipped.sellerOrderId)

    expect((await eventsOf(shipped)).at(-1)?.description).toBe('판매자가 배송 중임을 확인했어요.')

    await advanceOver(callers.superAdmin, shipped.sellerOrderId)

    // 마지막 한 걸음은 다르다. `SHIPPED → DELIVERED` 의 주체는 `SYSTEM` 과
    // 판매자뿐이고(`state-machines.md` 1장), **시연용 라우트가 그 표를 비켜 가지
    // 않는다.** 비켜 가면 이 편의 장치 하나가 「누가 배송을 끝낼 수 있는가」를
    // 조용히 넓히게 된다.
    const refused = await failure(advanceOver(callers.superAdmin, shipped.sellerOrderId))

    expect(refused).toMatchObject({ status: 403, code: 'ORDER_TRANSITION_FORBIDDEN' })

    // 거절이 한 트랜잭션을 통째로 되돌린다 — 사건만 남으면 「배송완료라고 적혀
    // 있는데 주문은 배송중」이 된다.
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'])
    expect(await orderStatusOf(shipped.sellerOrderId)).toBe('SHIPPED')

    // 그리고 그 마지막 걸음은 판매자가 마저 딛는다. 주체는 **서버가 정한다** —
    // 요청이 주장하게 두면 관리자가 판매자인 척할 수 있고, 그 이력은 분쟁에서
    // 유일한 근거다.
    await advanceOver(shipped.seller, shipped.sellerOrderId)

    expect((await historyOf(shipped.sellerOrderId)).at(-1)).toEqual({
      toStatus: 'DELIVERED',
      actor: 'SELLER',
      actorId: shipped.seller.userId,
    })
  })

  it('is idempotent once the parcel has arrived', async () => {
    const shipped = await ship()

    for (const _ of [0, 1, 2]) await advanceOver(shipped.seller, shipped.sellerOrderId)

    const arrived = await eventsOf(shipped)
    const { shipment } = await advanceOver(shipped.seller, shipped.sellerOrderId)

    // 버튼을 한 번 더 누른 것이지 「운송사가 두 번 알려 온 것」이 아니다. 줄을
    // 하나 더 남기면 타임라인에 같은 문장이 둘 생긴다 (`markDelivered` 와 같은 판단).
    expect(shipment.status).toBe('DELIVERED')
    expect(await eventsOf(shipped)).toEqual(arrived)
    expect(await historyOf(shipped.sellerOrderId)).toHaveLength(2)
  })

  it('picks up where the schedule left off, and resets the clock for the next step', async () => {
    const shipped = await ship()

    clock.advance(STEP_MS)
    await simulator().advanceDue()
    clock.advance(STEP_MS / 2)

    await advanceOver(shipped.seller, shipped.sellerOrderId)

    // 수동으로 누른 뒤에는 **그 순간부터** 다음 단계까지 온전히 한 단계가 남는다.
    // 기준이 발송 시각이었다면 누르자마자 자동 단계가 따라붙어, 시연자가 화면을
    // 설명하는 사이에 배송이 혼자 도착해 버린다.
    expect(await simulator().advanceDue()).toEqual(NOTHING)

    clock.advance(STEP_MS)
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, delivered: 1 })
  })

  it('refuses another store (A3)', async () => {
    const shipped = await ship()

    expect(await failure(advanceOver(callers.seller, shipped.sellerOrderId))).toMatchObject({
      status: 403,
    })
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP'])
  })

  it('refuses the buyer who ordered it (A3)', async () => {
    const shipped = await ship()

    // 사는 쪽에는 배송을 진행시킬 자리가 없다 — 그 사람이 「도착했다」를 주장할 수
    // 있으면 구매확정과 반품 기한이 그 주장 위에 선다.
    expect(await failure(advanceOver(buyer, shipped.sellerOrderId))).toMatchObject({ status: 403 })
    expect(await failure(advanceOver(stranger, shipped.sellerOrderId))).toMatchObject({
      status: 403,
    })
  })

  it('refuses an operator who cannot write orders (A3)', async () => {
    const shipped = await ship()

    expect(await failure(advanceOver(callers.operator, shipped.sellerOrderId))).toMatchObject({
      status: 403,
    })
  })

  it('answers 401 to a caller with no session (A4)', async () => {
    const shipped = await ship()

    const refused = await failure(
      api.client.request({
        path: `/seller-orders/${shipped.sellerOrderId}/shipment/advance`,
        method: 'POST',
        body: {},
        schema: shipmentResponseSchema,
      }),
    )

    expect(refused.status).toBe(401)
  })

  it('answers 404 for an order that has not shipped', async () => {
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
    const sellerOrderId = order.sellerOrders.at(0)?.id ?? ''

    // 소유권을 **먼저** 보고 나서 「배송이 없다」로 답한다. 순서가 반대면 남의
    // 주문에 배송이 붙었는지를 아무나 알 수 있다.
    expect(await failure(advanceOver(store.seller, sellerOrderId))).toMatchObject({ status: 404 })
  })
})

describe('실패 격리', () => {
  it('keeps going after one shipment throws, and leaves that one for the next cycle', async () => {
    const broken = await ship()

    // 두 건의 순서를 못 박는다. 목록은 오래된 것부터라 **던지는 쪽이 먼저**이고,
    // 그래야 「한 건이 나머지를 막는가」를 실제로 재게 된다.
    clock.advance(1_000)

    const healthy = await ship()

    clock.advance(STEP_MS)

    // **이 배치에는 바깥으로 나가는 시스템이 없다.** 결제 쪽은 결제사 대역이
    // 한 건을 거절해 주지만 여기서는 그런 자리가 없어서, 한 건을 던지게 만드는
    // 유일한 방법이 사건을 적는 문 자체를 잠깐 막는 것이다. 재는 것은 그 문이
    // 아니라 **그 다음에도 고리가 도는가**다.
    const shipments = api.resolve<ShipmentService>(ShipmentService)
    const original = shipments.recordTrackingEvent.bind(shipments)

    vi.spyOn(shipments, 'recordTrackingEvent').mockImplementation((input) =>
      input.shipmentId === broken.shipmentId
        ? Promise.reject(new Error('사건을 적지 못했습니다.'))
        : original(input),
    )

    const result = await simulator().advanceDue()

    // 하나가 던졌고 하나는 끝까지 갔다. 배치가 첫 예외에서 멈춘다면 뒤의 배송은
    // **영원히** 뒤에 있게 된다 — 목록이 오래된 것부터라 다음 주기에도 같은
    // 자리에서 같은 예외가 난다.
    expect(result).toEqual({ ...NOTHING, advanced: 1, failed: 1 })
    expect(await kindsOf(broken)).toEqual(['PICKED_UP'])
    expect(await kindsOf(healthy)).toEqual(['PICKED_UP', 'IN_TRANSIT'])

    // 던진 한 건은 「민 건수」에 들어가지 않는다. 그래야 계속 던지는 배송이
    // 「밀린 것이 안 줄어든다」로 드러난다.
    expect(await simulator().lastAdvanced()).toBe(1)

    // 문이 다시 열리면 다음 주기가 가져간다.
    vi.restoreAllMocks()
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })
    expect(await kindsOf(broken)).toEqual(['PICKED_UP', 'IN_TRANSIT'])
  })
})

describe('중복 방지 (F7)', () => {
  it('skips its turn while another instance holds the lock', async () => {
    const shipped = await ship()

    clock.advance(STEP_MS)

    // **겹침을 주선한다.** 두 배치를 동시에 던져서 재면 둘이 실제로는 앞뒤로
    // 돌았을 때에도 초록이 된다. 다른 인스턴스인 척 같은 열쇠를 붙잡고 있는
    // **동안에만** 배치를 부르면, 겹침은 희망이 아니라 배치가 된다.
    const skipped = await db.withConnection(async (connection) => {
      await connection.query('BEGIN')
      await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [DELIVERY_LOCK_KEY])

      const result = await simulator().advanceDue()

      await connection.query('ROLLBACK')
      return result
    })

    expect(skipped).toEqual({ ...NOTHING, skipped: true })
    // 고르지도 못했으니 사건 한 줄도 적히지 않는다 — 두 인스턴스가 같은 사건을
    // 두 번 적으면 추적 화면에 같은 줄이 둘 남고, 그것은 「운송사가 두 번 알려
    // 왔다」로 읽힌다.
    expect(await kindsOf(shipped)).toEqual(['PICKED_UP'])

    // **건너뛴 실행은 「돌았다」로 적지 않는다.** 적으면 한 인스턴스도 일하지
    // 못하는 상태에서 헬스체크가 계속 초록을 답한다.
    expect(await simulator().lastRunAt()).toBeNull()

    // 락이 풀리면 다음 주기가 가져간다.
    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })
  })
})

describe('돌았다는 기록과 헬스체크 (F6)', () => {
  it('answers null and zero before it has ever run', async () => {
    // 「아직 안 돌았다」와 「멈췄다」를 밖에서 구분할 방법은 없다. 여기서 0시각을
    // 지어내면 헬스체크는 부팅 직후를 영원히 건강하다고 답한다.
    expect(await simulator().lastRunAt()).toBeNull()
    expect(await simulator().lastAdvanced()).toBe(0)

    const health = await api.client.getHealth()

    expect(health.deliverySimulator).toEqual({
      status: 'degraded',
      lastRunAt: null,
      advancedCount: 0,
    })
  })

  it('publishes when it last ran and how many it moved', async () => {
    await ship()

    clock.advance(STEP_MS)

    const at = clock.now()

    expect(await simulator().advanceDue()).toEqual({ ...NOTHING, advanced: 1 })

    const health = await api.client.getHealth()

    expect(health.deliverySimulator).toEqual({
      status: 'ok',
      lastRunAt: at.toISOString(),
      advancedCount: 1,
    })
  })

  it('records an empty cycle as a cycle that ran', async () => {
    // 밀 것이 없는 주기는 정상이다. 그것을 「안 돌았다」로 적으면 배송이 뜸한
    // 시간마다 헬스체크가 빨개지고, 늘 빨간 헬스체크는 아무도 보지 않는다.
    const at = clock.now()

    expect(await simulator().advanceDue()).toEqual(NOTHING)
    expect((await simulator().lastRunAt())?.toISOString()).toBe(at.toISOString())
    expect(await simulator().lastAdvanced()).toBe(0)
    expect((await api.client.getHealth()).deliverySimulator.status).toBe('ok')
  })

  it('goes degraded once the simulator has been silent for too long', async () => {
    await simulator().advanceDue()

    clock.advance(DELIVERY_STALE_AFTER_MS + 1)

    const health = await api.client.getHealth()

    // 발송된 주문이 영영 배송 중일지 모르는 상태다. 요청은 하나도 실패하지
    // 않으므로 이 필드 말고는 그것을 말하는 자리가 없다.
    expect(health.deliverySimulator.status).toBe('degraded')
    expect(health.status).toBe('degraded')
  })
})
