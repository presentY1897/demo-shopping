import type { ApiClient, Payment } from '@shopping/shared'
import {
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  paymentResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  RECONCILE_GRACE_MS,
  RECONCILE_LOCK_KEY,
  RECONCILE_STALE_AFTER_MS,
} from '../../src/payment/payment-reconcile.js'
import { PaymentReconcileService } from '../../src/payment/payment-reconcile.service.js'
import type { TossClient, TossConfirmRequest, TossPayment } from '../../src/payment/toss.client.js'
import { TOSS_CLIENT, TOSS_UNREACHABLE, TossError } from '../../src/payment/toss.client.js'
import { useApiApp } from '../support/api-app.js'
import { testTossConfig } from '../support/app-config.js'
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

/**
 * 대사 배치 (TASK-0056 F6 · F8 · F9 · D-220), 이 워커의 실제 데이터베이스에 대해.
 *
 * **이 배치가 없으면 사람이 갇힌다.** 승인 요청이 결제사에 닿지 못하면 결제는
 * `UNRESOLVED` — 「승인됐는지 우리가 모른다」 — 로 남고, 거기서 나가는 길은 대사만
 * 연다. 그동안 그 주문에는 새 결제를 시작할 수도 없다. 즉 카드에서 돈이 빠졌는지도
 * 모르는 채로 다시 결제할 수도 없는 사람이 남고, **아무것도 실패하지 않는다.**
 *
 * 그래서 이 파일의 단언은 상태 하나로 끝나지 않는다. 「`PAID` 가 됐다」는 전부
 * 풀어 버리는 대사도 통과하고, 「`FAILED` 가 됐다」는 예약을 놓아 버린 대사도
 * 통과한다. 매번 **사슬 전체** — 결제 · 주문 · 예약 · 실물 재고 — 를 함께 본다.
 *
 * **토스의 HTTP 는 가짜다** (QUALITY-GATES 6장). `TOSS_CLIENT` 가 토스와 말하는
 * 유일한 자리라 그 포트를 대역으로 바꾸면 나머지 — 배치, 서비스, 프로바이더,
 * 데이터베이스 — 는 전부 배포되는 그것이다. `toss-payment.spec.ts` 의 `FakeToss`
 * 와 같은 장치이고, 다른 것은 여기서는 **`getByOrderId` 가 주인공**이라는 점이다:
 * 승인이 끊긴 건에는 `paymentKey` 가 없어서, 물어볼 수 있는 유일한 열쇠가 우리가
 * 보낸 결제 id 다.
 *
 * 시각은 전부 **주입된 시계**다. 유예를 벽시계로 재면 이 스펙의 「아직 안
 * 지났다」가 실행하는 날에 따라 뒤집히고, 그것은 빨강과 초록을 오가는 실패가
 * 아니라 **조용히 틀린 초록**이다.
 */

const db = useDatabase()
const clock = fixedClock(DEFAULT_TEST_INSTANT)

/** 결제창이 돌려주는 키. 끊긴 승인에서는 이 키가 우리에게 오지 못한다. */
const WIDGET_KEY = 'toss-widget-payment-key'

/** 대사가 되찾아 오는 키. 저쪽에만 있던 값이고, 그것이 이 상태의 정의다. */
const RECOVERED_KEY = 'toss-recovered-payment-key'

/** 저쪽에 닿지 못했다 — 거절이 아니라 **모름**이다 (D-220). */
function unreachable(): TossError {
  return new TossError(TOSS_UNREACHABLE, '토스 승인 API 에 닿지 못했습니다')
}

/** 토스에 나간 한 마디. */
interface TossCall {
  readonly method: 'confirm' | 'cancel' | 'get' | 'getByOrderId'
  readonly orderId: string | null
}

/**
 * 검사가 대본을 쥔 토스.
 *
 * 모킹이 아니라 **포트의 또 하나의 구현**이다. 나간 호출을 기록하는 이유는 이
 * 파일이 재야 하는 것 중 하나가 **묻지 않았다**이기 때문이다 — 유예 안의 건을
 * 물어보는 구현도 「상태가 그대로다」는 똑같이 통과한다.
 */
class FakeToss implements TossClient {
  readonly calls: TossCall[] = []
  /** 승인 호출이 아예 실패한다. `UNRESOLVED` 를 만드는 유일한 길이다. */
  confirmFailure: TossError | null = null

