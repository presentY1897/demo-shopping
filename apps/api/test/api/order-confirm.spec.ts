import type { ApiClient, OrderStatus } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  demoCarrierNames,
  orderResponseSchema,
  sellerOrderActionsResponseSchema,
  sellerOrderTransitionResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { APP_CONFIG } from '../../src/config/app-config.js'
import type { AppConfig } from '../../src/config/app-config.js'
import { OrderConfirmService } from '../../src/orders/order-confirm.service.js'
import {
  CONFIRM_LAST_CONFIRMED_KEY,
  CONFIRM_LAST_RUN_KEY,
  CONFIRM_LOCK_KEY,
} from '../../src/orders/order-confirm.js'
import type {
  OrderConfirmed,
  OrderConfirmedEvents,
} from '../../src/orders/order-confirmed-events.js'
import { ORDER_CONFIRMED_EVENTS } from '../../src/orders/order-confirmed-events.js'
import type { SellerOrderActor } from '../../src/orders/seller-order-transitions.js'
import { availableTransitions } from '../../src/orders/seller-order-transitions.js'
import { SellerOrderService } from '../../src/orders/seller-order.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
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
 * 구매확정 — 수동과 자동 (TASK-0064), 이 워커의 실제 데이터베이스에 대고.
 *
 * **이 파일이 지키는 것은 「확정은 때가 됐을 때만, 한 번만 일어난다」이다.** 확정은
 * 되돌릴 수 없고 정산(M12)·적립금(M11)의 방아쇠이므로, 틀리는 두 방향이 모두 나쁘다 —
 * 이르면 반품을 생각하던 사람의 주문이 닫히고, 늦거나 안 되면 판매자가 배송을 마친
 * 물건의 돈을 영영 못 받는다. 그리고 **어느 쪽도 빨간 검사로 나타나지 않는다.**
 *
 * 그래서 여기서 가장 값진 검사는 긍정형이 아니라 **부정형**이다. 전부 확정해 버리는
 * 배치도 F2 를 똑같이 통과하고, 매 주기 이력을 한 줄씩 더하는 배치도 「확정됐다」는
 * 단언을 통과한다. 「때가 안 됐으면 안 한다」와 「두 번째 주기는 아무 일도 하지
 * 않는다」가 그래서 F2 와 나란히 있다.
 *
 * 시각은 전부 **주입된 시계**다 (`clock-injection.spec.ts`). 벽시계로 D+7 을 재면 이
 * 스펙의 「아직 안 지났다」가 실행하는 날짜에 따라 뒤집히고, 그것은 초록과 빨강을
 * 오가는 실패가 아니라 **조용히 틀린 초록**이다.
 */

const db = useDatabase()
const clock = fixedClock(DEFAULT_TEST_INSTANT)

/**
 * 후속 이벤트를 받아 적는 대역 (F4).
 *
 * 정산도 적립금도 아직 없으므로 지금 확인할 수 있는 것은 「무엇이 그 자리로
 * 넘어가는가」뿐이다. 그런데 그 자리가 **한 곳**이라는 것이 이 TASK 의 설계이고,
 * 수동과 자동이 둘 다 그리로 오는지는 실제로 두 길을 걸어 봐야 안다.
 */
const published: OrderConfirmed[] = []
const recorder: OrderConfirmedEvents = {
  confirmed(events) {
    published.push(...events)

    return Promise.resolve()
  },
}

const api = useApiApp({
  database: db,
  authenticate: true,
  clock,
  overrides: [{ token: ORDER_CONFIRMED_EVENTS, value: recorder }],
})

/**
 * 운송장. 값 자체는 뜻이 없고, 「붙어 있다」가 발송을 여는 조건이다 (TASK-0059).
 *
 * 번호를 세어 가며 만드는 것은 `Shipment_trackingNumber_key` 때문이다 — 한 테스트가
 * 두 주문을 배송완료까지 데려가는 경우가 있고, 그때 같은 번호를 두 번 쓰면 스펙이
 * 재려는 것과 아무 상관 없는 자리에서 멈춘다.
 */
const TRACKING_CARRIER = 'GA' as const
let issued = 0

function nextTrackingNumber(): string {
  issued += 1

  return `DEMO-${TRACKING_CARRIER}-${String(issued).padStart(12, '0')}`
}