  /** 우리 결제 id 로 물었을 때 저쪽이 아는 것. 기본은 **모른다**(`null`). */
  private readonly byOrderId = new Map<string, TossPayment>()

  reset(): void {
    this.calls.length = 0
    this.confirmFailure = null
    this.byOrderId.clear()
  }

  /** 저쪽이 이 결제를 알고 있는 것으로 만든다. */
  knows(orderId: string, payment: Omit<TossPayment, 'paymentKey'> & { paymentKey?: string }): void {
    this.byOrderId.set(orderId, { paymentKey: RECOVERED_KEY, ...payment })
  }

  /** 지금까지 들은 것을 잊는다. 준비가 만든 호출과 대사가 만든 호출을 가른다. */
  forgetCalls(): void {
    this.calls.length = 0
  }

  callsTo(method: TossCall['method']): readonly TossCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  confirm(request: TossConfirmRequest): Promise<TossPayment> {
    this.calls.push({ method: 'confirm', orderId: request.orderId })

    if (this.confirmFailure !== null) return Promise.reject(this.confirmFailure)

    return Promise.resolve({
      paymentKey: request.paymentKey,
      status: 'DONE',
      totalAmount: request.amount,
    })
  }

  getByOrderId(orderId: string): Promise<TossPayment | null> {
    this.calls.push({ method: 'getByOrderId', orderId })

    return Promise.resolve(this.byOrderId.get(orderId) ?? null)
  }

  cancel(paymentKey: string): Promise<TossPayment> {
    this.calls.push({ method: 'cancel', orderId: null })

    return Promise.resolve({ paymentKey, status: 'CANCELED', totalAmount: 0 })
  }

  get(paymentKey: string): Promise<TossPayment> {
    this.calls.push({ method: 'get', orderId: null })

    return Promise.resolve({ paymentKey, status: 'DONE', totalAmount: 0 })
  }
}

const toss = new FakeToss()

const api = useApiApp({
  database: db,
  authenticate: true,
  clock,
  config: { toss: testTossConfig },
  overrides: [{ token: TOSS_CLIENT, value: toss }],
})

let buyer: TestCaller
let addressId: string
let categoryId: number

function reconciler(): PaymentReconcileService {
  return api.resolve<PaymentReconcileService>(PaymentReconcileService)
}

function client(): ApiClient {
  return api.clientAs(buyer)
}

beforeEach(async () => {
  // 시계는 매 테스트 같은 자리에서 시작한다. 앞 테스트가 옮겨 둔 시각을 물려받으면
  // 「유예를 아직 안 지났다」가 실행 순서에 따라 달라진다.
  clock.set(DEFAULT_TEST_INSTANT)
  toss.reset()

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

/** 팔 수 있는 조합 하나. 그 variant id 를 돌려준다. */
async function listing(price: number, stock: number): Promise<string> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    minPrice: price,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price,
    stock,
    isActive: true,
  })

  return variant.id
}

interface PlacedOrder {
  readonly orderId: string
  /** 이 주문이 잡은 예약을 찾는 열쇠다 (`Order.checkoutId`). */
  readonly checkoutId: string
  readonly paidAmount: number
  readonly variantId: string
}

/**
 * 결제를 붙일 수 있는 진짜 주문 하나.
 *
 * 장바구니 → 주문서 → 주문. 금액도 배송비 규칙을 지나온 값이라 이 파일 어디에도
 * 총액을 손으로 적지 않는다.
 */
async function place(quantity = 2, stock = 10): Promise<PlacedOrder> {
  const variantId = await listing(20_000, stock)
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity },
    schema: cartResponseSchema,
  })
  const itemId =
    cart.groups.flatMap((group) => group.items).find((item) => item.variantId === variantId)?.id ??
    ''
  const { checkout } = await client().request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds: [itemId] },
    schema: checkoutResponseSchema,
  })
  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { checkoutId: checkout.id, addressId },
    schema: orderResponseSchema,
  })

  return { orderId: order.id, checkoutId: checkout.id, paidAmount: order.paidAmount, variantId }
}

/** 결제를 시작하고 결제창을 지나 서버 승인까지. 그 결과의 결제를 돌려준다. */
async function payWithToss(placed: PlacedOrder): Promise<Payment> {
  const started = await client().request({
    path: '/payments',
    method: 'POST',
    body: { orderId: placed.orderId, provider: 'TOSS' },
    schema: paymentResponseSchema,
  })
  const { payment } = await client().request({
    path: `/payments/${started.payment.id}/toss/confirm`,
    method: 'POST',
    body: { paymentKey: WIDGET_KEY, amount: placed.paidAmount },
    schema: paymentResponseSchema,
  })

  return payment
}

interface Unresolved extends PlacedOrder {
  readonly paymentId: string
}

/**
 * 결과를 모르는 결제 하나를 만든다 — **F8 그 자체다.**
 *
 * 승인 호출이 저쪽에 닿지 못하게 해 두고 정상적인 결제 흐름을 그대로 태운다.
 * 대사가 풀 대상은 손으로 만든 행이 아니라 이렇게 생긴 결제여야 한다: 주문도
 * 예약도 함께 걸려 있어야 F9 가 재는 사슬이 성립한다.
 */
async function unresolved(quantity = 2, stock = 10): Promise<Unresolved> {
  const placed = await place(quantity, stock)

  toss.confirmFailure = unreachable()

  const payment = await payWithToss(placed)

  expect(payment.status).toBe('UNRESOLVED')

  // 다음 호출부터는 저쪽이 살아 있다. 대사가 물어볼 수 있어야 하기 때문이고,
  // 실제로도 「끊겼다가 돌아온다」가 이 상태를 푸는 상황이다.
  toss.confirmFailure = null

  return { ...placed, paymentId: payment.id }
}

/** 유예를 지나게 한다. 이 한 줄이 있어야 대사가 그 결제를 쳐다본다. */
function passGrace(): void {
  clock.advance(RECONCILE_GRACE_MS + 1)
}

async function readPayment(paymentId: string): Promise<Payment> {
  const { payment } = await client().request({
    path: `/payments/${paymentId}`,
    schema: paymentResponseSchema,
  })

  return payment
}

interface EventRow {
  readonly kind: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly reason: string | null
}

/** 이 결제에 남은 사건 전부. 분쟁과 불일치 조사의 유일한 근거다. */
function eventsOf(paymentId: string): Promise<EventRow[]> {
  return db.query<EventRow>(
    `SELECT "kind", "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
            "payload"->>'reason' AS "reason"
       FROM "PaymentEvent" WHERE "paymentId" = $1 ORDER BY "createdAt", "id"`,
    [paymentId],
  )
}