/** 배송완료가 일어난 시각. 이 스펙의 모든 「기간」이 여기서부터 잰다. */
const DELIVERED_AT = DEFAULT_TEST_INSTANT

let buyer: TestCaller
let addressId: string
let categoryId: number
let placed: Placed

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly seller: TestCaller
}

interface HistoryRow {
  readonly toStatus: string
  readonly actor: string
  readonly actorId: string | null
  readonly reason: string | null
}

beforeEach(async () => {
  clock.set(DEFAULT_TEST_INSTANT)
  published.length = 0

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  placed = await place()
})

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function confirmer(): OrderConfirmService {
  return api.resolve<OrderConfirmService>(OrderConfirmService)
}

function transitions(): SellerOrderService {
  return api.resolve<SellerOrderService>(SellerOrderService)
}

function prisma(): PrismaService {
  return api.resolve<PrismaService>(PrismaService)
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
 * 발송에 필요한 운송장을 붙인다.
 *
 * **배송 행이 먼저다.** 몫에 남는 번호는 그 행의 사본이고, 사본을 먼저 적으려 들면
 * 복합 외래키가 거절한다 (TASK-0061). 발급 경로를 흉내 내는 것이 아니라 상태 머신이
 * 읽을 사실 하나를 만드는 것이므로 SQL 로 만든다 — 운송장이 **어떻게** 만들어지는지는
 * `shipment.spec.ts` 가 잰다.
 */
async function attachTracking(sellerOrderId: string): Promise<void> {
  const trackingNumber = nextTrackingNumber()

  await db.query(
    `INSERT INTO "Shipment"
       ("id", "sellerOrderId", "carrierCode", "carrierName", "trackingNumber", "shippedAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())`,
    [sellerOrderId, TRACKING_CARRIER, demoCarrierNames[TRACKING_CARRIER], trackingNumber],
  )
  await db.query(`UPDATE "SellerOrder" SET "trackingNumber" = $2 WHERE "id" = $1`, [
    sellerOrderId,
    trackingNumber,
  ])
}

/** 전이 하나를, 사람이 없는 자리에서 부르는 그대로. */
async function step(to: OrderStatus, actor: SellerOrderActor): Promise<void> {
  await prisma().$transaction((tx) =>
    transitions().applyWithin(tx, placed.sellerOrderId, to, { actor, actorId: null }),
  )
}

/**
 * 이 몫을 배송완료까지 데려간다 — **문을 지나서**.
 *
 * 상태를 SQL 로 찍지 않는 이유는 이 스펙이 재는 것이 「이력에 적힌 배송완료 시각」
 * 이기 때문이다. 그 줄을 손으로 넣으면 배치가 읽는 사실을 스펙이 지어내는 것이 되고,
 * 문이 그 줄을 안 남기게 되는 날 이 파일은 여전히 초록이다.
 *
 * 네 전이가 모두 `at` 에 일어난 것으로 남는다 — 시계가 그 자리에 멈춰 있기 때문이고,
 * 이 스펙이 관심 있는 것은 마지막 줄 하나다.
 */
async function deliverAt(at: string = DELIVERED_AT): Promise<void> {
  await attachTracking(placed.sellerOrderId)
  clock.set(at)
  await step('PAID', 'SYSTEM')
  await step('PREPARING', 'SYSTEM')
  await step('SHIPPED', 'SELLER')
  await step('DELIVERED', 'SYSTEM')
}

/** 배송완료로부터 이만큼 지난 시각으로 시계를 옮긴다. */
function afterDelivery(offsetMs: number): void {
  clock.set(new Date(Date.parse(DELIVERED_AT) + offsetMs))
}

/** 자동 확정 기간. 배치가 쓰는 값을 그대로 묻는다 — 스펙이 다시 계산하지 않는다. */
function windowMs(): number {
  return confirmer().windowMs
}

async function statusOf(sellerOrderId: string = placed.sellerOrderId): Promise<string> {
  const row = await db.one<{ readonly status: string }>(
    `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "id" = $1`,
    [sellerOrderId],
  )

  return row.status
}

function historyOf(sellerOrderId: string = placed.sellerOrderId): Promise<HistoryRow[]> {
  return db.query<HistoryRow>(
    `SELECT "toStatus"::text AS "toStatus", "actor"::text AS "actor", "actorId", "reason"
       FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1 ORDER BY "id"`,
    [sellerOrderId],
  )
}

function metaValue(key: string): Promise<{ readonly value: string }[]> {
  return db.query<{ readonly value: string }>(`SELECT "value" FROM "AppMeta" WHERE "key" = $1`, [
    key,
  ])
}

describe('자동 확정 — 때가 되면 (F2)', () => {
  it('배송완료 후 기간이 지난 몫을 CONFIRMED 로 옮긴다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)

    const result = await confirmer().sweep()

    expect(result).toMatchObject({ confirmed: 1, noop: 0, failed: 0, skipped: false })
    expect(await statusOf()).toBe('CONFIRMED')
  })

  it('이력에 SYSTEM 이 남는다 — 사람을 지어내지 않는다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()

    const confirmed = (await historyOf()).at(-1)

    expect(confirmed?.toStatus).toBe('CONFIRMED')
    // 관리자 계정을 빌려 쓰면 이력에 「관리자가 확정했다」는 거짓이 남는다.
    expect(confirmed?.actor).toBe('SYSTEM')
    expect(confirmed?.actorId).toBeNull()
    // 왜 옮겼는지가 남아야 문의를 받는 사람이 답할 수 있다.
    expect(confirmed?.reason).not.toBeNull()
  })

  it('돈 사실과 건수를 남긴다 — 헬스체크가 읽는 두 행이다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()

    expect((await metaValue(CONFIRM_LAST_RUN_KEY)).at(0)?.value).toBe(clock.now().toISOString())
    expect((await metaValue(CONFIRM_LAST_CONFIRMED_KEY)).at(0)?.value).toBe('1')
  })
})

describe('자동 확정 — 때가 안 됐으면 (F2 의 반대편)', () => {
  it('기간이 지나지 않은 몫은 건드리지 않는다', async () => {
    await deliverAt()
    afterDelivery(windowMs() - 1_000)

    const result = await confirmer().sweep()

    expect(result.confirmed).toBe(0)
    expect(await statusOf()).toBe('DELIVERED')
  })

  it('정확히 기간이 된 순간은 아직 아니다 — 경계는 지난 뒤다', async () => {
    await deliverAt()
    afterDelivery(windowMs())

    await confirmer().sweep()

    expect(await statusOf()).toBe('DELIVERED')
  })

  it('배송완료가 아닌 몫은 기간과 무관하게 고르지 않는다', async () => {
    // 이력에 `DELIVERED` 줄이 있어도 지금 상태가 아니면 대상이 아니다 — 반품된
    // 주문을 다시 확정으로 끌어오면 반품된 물건이 정산 대상이 된다.
    await deliverAt()
    await step('RETURNED', 'SELLER')
    afterDelivery(windowMs() + 1_000)

    const result = await confirmer().sweep()

    expect(result.confirmed).toBe(0)
    expect(await statusOf()).toBe('RETURNED')
  })

  it('발송도 안 된 몫은 고르지 않는다', async () => {
    afterDelivery(windowMs() + 1_000)

    const result = await confirmer().sweep()

    expect(result.confirmed).toBe(0)
    expect(await statusOf()).toBe('PAYMENT_PENDING')
  })
})