/** 이 주문의 판매자 몫 상태 전부. */
async function sellerOrderStatuses(orderId: string): Promise<string[]> {
  const rows = await db.query<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "orderId" = $1 ORDER BY "id"`,
    [orderId],
  )

  return rows.map((row) => row.status)
}

/** 이 주문서가 잡은 예약의 상태 전부. */
async function reservationStatuses(checkoutId: string): Promise<string[]> {
  const rows = await db.query<{ status: string }>(
    `SELECT "status"::text AS "status"
       FROM "StockReservation" WHERE "checkoutId" = $1 ORDER BY "id"`,
    [checkoutId],
  )

  return rows.map((row) => row.status)
}

/** 표에서 바로 읽은 실물 재고와 예약분. */
function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

/** 아무것도 만나지 않은 주기. 단언을 이 값에서 시작하면 빠뜨린 칸이 없다. */
const NOTHING = {
  settled: 0,
  failed: 0,
  pending: 0,
  noop: 0,
  unreachable: 0,
  skipped: false,
} as const

describe('닿지 못한 승인 (F8)', () => {
  it('parks the payment as unresolved while the order and its reservation wait', async () => {
    const placed = await place()

    toss.confirmFailure = unreachable()

    const payment = await payWithToss(placed)

    // **`AUTHORIZED` 도 `FAILED` 도 아니다.** 앞은 낙관이라 그 불일치가 매입할
    // 때가 되어서야 돈으로 나타나고, 뒤는 「거절당했다」라는 틀린 사실이며 나가는
    // 화살표가 없어 대사가 찾아내도 옮길 곳이 없다 (D-220).
    expect(payment).toMatchObject({ status: 'UNRESOLVED', paymentKey: null, approvedAt: null })

    // 주문은 완료되지 않았고 —
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])
    // — **예약은 살아 있다.** 놓아 버리면 대사가 「승인됐다」를 확인해도 팔 물건이
    // 없다. 이 한 줄이 F8 에서 가장 중요하다.
    expect(await reservationStatuses(placed.checkoutId)).toEqual(['HELD'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
  })
})

describe('대사가 승인을 되찾는다 (F9-a)', () => {
  it('carries a payment the provider had approved all the way to a paid order', async () => {
    const held = await unresolved()

    // 저쪽에는 승인이 나 있었다. 우리가 못 받은 것은 **응답뿐**이었다.
    toss.knows(held.paymentId, { status: 'DONE', totalAmount: held.paidAmount })
    toss.forgetCalls()
    passGrace()

    const result = await reconciler().reconcile()

    expect(result).toEqual({ ...NOTHING, settled: 1 })

    // **우리 결제 id 로 물었다.** 승인이 끊긴 건에는 `paymentKey` 가 없으므로
    // 그것이 이 결제로 돌아가는 유일한 열쇠다 (TASK-0055 4.3).
    expect(toss.callsTo('getByOrderId')).toEqual([
      { method: 'getByOrderId', orderId: held.paymentId },
    ])

    const payment = await readPayment(held.paymentId)

    // `AUTHORIZED` 를 지나 `PAID` 까지. 매입에서 멈추면 돈은 잡혀 있는데 주문이
    // 없고, 그것이 이 TASK 가 없애려는 상태 그대로다.
    expect(payment).toMatchObject({ status: 'PAID', paymentKey: RECOVERED_KEY })
    expect(payment.approvedAt).not.toBeNull()

    const events = await eventsOf(held.paymentId)

    // 사슬이 사건으로도 남는다. 두 화살표가 **둘 다** 있어야 나중에 「이 결제가
    // 어떻게 살아났나」에 답할 수 있다.
    expect(events.map((event) => event.kind)).toEqual([
      'REQUESTED',
      'FAILED',
      'AUTHORIZED',
      'CAPTURED',
    ])
    expect(events[2]).toMatchObject({ fromStatus: 'UNRESOLVED', toStatus: 'AUTHORIZED' })
    expect(events[3]).toMatchObject({ fromStatus: 'AUTHORIZED', toStatus: 'PAID' })

    // 그리고 사슬 전체가 참이 된다 — 주문이 `PAID`, 예약이 확정, **재고가 실제로
    // 줄었다.** 한 칸씩 따로 보는 검사는 그 사슬이 끊긴 날에도 전부 초록이다.
    expect(await sellerOrderStatuses(held.orderId)).toEqual(['PAID'])
    expect(await reservationStatuses(held.checkoutId)).toEqual(['CONFIRMED'])
    expect(await levelsOf(held.variantId)).toEqual({ stock: 8, reserved: 0 })
  })
})

describe('대사가 승인이 없었음을 확인한다 (F9-b)', () => {
  it('fails a payment the provider never received, and unblocks the next attempt', async () => {
    const held = await unresolved()

    // 저쪽에도 이 결제가 없다 — 요청이 도착조차 하지 않았다.
    toss.forgetCalls()
    passGrace()

    expect(await reconciler().reconcile()).toEqual({ ...NOTHING, failed: 1 })

    const payment = await readPayment(held.paymentId)

    expect(payment).toMatchObject({ status: 'FAILED', paymentKey: null, approvedAt: null })

    const events = await eventsOf(held.paymentId)

    expect(events.map((event) => event.kind)).toEqual(['REQUESTED', 'FAILED', 'FAILED'])
    expect(events[2]).toMatchObject({ fromStatus: 'UNRESOLVED', toStatus: 'FAILED' })
    // 저쪽이 준 문장이 그대로 남는다. 이유 없는 실패는 CS 에게 아무 말도 하지 않는다.
    expect(events[2]?.reason ?? '').not.toBe('')

    // **예약은 그대로 살아 있다.** 결제가 실패했다고 재고를 놓아 버리면 다시
    // 결제하려는 사람이 방금까지 자기 것이던 물건을 못 산다 — 만료 청소기가
    // 제때에 그것을 푼다(TASK-0051).
    expect(await sellerOrderStatuses(held.orderId)).toEqual(['PAYMENT_PENDING'])
    expect(await reservationStatuses(held.checkoutId)).toEqual(['HELD'])
    expect(await levelsOf(held.variantId)).toEqual({ stock: 10, reserved: 2 })

    // **그리고 다시 결제할 수 있다.** 「결과를 모르는 결제」가 있는 동안 새 결제는
    // 409 로 막혀 있었다(D-220) — 대사가 그것을 풀었으므로 이 요청이 지나간다.
    // 이 한 줄이 없으면 「상태만 바뀌고 사람은 그대로 갇힌」 대사도 통과한다.
    const retried = await client().request({
      path: '/payments',
      method: 'POST',
      body: { orderId: held.orderId, provider: 'TOSS' },
      schema: paymentResponseSchema,
    })

    expect(retried.payment).toMatchObject({ status: 'READY', authorizedAmount: held.paidAmount })
  })
})

describe('저쪽도 아직 모른다', () => {
  it('leaves the payment exactly where it was, and writes no event for it', async () => {
    const held = await unresolved()

    // 저쪽이 아직 처리 중이다. 「없다」가 아니라 「모른다」이고, 그 둘을 같게
    // 읽으면 승인이 곧 날 결제를 우리가 실패로 끝낸다.
    toss.knows(held.paymentId, { status: 'IN_PROGRESS', totalAmount: held.paidAmount })

    const before = await eventsOf(held.paymentId)

    toss.forgetCalls()
    passGrace()

    expect(await reconciler().reconcile()).toEqual({ ...NOTHING, pending: 1 })

    // 물어보기는 했다 — 유예를 지났으니 묻는 것이 맞다.
    expect(toss.callsTo('getByOrderId')).toHaveLength(1)
    expect((await readPayment(held.paymentId)).status).toBe('UNRESOLVED')

    // **그리고 사건이 늘지 않았다.** 1분마다 「아직 모릅니다」를 한 줄씩 쌓으면
    // 정작 읽어야 할 상태 변화가 그 사이에 묻힌다.
    expect(await eventsOf(held.paymentId)).toEqual(before)
  })
})

describe('유예 (R2)', () => {
  it('does not even ask about a payment that was only just cut off', async () => {
    const held = await unresolved()

    toss.knows(held.paymentId, { status: 'DONE', totalAmount: held.paidAmount })
    toss.forgetCalls()

    // 시계를 옮기지 않는다 — 방금 끊긴 건이다.
    expect(await reconciler().reconcile()).toEqual(NOTHING)

    // **대역이 한 마디도 듣지 않았다.** 「상태가 그대로다」만 보면 물어보고 나서
    // 아무것도 안 한 구현도 통과하는데, 그쪽은 저쪽이 처리 중인 결제를 매 주기
    // 두드리는 모양이다 (R2 — 과도한 API 호출).
    expect(toss.calls).toEqual([])
    expect((await readPayment(held.paymentId)).status).toBe('UNRESOLVED')

    // 유예가 지나면 그때 묻는다. 미룬 것은 잊는 것이 아니다.
    passGrace()

    expect(await reconciler().reconcile()).toEqual({ ...NOTHING, settled: 1 })
  })
})

describe('중복 방지', () => {
  it('skips its turn while another instance holds the lock', async () => {
    const held = await unresolved()

    toss.knows(held.paymentId, { status: 'DONE', totalAmount: held.paidAmount })
    toss.forgetCalls()
    passGrace()

    // **겹침을 주선한다.** 두 대사를 동시에 던져서 재면 둘이 실제로는 앞뒤로
    // 돌았을 때에도 초록이 된다. 다른 인스턴스인 척 같은 열쇠를 붙잡고 있는
    // **동안에만** 대사를 부르면, 겹침은 희망이 아니라 배치가 된다.
    const skipped = await db.withConnection(async (connection) => {
      await connection.query('BEGIN')
      await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [RECONCILE_LOCK_KEY])

      const result = await reconciler().reconcile()

      await connection.query('ROLLBACK')
      return result
    })

    expect(skipped).toEqual({ ...NOTHING, skipped: true })
    // 고르지도 못했으니 저쪽에 한 마디도 나가지 않는다 — 이 락이 사는 값이다.
    expect(toss.calls).toEqual([])
    expect((await readPayment(held.paymentId)).status).toBe('UNRESOLVED')

    // **건너뛴 실행은 「돌았다」로 적지 않는다.** 적으면 한 인스턴스도 물어보지
    // 못하는 상태에서 헬스체크가 계속 초록을 답한다.
    expect(await reconciler().lastRunAt()).toBeNull()

    // 락이 풀리면 다음 주기가 가져간다.
    expect(await reconciler().reconcile()).toEqual({ ...NOTHING, settled: 1 })
  })
})

describe('실패 격리', () => {
  it('keeps going after one payment throws, and leaves that one for the next cycle', async () => {
    // 먼저 정상적으로 끝난 결제 하나. 그 결제키가 이미 우리 표에 있다는 사실이
    // 아래에서 한 건을 던지게 만든다 — `Payment.paymentKey` 는 유니크다.
    const paid = await place()

    await payWithToss(paid)

    const broken = await unresolved()

    // 두 건의 순서를 못 박는다. 목록은 오래된 것부터라 **던지는 쪽이 먼저**이고,
    // 그래야 「한 건이 나머지를 막는가」를 실제로 재게 된다.
    clock.advance(1_000)

    const healthy = await unresolved()

    // 저쪽이 이미 우리 것인 결제키를 답한다. 원인이 무엇이든 이 한 건은 지금
    // 쓸 수 없고, 중요한 것은 **나머지가 계속 도는가**다.
    toss.knows(broken.paymentId, {
      paymentKey: WIDGET_KEY,
      status: 'DONE',
      totalAmount: broken.paidAmount,
    })
    toss.knows(healthy.paymentId, { status: 'DONE', totalAmount: healthy.paidAmount })
    toss.forgetCalls()
    passGrace()

    const result = await reconciler().reconcile()

    // 하나가 던졌고 하나는 끝까지 갔다. 배치가 첫 예외에서 멈춘다면 이 결제는
    // **영원히** 뒤에 있게 된다 — 목록이 오래된 것부터라 다음 주기에도 같은
    // 자리에서 같은 예외가 난다.
    expect(result).toEqual({ ...NOTHING, settled: 1, unreachable: 1 })
    expect(toss.callsTo('getByOrderId')).toHaveLength(2)

    expect((await readPayment(broken.paymentId)).status).toBe('UNRESOLVED')
    expect((await readPayment(healthy.paymentId)).status).toBe('PAID')
    expect(await sellerOrderStatuses(healthy.orderId)).toEqual(['PAID'])

    // 던진 한 건은 「푼 건수」에 들어가지 않는다. 그래야 계속 던지는 결제가
    // 「밀린 것이 안 줄어든다」로 드러난다.
    expect(await reconciler().lastResolved()).toBe(1)
  })
})

describe('돌았다는 기록과 헬스체크', () => {
  it('answers null and zero before it has ever run', async () => {
    // 「아직 안 돌았다」와 「멈췄다」를 밖에서 구분할 방법은 없다. 여기서 0시각을
    // 지어내면 헬스체크는 부팅 직후를 영원히 건강하다고 답한다.
    expect(await reconciler().lastRunAt()).toBeNull()
    expect(await reconciler().lastResolved()).toBe(0)

    const health = await api.client.getHealth()

    expect(health.paymentReconcile).toEqual({
      status: 'degraded',
      lastRunAt: null,
      resolvedCount: 0,
    })
  })

  it('publishes when it last ran and how many it resolved', async () => {
    const held = await unresolved()

    toss.knows(held.paymentId, { status: 'DONE', totalAmount: held.paidAmount })
    passGrace()

    const at = clock.now()

    await reconciler().reconcile()

    expect((await reconciler().lastRunAt())?.toISOString()).toBe(at.toISOString())
    expect(await reconciler().lastResolved()).toBe(1)

    const health = await api.client.getHealth()

    expect(health.paymentReconcile).toEqual({
      status: 'ok',
      lastRunAt: at.toISOString(),
      resolvedCount: 1,
    })
  })

  it('goes degraded once the batch has been silent for too long', async () => {
    await reconciler().reconcile()

    clock.advance(RECONCILE_STALE_AFTER_MS + 1)

    const health = await api.client.getHealth()

    // 결과를 모르는 결제를 아무도 풀어 주지 않는 상태다. 요청은 하나도 실패하지
    // 않으므로 이 필드 말고는 그것을 말하는 자리가 없다.
    expect(health.paymentReconcile.status).toBe('degraded')
    expect(health.status).toBe('degraded')
  })
})