describe('멱등 (F7 · R2)', () => {
  it('이미 확정된 몫에는 아무 일도 일어나지 않는다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()

    const before = await historyOf()
    const again = await confirmer().sweep()

    expect(again.confirmed).toBe(0)
    // 이력이 늘지 않는다. 늘어난 이력은 사람이 보기 전까지 아무 경보도 울리지 않는다.
    expect(await historyOf()).toHaveLength(before.length)
  })

  it('구매자가 먼저 눌렀으면 배치는 세지 않는다', async () => {
    await deliverAt()
    await client().request({
      path: `/seller-orders/${placed.sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'CONFIRMED' },
      schema: sellerOrderTransitionResponseSchema,
    })
    afterDelivery(windowMs() + 1_000)

    const result = await confirmer().sweep()

    // 고르기와 옮기기 사이가 아니라 **고르기 전에** 확정된 경우다. 상태 조건에서
    // 이미 빠지므로 `noop` 조차 되지 않는다.
    expect(result).toMatchObject({ confirmed: 0, noop: 0, failed: 0 })
  })

  it('후속 이벤트가 확정 한 번에 한 번만 발행된다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()
    await confirmer().sweep()

    expect(published).toHaveLength(1)
    expect(published.at(0)).toMatchObject({
      sellerOrderId: placed.sellerOrderId,
      actor: 'SYSTEM',
      idempotencyKey: placed.sellerOrderId,
    })
  })
})

describe('수동 확정은 여전히 동작한다 (F1 회귀)', () => {
  it('구매자가 배송완료된 주문을 확정한다', async () => {
    await deliverAt()

    const answer = await client().request({
      path: `/seller-orders/${placed.sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'CONFIRMED' },
      schema: sellerOrderTransitionResponseSchema,
    })

    expect(answer.status).toBe('CONFIRMED')
    expect(answer.changed).toBe(true)
    expect(await statusOf()).toBe('CONFIRMED')
  })

  it('두 번 눌러도 오류가 아니고, 두 번째는 아무것도 바꾸지 않는다', async () => {
    await deliverAt()

    for (const expected of [true, false]) {
      const answer = await client().request({
        path: `/seller-orders/${placed.sellerOrderId}/transitions`,
        method: 'POST',
        body: { to: 'CONFIRMED' },
        schema: sellerOrderTransitionResponseSchema,
      })

      expect(answer.changed).toBe(expected)
    }

    expect((await historyOf()).filter((row) => row.toStatus === 'CONFIRMED')).toHaveLength(1)
  })

  it('수동 확정도 같은 자리에서 후속 이벤트를 낸다 (F4)', async () => {
    await deliverAt()
    await client().request({
      path: `/seller-orders/${placed.sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'CONFIRMED' },
      schema: sellerOrderTransitionResponseSchema,
    })

    expect(published).toHaveLength(1)
    expect(published.at(0)).toMatchObject({ actor: 'BUYER', idempotencyKey: placed.sellerOrderId })
  })

  it('남의 주문은 확정하지 못한다 (F6)', async () => {
    await deliverAt()

    const stranger = await createUser(db, {})
    const failure = await client({ userId: stranger.id, roles: ['BUYER'] })
      .request({
        path: `/seller-orders/${placed.sellerOrderId}/transitions`,
        method: 'POST',
        body: { to: 'CONFIRMED' },
        schema: sellerOrderTransitionResponseSchema,
      })
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(failure).toBeInstanceOf(ApiClientError)
    expect(failure).toMatchObject({ status: 403 })
  })
})

describe('확정 뒤에는 반품이 닫힌다 (F5)', () => {
  /**
   * **새로 막는 코드가 없다.** 전이표에서 `CONFIRMED` 는 종착 상태이고
   * (`seller-order-transitions.ts` — `CONFIRMED: []`), 상태를 옮기는 길은 그 표를
   * 지나는 문 하나뿐이다. 아래 셋은 그 사실이 **실제로** 그렇게 동작하는지를 잰다 —
   * 규칙을 지어내지 않았다는 것의 증거이자, 언젠가 그 표에 화살표가 하나 늘면
   * 여기서 빨개진다.
   */
  beforeEach(async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()
  })

  it('판매자가 반품 완료로 옮기려 하면 거절된다', async () => {
    const failure = await client(placed.seller)
      .request({
        path: `/seller-orders/${placed.sellerOrderId}/transitions`,
        method: 'POST',
        body: { to: 'RETURNED' },
        schema: sellerOrderTransitionResponseSchema,
      })
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(failure).toBeInstanceOf(ApiClientError)
    expect(failure).toMatchObject({ status: 409 })
    expect(await statusOf()).toBe('CONFIRMED')
  })

  it('아무도 이 몫을 어디로도 옮길 수 없다', () => {
    // 관리자도 예외가 아니다. 「하자 반품은 관리자 개입」은 M10 의 클레임 절차이지
    // 이 표의 화살표가 아니다 — 여기 하나 열면 확정이 종착 상태가 아니게 된다.
    for (const actor of ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'] as const) {
      expect(availableTransitions('CONFIRMED', actor)).toEqual([])
    }
  })

  it('화면이 받는 액션 목록도 비어 있다', async () => {
    const answer = await client().request({
      path: `/seller-orders/${placed.sellerOrderId}/actions`,
      schema: sellerOrderActionsResponseSchema,
    })

    expect(answer.status).toBe('CONFIRMED')
    expect(answer.actions).toEqual([])
  })
})

describe('두 인스턴스가 겹쳐도 (락)', () => {
  it('남이 락을 쥐고 있는 동안에는 건너뛰고, 건너뛴 것은 적지 않는다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)

    // **겹침을 주선한다.** 두 배치를 동시에 던져서 재면 둘이 앞뒤로 돌았을 때에도
    // 초록이 된다 (`support/concurrently.ts`). 다른 인스턴스인 척 같은 열쇠를
    // 붙잡고 있는 **동안에만** 배치를 부르면 겹침은 희망이 아니라 배치가 된다.
    const skipped = await db.withConnection(async (connection) => {
      await connection.query('BEGIN')
      await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [CONFIRM_LOCK_KEY])

      const result = await confirmer().sweep()

      await connection.query('ROLLBACK')
      return result
    })

    expect(skipped).toEqual({ confirmed: 0, noop: 0, failed: 0, skipped: true })
    expect(await statusOf()).toBe('DELIVERED')
    // 건너뛴 것을 「돌았다」로 적으면 헬스체크가 멈춘 배치를 건강하다고 답한다.
    expect(await confirmer().lastRunAt()).toBeNull()

    // 락이 풀리면 다음 주기가 가져간다. 건너뛴 것은 잊히는 것이 아니다.
    expect((await confirmer().sweep()).confirmed).toBe(1)
  })

  it('동시에 돌아도 한 몫이 두 번 확정되지 않는다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)

    const results = await concurrently(2, () => confirmer().sweep())

    // 「하나만 성공했다」가 아니다. 요구하는 것은 **처리 중복 0건**이고, 그것은 둘이
    // 확정한 것의 합이 대상 수와 정확히 같다는 뜻이다.
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(fulfilled(results).reduce((sum, result) => sum + result.confirmed, 0)).toBe(1)
    expect((await historyOf()).filter((row) => row.toStatus === 'CONFIRMED')).toHaveLength(1)
  })
})

describe('한 건이 실패해도 (실패 격리)', () => {
  /**
   * **한 건의 실패가 배치를 멈추면, 옮길 수 없는 몫 하나가 나머지 전부를 영원히
   * 막는다** — 목록이 오래된 것부터라서 그 한 건은 다음 주기에도 맨 앞에 있고, 그때도
   * 같은 자리에서 던진다.
   *
   * 실제로 여기 걸리는 것은 「고른 뒤에 상태가 바뀐 몫」인데, 그 창은 두 문장 사이라
   * 스펙이 조준할 수 없다. 그래서 **문을 한 번 던지게 만들어** 같은 모양을 만든다 —
   * 데이터베이스는 진짜이고(A6), 바뀐 것은 이 배치가 부르는 포트 하나뿐이다.
   */
  it('나머지는 확정되고, 실패한 건만 다음 주기로 넘어간다', async () => {
    await deliverAt()
    const poisoned = placed.sellerOrderId

    placed = await place()
    await deliverAt()
    const healthy = placed.sellerOrderId

    afterDelivery(windowMs() + 1_000)

    const real = transitions()
    const failing: SellerOrderService = Object.assign(Object.create(real) as SellerOrderService, {
      applyWithin: (...args: Parameters<SellerOrderService['applyWithin']>) =>
        args[1] === poisoned
          ? Promise.reject(new Error('이 몫은 옮길 수 없습니다.'))
          : real.applyWithin(...args),
    })
    const isolated = new OrderConfirmService(
      prisma(),
      clock,
      api.resolve<AppConfig>(APP_CONFIG),
      failing,
    )

    const result = await isolated.sweep()

    expect(result).toMatchObject({ confirmed: 1, failed: 1 })
    expect(await statusOf(healthy)).toBe('CONFIRMED')
    expect(await statusOf(poisoned)).toBe('DELIVERED')
  })
})

describe('화면이 읽을 예정 시각 (F8 · 계약)', () => {
  /** 이 주문의 묶음 하나를 계약 그대로 다시 읽는다. */
  async function bundle() {
    const { order } = await client().request({
      path: `/orders/${placed.orderId}`,
      schema: orderResponseSchema,
    })

    return order.sellerOrders.at(0)
  }

  it('배송완료된 몫은 확정될 시각을 함께 답한다', async () => {
    await deliverAt()

    // **서버가 계산해서 준다.** 화면이 이력에 D+7 을 더하면 시간을 압축한 배포에서
    // 그 날짜가 틀리는데, 화면은 압축 여부를 어떤 응답에서도 읽을 수 없다.
    expect((await bundle())?.autoConfirmAt).toBe(
      new Date(Date.parse(DELIVERED_AT) + windowMs()).toISOString(),
    )
  })

  it('아직 배송 중인 몫에는 예정이 없다', async () => {
    expect((await bundle())?.autoConfirmAt).toBeNull()
  })

  it('확정되고 나면 예정이 사라진다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()

    expect((await bundle())?.autoConfirmAt).toBeNull()
  })

  it('화면이 말한 시각에 실제로 확정된다', async () => {
    // 두 값이 같은 사실에서 나오는지가 요점이다. 배치가 다른 시각을 보면 「예정일이
    // 지났는데 그대로인 주문」이 생기고, 그것은 아무 오류도 내지 않는다.
    await deliverAt()
    const promised = (await bundle())?.autoConfirmAt

    clock.set(new Date(Date.parse(String(promised)) + 1_000))

    expect((await confirmer().sweep()).confirmed).toBe(1)
  })
})

describe('기록을 읽는 법', () => {
  /** `AppMeta` 는 문자열 표라 무엇이든 들어갈 수 있다. */
  async function record(key: string, value: string): Promise<void> {
    await db.query(
      `INSERT INTO "AppMeta" ("key", "value", "updatedAt") VALUES ($1, $2, now())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
      [key, value],
    )
  }

  it('한 번도 안 돌았으면 시각은 없고 건수는 0 이다', async () => {
    expect(await confirmer().lastRunAt()).toBeNull()
    expect(await confirmer().lastConfirmed()).toBe(0)
  })

  it('손으로 고친 행이 헬스체크를 데리고 넘어지지 않는다', async () => {
    // 날짜가 아닌 값은 「기록이 없다」와 같게 다룬다 — 어느 쪽이든 이 숫자를 믿으면
    // 안 된다는 뜻이고, 읽는 쪽이 둘로 할 수 있는 일이 다르지 않다.
    await record(CONFIRM_LAST_RUN_KEY, '어제쯤')
    await record(CONFIRM_LAST_CONFIRMED_KEY, '많이')

    expect(await confirmer().lastRunAt()).toBeNull()
    expect(await confirmer().lastConfirmed()).toBe(0)
  })
})

describe('헬스체크가 이 잡을 본다 (6장)', () => {
  it('한 번도 안 돌았으면 degraded 로 말한다', async () => {
    const health = await api.client.getHealth()

    expect(health.orderConfirm).toEqual({ status: 'degraded', lastRunAt: null, confirmedCount: 0 })
  })

  it('막 돌았으면 ok 와 함께 시각·건수를 싣는다', async () => {
    await deliverAt()
    afterDelivery(windowMs() + 1_000)
    await confirmer().sweep()

    const health = await api.client.getHealth()

    expect(health.orderConfirm).toEqual({
      status: 'ok',
      lastRunAt: clock.now().toISOString(),
      confirmedCount: 1,
    })
  })

  it('오래 안 돌았으면 다시 degraded 가 된다', async () => {
    await confirmer().sweep()
    // 임계치는 `order-confirm.ts` 가 쥔다. 스펙이 그 숫자를 다시 적으면 둘이
    // 갈리는 날 이 검사만 초록이다.
    clock.set(new Date(clock.now().getTime() + 6 * 60_000 * 5))

    const health = await api.client.getHealth()

    expect(health.orderConfirm.status).toBe('degraded')
  })
})

describe('전이 주체 (설계서 1장)', () => {
  it('구매자와 SYSTEM 만 확정으로 갈 수 있다', () => {
    const actorsOf = (actor: SellerOrderActor): readonly OrderStatus[] =>
      availableTransitions('DELIVERED', actor).map((rule) => rule.to)

    expect(actorsOf('BUYER')).toContain('CONFIRMED')
    expect(actorsOf('SYSTEM')).toContain('CONFIRMED')
    expect(actorsOf('SELLER')).not.toContain('CONFIRMED')
    expect(actorsOf('ADMIN')).not.toContain('CONFIRMED')
  })
})
