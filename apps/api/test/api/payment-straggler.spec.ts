import type { ApiClient, Payment } from '@shopping/shared'
import { cartResponseSchema, checkoutResponseSchema, orderResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { OrderService } from '../../src/orders/order.service.js'
import {
  STRAGGLER_ABANDONED_AFTER_MS,
  STRAGGLER_CANCEL_REASON,
  STRAGGLER_COMPLETE_GRACE_MS,
  STRAGGLER_LOCK_KEY,
  STRAGGLER_STALE_AFTER_MS,
} from '../../src/payment/payment-straggler.js'
import { PaymentStragglerService } from '../../src/payment/payment-straggler.service.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import type { TossClient, TossConfirmRequest, TossPayment } from '../../src/payment/toss.client.js'
import { TOSS_CLIENT } from '../../src/payment/toss.client.js'
import type { IssuedCard } from '../../src/payment/virtual-card.service.js'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { RESERVATION_TTL_MS } from '../../src/reservation/reservation-rules.js'
import { ReservationSweeperService } from '../../src/reservation/reservation-sweeper.service.js'
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
 * 낙오된 결제를 끝내는 배치 (TASK-0057 F2 · F6 · F7 · D-221), 이 워커의 실제
 * 데이터베이스에 대해.
 *
 * **찾는 것이 둘이고 방향이 반대다.** 그 대비가 이 파일이 재는 전부다.
 *
 * | | 무엇이 남았나 | 배치가 하는 일 | 결제사 |
 * | --- | --- | --- | --- |
 * | **앞으로** | 매입은 끝났는데 주문이 `PAYMENT_PENDING` | 주문을 마저 끝낸다 | **한 마디도 안 듣는다** |
 * | **뒤로** | 매입 없이 남은 `AUTHORIZED` | 승인을 취소한다 | `cancel` 을 전액으로 듣는다 |
 *
 * 앞쪽을 되감으면 **사고를 두 번째로 만드는 일**이다 — 돈은 이미 우리 쪽으로 왔고
 * 사람은 물건을 기다린다 (4.2). 그래서 이 파일의 단언은 상태 하나로 끝나지 않는다.
 * 「결제가 `CANCELED` 가 됐다」는 정상 결제까지 취소해 버린 배치도 통과하고,
 * 「주문이 `PAID` 가 됐다」는 돈을 받지도 않고 물건을 보낸 배치도 통과한다. 매번
 * **사슬 전체** — 결제 · 주문 · 예약 · 실물 재고 · 카드 한도 — 를 함께 본다.
 *
 * **가상 카드는 진짜다** (QUALITY-GATES 6장). 우리 도메인이고 외부가 아니다 —
 * 그리고 F2 가 재려는 것이 정확히 「한도가 실제로 돌아왔는가」라서, 원장을 읽지
 * 않으면 그 단언을 할 자리가 없다. **토스의 HTTP 만 가짜다**: `TOSS_CLIENT` 가
 * 토스와 말하는 유일한 자리라 그 포트를 대역으로 바꾸면 나머지 — 배치, 서비스,
 * 프로바이더, 데이터베이스 — 는 전부 배포되는 그것이다.
 *
 * 시각은 전부 **주입된 시계**다. 이 배치의 두 임계치는 15분과 1분이라 벽시계로는
 * 아예 잴 수 없고, 잴 수 있다 해도 그것은 빨강과 초록을 오가는 실패가 아니라
 * **조용히 틀린 초록**이 된다.
 */

const db = useDatabase()
const clock = fixedClock(DEFAULT_TEST_INSTANT)

/**
 * 결제창이 돌려주는 키. **매번 다르다.**
 *
 * `Payment.paymentKey` 가 유니크라서고(웹훅의 멱등, TASK-0056), 실제로도 결제창은
 * 시도마다 새 키를 준다. 고정값을 쓰면 이 파일에서 두 번째 토스 결제가 제약 위반으로
 * 끝나는데, 그 실패는 배치와 아무 상관이 없다.
 */
let widgetKeys = 0

function nextWidgetKey(): string {
  widgetKeys += 1

  return `toss-widget-key-${String(widgetKeys)}`
}

/** 토스에 나간 한 마디. */
interface TossCall {
  readonly method: 'confirm' | 'cancel' | 'get' | 'getByOrderId'
  readonly paymentKey: string | null
  readonly amount: number | null
  readonly reason: string | null
}

/**
 * 검사가 대본을 쥔 토스.
 *
 * 모킹이 아니라 **포트의 또 하나의 구현**이다. 나간 호출을 금액과 사유까지 적어
 * 두는 이유는 이 파일이 재야 하는 것 둘이 거기서만 보이기 때문이다 — **전액으로
 * 불렸는가**(F2), 그리고 **아예 안 불렸는가**(정상 결제). 뒤쪽은 상태만 보면
 * 「물어보고 나서 아무것도 안 한」 구현도 통과한다.
 */
class FakeToss implements TossClient {
  readonly calls: TossCall[] = []
  /** 이 결제키의 취소가 실패한다. 한 건의 예외를 만드는 유일한 길이다. */
  cancelFailureFor: string | null = null

  reset(): void {
    this.calls.length = 0
    this.cancelFailureFor = null
  }

  /** 지금까지 들은 것을 잊는다. 준비가 만든 호출과 배치가 만든 호출을 가른다. */
  forgetCalls(): void {
    this.calls.length = 0
  }

  callsTo(method: TossCall['method']): readonly TossCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  confirm(request: TossConfirmRequest): Promise<TossPayment> {
    this.calls.push({
      method: 'confirm',
      paymentKey: request.paymentKey,
      amount: request.amount,
      reason: null,
    })

    return Promise.resolve({
      paymentKey: request.paymentKey,
      status: 'DONE',
      totalAmount: request.amount,
    })
  }

  cancel(paymentKey: string, reason: string, amount?: number): Promise<TossPayment> {
    this.calls.push({ method: 'cancel', paymentKey, amount: amount ?? null, reason })

    if (this.cancelFailureFor === paymentKey) {
      return Promise.reject(new Error('토스 취소가 실패했습니다'))
    }

    return Promise.resolve({ paymentKey, status: 'CANCELED', totalAmount: amount ?? 0 })
  }

  get(paymentKey: string): Promise<TossPayment> {
    this.calls.push({ method: 'get', paymentKey, amount: null, reason: null })

    return Promise.resolve({ paymentKey, status: 'DONE', totalAmount: 0 })
  }

  getByOrderId(orderId: string): Promise<TossPayment | null> {
    this.calls.push({ method: 'getByOrderId', paymentKey: orderId, amount: null, reason: null })

    return Promise.resolve(null)
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
let principal: RequestPrincipal
let addressId: string
let categoryId: number

function straggler(): PaymentStragglerService {
  return api.resolve<PaymentStragglerService>(PaymentStragglerService)
}

function sweeper(): ReservationSweeperService {
  return api.resolve<ReservationSweeperService>(ReservationSweeperService)
}

function payments(): PaymentService {
  return api.resolve<PaymentService>(PaymentService)
}

function orders(): OrderService {
  return api.resolve<OrderService>(OrderService)
}

function cards(): VirtualCardService {
  return api.resolve<VirtualCardService>(VirtualCardService)
}

function client(): ApiClient {
  return api.clientAs(buyer)
}

beforeEach(async () => {
  // 시계는 매 테스트 같은 자리에서 시작한다. 앞 테스트가 옮겨 둔 시각을 물려받으면
  // 「아직 임계치를 안 지났다」가 실행 순서에 따라 달라진다.
  clock.set(DEFAULT_TEST_INSTANT)
  toss.reset()

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  principal = { app: 'shop', userId: account.id, roles: ['BUYER'], sellerId: null }
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

/** 한도 `creditLimit` 짜리 카드 한 장. 이 구매자의 것이다. */
function issueCard(creditLimit: number): Promise<IssuedCard> {
  return cards().issueFor(buyer.userId, creditLimit)
}

/** 승인까지 간 결제 하나. 결제키가 곧 저쪽이 이 승인을 부르는 이름이다. */
interface Authorized {
  readonly paymentId: string
  readonly paymentKey: string
}

/**
 * 가상 카드로 승인까지. 매입은 하지 않는다.
 *
 * 결제키가 결제 id 와 같은 값인 것은 가상 카드의 사정이다 — 우리가 곧 저쪽이라
 * 원장의 참조가 그 값이고, F2 가 한도의 회수를 세는 열쇠도 그것이다.
 */
async function authorizeWithCard(placed: PlacedOrder, cardId: string): Promise<Authorized> {
  const started = await payments().start(principal, placed.orderId, 'VIRTUAL_CARD', {
    methodRef: cardId,
  })
  const { payment } = await payments().authorize(principal, started.payment.id)

  expect(payment).toMatchObject({ status: 'AUTHORIZED', paymentKey: payment.id })

  return { paymentId: payment.id, paymentKey: payment.id }
}

/** 토스로 승인까지. 결제창을 지난 뒤 서버 승인이고, 매입은 아직이다. */
async function authorizeWithToss(placed: PlacedOrder): Promise<Authorized> {
  const started = await payments().start(principal, placed.orderId, 'TOSS')
  const paymentKey = nextWidgetKey()
  const { payment } = await payments().confirmToss(
    principal,
    started.payment.id,
    paymentKey,
    placed.paidAmount,
  )

  expect(payment.status).toBe('AUTHORIZED')

  return { paymentId: payment.id, paymentKey }
}

function readPayment(paymentId: string): Promise<Payment> {
  return payments()
    .get(principal, paymentId)
    .then((response) => response.payment)
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

interface CardEntry {
  readonly kind: string
  readonly amount: number
  readonly balanceAfter: number
  readonly refId: string
}

/** 이 카드의 원장 전부. **한도가 실제로 돌아왔는지는 여기서만 보인다.** */
function cardLedgerOf(cardId: string): Promise<CardEntry[]> {
  return db.query<CardEntry>(
    `SELECT "kind"::text AS "kind", "amount", "balanceAfter", "refId"
       FROM "VirtualCardTransaction" WHERE "cardId" = $1 ORDER BY "createdAt", "id"`,
    [cardId],
  )
}

function cardUsage(cardId: string): Promise<{ usedAmount: number }> {
  return db.one(`SELECT "usedAmount" FROM "VirtualCard" WHERE "id" = $1`, [cardId])
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

/** 아무것도 만나지 않은 주기. 단언을 이 값에서 시작하면 빠뜨린 칸이 없다. */
const NOTHING = {
  completed: 0,
  canceled: 0,
  overtaken: 0,
  failed: 0,
  skipped: false,
} as const

interface StrandedCase extends PlacedOrder {
  readonly paymentId: string
  readonly cardId: string
}

/**
 * **앞으로** 쪽 상태 하나 — 매입은 끝났는데 주문이 완료되지 않았다.
 *
 * 손으로 만든 행이 아니다. 정상적인 결제 흐름을 그대로 태우고 **매입 직후 주문
 * 완료가 시작되려는 순간에 실패를 주입한다** — `settle` 은 결제를 `PAID` 로
 * 커밋한 **뒤에** `markPaid` 를 부르므로, 그 사이에 프로세스가 죽으면 정확히 이
 * 모양이 남는다 (4.2). 제약을 비틀어 만드는 길도 있지만 그러면 재는 것이 스키마가
 * 되고, 여기서 재야 할 것은 「그 사이에 죽었을 때 배치가 무엇을 하는가」다
 * (`demo-cleanup.integration.spec.ts` 가 같은 이유로 같은 장치를 쓴다).
 */
async function stranded(cardId?: string): Promise<StrandedCase> {
  const placed = await place()
  const card = cardId ?? (await issueCard(placed.paidAmount * 4)).id
  const { paymentId } = await authorizeWithCard(placed, card)
  const death = vi
    .spyOn(orders(), 'markPaid')
    .mockRejectedValueOnce(new Error('매입 직후에 프로세스가 죽었다'))

  await expect(payments().capture(principal, paymentId)).rejects.toThrow('프로세스가 죽었다')

  death.mockRestore()

  // 매입은 끝났고 주문은 안 끝났다. 이 두 줄이 이 함수가 만든 상태의 정의다.
  expect((await readPayment(paymentId)).status).toBe('PAID')
  expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])

  return { ...placed, paymentId, cardId: card }
}

interface AbandonedCase extends PlacedOrder, Authorized {
  /** 가상 카드로 냈다면 그 카드. 토스면 `null` 이다. */
  readonly cardId: string | null
}

/**
 * **뒤로** 쪽 상태 하나 — 매입 없이 남은 승인.
 *
 * 승인만 받고 사라진다. 예약은 TTL 15분이 지나 **실제 스위퍼가** 풀어 주고, 재고는
 * 그 순간 남에게 갈 수 있게 된다 — 그런데 카드에는 돈이 잡혀 있다 (D-221).
 *
 * 예약을 SQL 로 직접 옮기지 않는 것이 중요하다. 배치가 보는 「살아 있는 예약이
 * 없다」는 **스위퍼가 쓴 사실**이고, 그 두 잡이 실제로 이어지는지까지가 이
 * 시나리오다.
 */
async function abandoned(
  provider: 'VIRTUAL_CARD' | 'TOSS' = 'VIRTUAL_CARD',
  cardId?: string,
): Promise<AbandonedCase> {
  const placed = await place()
  const card = provider === 'TOSS' ? null : (cardId ?? (await issueCard(placed.paidAmount * 4)).id)
  const authorized =
    card === null ? await authorizeWithToss(placed) : await authorizeWithCard(placed, card)

  clock.advance(RESERVATION_TTL_MS + 1)
  await sweeper().sweep()

  expect(await reservationStatuses(placed.checkoutId)).toEqual(['RELEASED'])

  return { ...placed, ...authorized, cardId: card }
}

/** 앞쪽 유예를 지나게 한다. 이 한 줄이 있어야 배치가 그 결제를 쳐다본다. */
function passCompleteGrace(): void {
  clock.advance(STRAGGLER_COMPLETE_GRACE_MS + 1)
}

/** 뒤쪽 임계치를 지나게 한다. */
function passAbandonThreshold(): void {
  clock.advance(STRAGGLER_ABANDONED_AFTER_MS + 1)
}

describe('뒤로 — 매입 없이 남은 승인을 되감는다 (F2)', () => {
  it('cancels the authorization for the full amount and gives the card limit back', async () => {
    const held = await abandoned()
    const cardId = held.cardId ?? ''

    // 승인 시점에 한도가 빠져 있다. 되돌아오는지를 재려면 그 전을 알아야 한다.
    expect(await cardUsage(cardId)).toEqual({ usedAmount: held.paidAmount })

    passAbandonThreshold()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, canceled: 1 })

    const payment = await readPayment(held.paymentId)

    // 승인액은 그대로 두고 취소 누계를 채운다 — 「얼마가 잡혔다가 풀렸나」가
    // 나중에도 세어져야 한다.
    expect(payment).toMatchObject({
      status: 'CANCELED',
      authorizedAmount: held.paidAmount,
      canceledAmount: held.paidAmount,
    })

    // **한도가 실제로 돌아왔다.** 상태만 보는 검사는 저쪽에 아무 말도 안 한
    // 배치까지 통과시키고, 그때 그 사람의 한도는 영영 물려 있다.
    expect(await cardLedgerOf(cardId)).toEqual([
      {
        kind: 'CHARGE',
        amount: held.paidAmount,
        balanceAfter: held.paidAmount,
        refId: held.paymentId,
      },
      // **전액이다.** 매입한 적이 없으니 나눌 것이 없다 (D-221).
      { kind: 'CANCEL', amount: -held.paidAmount, balanceAfter: 0, refId: held.paymentId },
    ])
    expect(await cardUsage(cardId)).toEqual({ usedAmount: 0 })

    // **주문은 완료되지 않은 채다.** 되감기가 앞으로 가 버리면 돈은 돌려주고
    // 물건은 보내는 모양이 된다.
    expect(await sellerOrderStatuses(held.orderId)).not.toContain('PAID')
    expect(await levelsOf(held.variantId)).toEqual({ stock: 10, reserved: 0 })

    const events = await eventsOf(held.paymentId)

    expect(events.map((event) => event.kind)).toEqual(['REQUESTED', 'AUTHORIZED', 'CANCELED'])
    expect(events[2]).toMatchObject({
      fromStatus: 'AUTHORIZED',
      toStatus: 'CANCELED',
      // 배치가 취소한 건과 사람이 취소한 건은 나중에 구분할 수 있어야 한다.
      reason: STRAGGLER_CANCEL_REASON,
    })
  })

  it('waits out the threshold even after the reservation is gone', async () => {
    // `abandoned` 는 예약 TTL 만큼만 시계를 옮긴다. 예약은 이미 풀렸지만 승인은
    // 아직 임계치보다 젊고, **두 조건은 AND** 라 이것만으로는 건드리지 않는다.
    const held = await abandoned('TOSS')

    toss.forgetCalls()

    expect(await straggler().sweep()).toEqual(NOTHING)
    expect(toss.calls).toEqual([])
    expect((await readPayment(held.paymentId)).status).toBe('AUTHORIZED')

    // 임계치가 지나면 그때 되감는다. 미룬 것은 잊는 것이 아니다.
    passAbandonThreshold()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, canceled: 1 })
    expect((await readPayment(held.paymentId)).status).toBe('CANCELED')
  })

  it('asks the provider to cancel, not to refund, and for the whole authorized amount', async () => {
    const held = await abandoned('TOSS')

    toss.forgetCalls()
    passAbandonThreshold()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, canceled: 1 })

    // 매입 전 취소는 환불과 **다른 API** 이고 부분이 없다 (D-221). 금액을 빼먹고
    // 부르면 토스에서는 전액 취소가 되지만, 그때 우리 장부가 얼마를 풀었는지를
    // 아무도 못 센다.
    expect(toss.calls).toEqual([
      {
        method: 'cancel',
        paymentKey: held.paymentKey,
        amount: held.paidAmount,
        reason: STRAGGLER_CANCEL_REASON,
      },
    ])
    expect((await readPayment(held.paymentId)).status).toBe('CANCELED')
  })
})

describe('앞으로 — 매입이 끝난 주문을 마저 끝낸다 (F6)', () => {
  it('finishes the order without touching the payment or the provider', async () => {
    const held = await stranded()

    toss.forgetCalls()
    passCompleteGrace()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, completed: 1 })

    // 사슬 전체가 참이 된다 — 주문이 `PAID`, 예약이 확정, **재고가 실제로 줄었다.**
    // 한 칸씩 따로 보는 검사는 그 사슬이 끊긴 날에도 전부 초록이다.
    expect(await sellerOrderStatuses(held.orderId)).toEqual(['PAID'])
    expect(await reservationStatuses(held.checkoutId)).toEqual(['CONFIRMED'])
    expect(await levelsOf(held.variantId)).toEqual({ stock: 8, reserved: 0 })

    // **결제는 그대로 `PAID` 다.** 돈은 이미 우리 쪽으로 왔고 사람은 물건을
    // 기다린다 — 그것을 취소하는 것은 사고를 두 번째로 만드는 일이다 (4.2).
    expect((await readPayment(held.paymentId)).status).toBe('PAID')
    expect(await cardUsage(held.cardId)).toEqual({ usedAmount: held.paidAmount })
    expect((await cardLedgerOf(held.cardId)).map((entry) => entry.kind)).toEqual(['CHARGE'])

    // **프로바이더는 한 마디도 듣지 않았다.** 이 방향은 우리 데이터베이스 안에서
    // 끝나는 일이고, 저쪽에 말을 거는 순간 그것은 이미 다른 보상이다.
    expect(toss.calls).toEqual([])
  })

  it('does not race the markPaid a live process would still be running', async () => {
    // **정상 결제도 이 창을 지난다.** `settle` 은 매입을 `PAID` 로 커밋한 뒤에
    // 주문을 완료시키므로, 그 사이의 한순간은 모든 결제가 이 모양이다. 유예 없이
    // 집으면 배치가 그 `markPaid` 와 겹쳐 같은 예약을 두 곳에서 확정하려 든다.
    const held = await stranded()

    // 시계를 옮기지 않는다 — 방금 매입된 건이다.
    expect(await straggler().sweep()).toEqual(NOTHING)
    expect(await sellerOrderStatuses(held.orderId)).toEqual(['PAYMENT_PENDING'])

    // 유예가 지나면 그때 끝낸다. 미룬 것은 잊는 것이 아니다.
    passCompleteGrace()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, completed: 1 })
    expect(await sellerOrderStatuses(held.orderId)).toEqual(['PAID'])
  })

  it('is idempotent, so a second cycle finds nothing left to do', async () => {
    const held = await stranded()

    passCompleteGrace()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, completed: 1 })
    // 두 번째 주기가 같은 주문을 다시 집으면 예약을 두 번 확정하려 들고, 그것은
    // 없는 재고를 파는 일이다. 집지 않는 이유는 주문이 이미 `PAID` 라서다.
    expect(await straggler().sweep()).toEqual(NOTHING)
    expect(await levelsOf(held.variantId)).toEqual({ stock: 8, reserved: 0 })
  })
})

describe('정상 결제는 건드리지 않는다 (R1)', () => {
  it('leaves an authorization that was only just approved alone', async () => {
    const placed = await place()
    const card = await issueCard(placed.paidAmount * 4)
    const { paymentId } = await authorizeWithCard(placed, card.id)

    toss.forgetCalls()

    // 시계를 옮기지 않는다 — 정상 결제는 승인에서 매입까지 몇 초다.
    expect(await straggler().sweep()).toEqual(NOTHING)

    expect((await readPayment(paymentId)).status).toBe('AUTHORIZED')
    expect(await cardUsage(card.id)).toEqual({ usedAmount: placed.paidAmount })
    expect((await cardLedgerOf(card.id)).map((entry) => entry.kind)).toEqual(['CHARGE'])
    expect(toss.calls).toEqual([])
  })

  it('leaves an old authorization alone while its reservation is still held', async () => {
    const placed = await place()
    const { paymentId } = await authorizeWithToss(placed)

    // **스위퍼를 돌리지 않는다.** 시간은 넘겼지만 예약 표는 아직 `HELD` 라고
    // 말하고, 그것이 곧 「아직 이 결제로 살 수 있다」는 뜻이다. 두 조건 중
    // 시간만 보는 배치는 이 자리에서 산 사람의 결제를 취소한다 (R1).
    toss.forgetCalls()
    passAbandonThreshold()

    expect(await reservationStatuses(placed.checkoutId)).toEqual(['HELD'])
    expect(await straggler().sweep()).toEqual(NOTHING)

    // **대역이 한 마디도 듣지 않았다.** 「상태가 그대로다」만 보면 취소를 보내
    // 놓고 실패한 구현도 통과하는데, 그쪽은 이미 저쪽의 돈을 풀어 버린 뒤다.
    expect(toss.calls).toEqual([])
    expect((await readPayment(paymentId)).status).toBe('AUTHORIZED')
    expect(await reservationStatuses(placed.checkoutId)).toEqual(['HELD'])
  })

  it('leaves a payment whose order is already finished alone', async () => {
    const placed = await place()
    const card = await issueCard(placed.paidAmount * 4)
    const { paymentId } = await authorizeWithCard(placed, card.id)

    await payments().capture(principal, paymentId)

    toss.forgetCalls()
    passAbandonThreshold()

    // 앞쪽 조건은 「주문이 아직 `PAYMENT_PENDING` 이다」이고 이 주문은 `PAID` 다.
    expect(await straggler().sweep()).toEqual(NOTHING)
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 8, reserved: 0 })
    expect(toss.calls).toEqual([])
  })
})

describe('사람이 먼저 돌아왔다', () => {
  it('does nothing when the capture lands between picking the payment and cancelling it', async () => {
    const held = await abandoned('TOSS')

    toss.forgetCalls()
    passAbandonThreshold()

    // **겹침을 주선한다.** 배치가 이 건을 고른 **뒤** 승인 취소가 결제 행을
    // 잠그기 **전에** 사람이 돌아와 매입을 마친 순간이고, 다른 방법으로는 그
    // 순간을 고를 수 없다. 진짜 `cancelAuthorization` 은 그 뒤에 그대로 돈다 —
    // 이 검사가 재려는 것이 **그것이 아무것도 하지 않는다**이기 때문이다.
    const racing = vi
      .spyOn(payments(), 'cancelAuthorization')
      .mockImplementationOnce(async (paymentId: string, reason: string) => {
        // 사람이 돌아와 매입을 마쳤다.
        await payments().settle(paymentId)
        // 그리고 **진짜** 승인 취소가 그 위에서 돈다. 대역을 먼저 걷어내므로
        // 이 아래는 배포되는 그 코드이고, 그것이 이 검사의 대상이다.
        racing.mockRestore()
        await payments().cancelAuthorization(paymentId, reason)
      })

    const result = await straggler().sweep()

    racing.mockRestore()

    // 취소한 것이 아니라 **추월당한** 것이다. 둘을 같은 칸에 세면 「배치가 몇
    // 건을 놓아줬나」라는 숫자에 사람이 한 일이 섞여 들어온다.
    expect(result).toEqual({ ...NOTHING, overtaken: 1 })
    expect((await readPayment(held.paymentId)).status).toBe('PAID')

    // 저쪽에 취소가 나가지 않았다 — 나갔다면 매입된 돈을 우리가 물러 버린 것이다.
    expect(toss.callsTo('cancel')).toEqual([])

    const events = await eventsOf(held.paymentId)

    expect(events.map((event) => event.kind)).toEqual(['REQUESTED', 'AUTHORIZED', 'CAPTURED'])
  })
})

describe('실패 격리', () => {
  it('keeps going after one payment throws, and leaves that one for the next cycle', async () => {
    const broken = await abandoned('TOSS')

    // 두 건의 순서를 못 박는다. 목록은 오래된 것부터라 **던지는 쪽이 먼저**이고,
    // 그래야 「한 건이 나머지를 막는가」를 실제로 재게 된다.
    clock.advance(1_000)

    const healthy = await abandoned('TOSS')

    // 저쪽이 이 한 건의 취소를 거절한다. 원인이 무엇이든 지금 이 건은 풀 수
    // 없고, 중요한 것은 **나머지가 계속 도는가**다.
    toss.cancelFailureFor = broken.paymentKey
    toss.forgetCalls()
    passAbandonThreshold()

    const result = await straggler().sweep()

    // 하나가 던졌고 하나는 끝까지 갔다. 배치가 첫 예외에서 멈춘다면 이 결제는
    // **영원히** 뒤에 있게 된다 — 목록이 오래된 것부터라 다음 주기에도 같은
    // 자리에서 같은 예외가 난다.
    expect(result).toEqual({ ...NOTHING, canceled: 1, failed: 1 })
    expect(toss.callsTo('cancel')).toHaveLength(2)

    expect((await readPayment(broken.paymentId)).status).toBe('AUTHORIZED')
    expect((await readPayment(healthy.paymentId)).status).toBe('CANCELED')

    // 던진 한 건은 「고친 건수」에 들어가지 않는다. 그래야 계속 던지는 결제가
    // 「밀린 것이 안 줄어든다」로 드러난다.
    expect(await straggler().lastFixed()).toBe(1)
  })
})

describe('중복 방지', () => {
  it('skips its turn while another instance holds the lock', async () => {
    const held = await abandoned('TOSS')

    toss.forgetCalls()
    passAbandonThreshold()

    // **겹침을 주선한다.** 두 배치를 동시에 던져서 재면 둘이 실제로는 앞뒤로
    // 돌았을 때에도 초록이 된다. 다른 인스턴스인 척 같은 열쇠를 붙잡고 있는
    // **동안에만** 배치를 부르면, 겹침은 희망이 아니라 배치가 된다.
    const skipped = await db.withConnection(async (connection) => {
      await connection.query('BEGIN')
      await connection.query('SELECT pg_advisory_xact_lock($1::bigint)', [STRAGGLER_LOCK_KEY])

      const result = await straggler().sweep()

      await connection.query('ROLLBACK')
      return result
    })

    expect(skipped).toEqual({ ...NOTHING, skipped: true })
    // 고르지도 못했으니 저쪽에 한 마디도 나가지 않는다 — 이 락이 사는 값이다.
    expect(toss.calls).toEqual([])
    expect((await readPayment(held.paymentId)).status).toBe('AUTHORIZED')

    // **건너뛴 실행은 「돌았다」로 적지 않는다.** 적으면 한 인스턴스도 일하지
    // 못하는 상태에서 헬스체크가 계속 초록을 답한다.
    expect(await straggler().lastRunAt()).toBeNull()

    // 락이 풀리면 다음 주기가 가져간다.
    expect(await straggler().sweep()).toEqual({ ...NOTHING, canceled: 1 })
  })
})

describe('돌았다는 기록과 헬스체크', () => {
  it('answers null and zero before it has ever run', async () => {
    // 「아직 안 돌았다」와 「멈췄다」를 밖에서 구분할 방법은 없다. 여기서 0시각을
    // 지어내면 헬스체크는 부팅 직후를 영원히 건강하다고 답한다.
    expect(await straggler().lastRunAt()).toBeNull()
    expect(await straggler().lastFixed()).toBe(0)

    const health = await api.client.getHealth()

    expect(health.paymentStraggler).toEqual({
      status: 'degraded',
      lastRunAt: null,
      fixedCount: 0,
    })
  })

  it('publishes when it last ran and how many it finished', async () => {
    const held = await abandoned()

    passAbandonThreshold()

    const at = clock.now()

    expect(await straggler().sweep()).toEqual({ ...NOTHING, canceled: 1 })
    expect((await straggler().lastRunAt())?.toISOString()).toBe(at.toISOString())
    expect(await straggler().lastFixed()).toBe(1)

    const health = await api.client.getHealth()

    expect(health.paymentStraggler).toEqual({
      status: 'ok',
      lastRunAt: at.toISOString(),
      fixedCount: 1,
    })
    expect((await readPayment(held.paymentId)).status).toBe('CANCELED')
  })

  it('goes degraded once the batch has been silent for too long', async () => {
    await straggler().sweep()

    clock.advance(STRAGGLER_STALE_AFTER_MS + 1)

    const health = await api.client.getHealth()

    // 돈을 낸 사람의 주문이 멈춰 있고 남의 카드 한도가 물려 있을지 모르는
    // 상태다. 요청은 하나도 실패하지 않으므로 이 필드 말고는 그것을 말하는
    // 자리가 없다.
    expect(health.paymentStraggler.status).toBe('degraded')
    expect(health.status).toBe('degraded')
  })
})

/**
 * 「불일치」의 정의 (F7).
 *
 * 다섯 가지이고 **전부 조용하다** — 어느 것도 요청을 실패시키지 않는다. 한 칸씩
 * 따로 보는 검사가 전부 초록인 것이 이 배치가 다루는 상태들의 성질이라, 마지막에
 * 한 번은 사슬 전체를 SQL 로 세는 자리가 필요하다.
 *
 * | # | 무엇이 어긋났나 | 사람에게는 어떻게 보이나 |
 * | --- | --- | --- |
 * | ① | `PAID` 결제를 가진 주문에 `PAYMENT_PENDING` 인 판매자 몫이 있다 | 돈은 냈는데 물건이 안 온다 |
 * | ② | `CANCELED` 인 가상 카드 결제의 원장 합계가 0 이 아니다 | 취소됐는데 한도가 안 돌아왔다 |
 * | ③ | `ProductVariant.reserved` 가 `HELD` 예약의 합과 다르다 | 아무도 못 사는 재고가 잠겨 있다 |
 * | ④ | `PAID` 인 판매자 몫의 주문에 `PAID` 결제가 없다 | 받지도 않은 돈으로 물건이 나간다 |
 * | ⑤ | `ProductVariant.stock` 이 재고 원장의 마지막 잔액과 다르다 | 재고가 왜 그 값인지 아무도 설명 못 한다 |
 *
 * ②가 `VIRTUAL_CARD` 로 좁혀지는 것은 원장이 우리 것일 때만 셀 수 있기 때문이다 —
 * 토스의 장부는 저쪽에 있고, 그쪽 대사는 이 배치의 일이 아니다.
 */
const MISMATCH_SQL = `
  WITH "paidWithoutOrder" AS (
    SELECT so."id" FROM "SellerOrder" so
     WHERE so."status" = 'PAYMENT_PENDING'
       AND EXISTS (
             SELECT 1 FROM "Payment" p
              WHERE p."orderId" = so."orderId" AND p."status" = 'PAID'
           )
  ), "stuckCardLimit" AS (
    SELECT p."id" FROM "Payment" p
     WHERE p."status" = 'CANCELED'
       AND p."provider" = 'VIRTUAL_CARD'
       AND p."paymentKey" IS NOT NULL
       AND (
             SELECT COALESCE(SUM(t."amount"), 0)
               FROM "VirtualCardTransaction" t
              WHERE t."refId" = p."paymentKey"
           ) <> 0
  ), "reservedDrift" AS (
    SELECT v."id" FROM "ProductVariant" v
     WHERE v."reserved" <> COALESCE(
             (SELECT SUM(r."quantity") FROM "StockReservation" r
               WHERE r."variantId" = v."id" AND r."status" = 'HELD'),
             0
           )
  ), "unpaidButSold" AS (
    SELECT so."id" FROM "SellerOrder" so
     WHERE so."status" = 'PAID'
       AND NOT EXISTS (
             SELECT 1 FROM "Payment" p
              WHERE p."orderId" = so."orderId" AND p."status" = 'PAID'
           )
  ), "ledgerDrift" AS (
    SELECT v."id" FROM "ProductVariant" v
     WHERE EXISTS (SELECT 1 FROM "StockLedger" l WHERE l."variantId" = v."id")
       AND v."stock" <> (
             SELECT l."balanceAfter" FROM "StockLedger" l
              WHERE l."variantId" = v."id" ORDER BY l."seq" DESC LIMIT 1
           )
  )
  SELECT (SELECT COUNT(*) FROM "paidWithoutOrder")::int AS "paidWithoutOrder",
         (SELECT COUNT(*) FROM "stuckCardLimit")::int   AS "stuckCardLimit",
         (SELECT COUNT(*) FROM "reservedDrift")::int    AS "reservedDrift",
         (SELECT COUNT(*) FROM "unpaidButSold")::int    AS "unpaidButSold",
         (SELECT COUNT(*) FROM "ledgerDrift")::int      AS "ledgerDrift"
`

interface Mismatches {
  readonly paidWithoutOrder: number
  readonly stuckCardLimit: number
  readonly reservedDrift: number
  readonly unpaidButSold: number
  readonly ledgerDrift: number
}

const NO_MISMATCH: Mismatches = {
  paidWithoutOrder: 0,
  stuckCardLimit: 0,
  reservedDrift: 0,
  unpaidButSold: 0,
  ledgerDrift: 0,
}

function mismatches(): Promise<Mismatches> {
  return db.one<Mismatches>(MISMATCH_SQL)
}

/** 아무 사고 없이 끝난 주문 하나. 대조군이자 「어긋뜨리기」의 재료다. */
async function paidOrder(cardId?: string): Promise<StrandedCase> {
  const placed = await place()
  const card = cardId ?? (await issueCard(placed.paidAmount * 4)).id
  const { paymentId } = await authorizeWithCard(placed, card)

  await payments().capture(principal, paymentId)

  return { ...placed, paymentId, cardId: card }
}

describe('상태 일관성 (F7)', () => {
  it('finds no mismatch after the failure scenarios have been mixed and swept', async () => {
    // 한 바퀴가 네 가지를 섞는다: 정상 · 거절 · 앞으로 낙오 · 뒤로 낙오. 세 바퀴를
    // 돌리는 이유는 **상태가 서로를 밟는지**를 보기 위해서다 — 한 번씩만 만들면
    // 각 시나리오가 자기 데이터 위에서만 도는 검사가 된다.
    // 카드는 사람당 세 장까지다(`VIRTUAL_CARDS_PER_USER`). 한 장을 넉넉한
    // 한도로 두고 계속 쓰는 것이 실제 사람의 모양이기도 하다 — 한 장으로 여러 번
    // 사고, 그중 몇 번이 낙오된다.
    const wallet = (await issueCard(5_000_000)).id
    // 무엇을 사도 모자란 카드. 「거절」 시나리오의 재료다.
    const empty = (await issueCard(1_000)).id

    for (let round = 0; round < 3; round += 1) {
      await paidOrder(wallet)

      // 거절 — 예약은 유지되고 결제만 실패로 끝난다 (4.2).
      const refused = await place()
      const started = await payments().start(principal, refused.orderId, 'VIRTUAL_CARD', {
        methodRef: empty,
      })

      expect((await payments().authorize(principal, started.payment.id)).payment.status).toBe(
        'FAILED',
      )

      // 앞으로 — 매입 직후에 죽었다. 유예를 지나면 배치가 마저 끝낸다.
      await stranded(wallet)
      passCompleteGrace()
      await straggler().sweep()

      // 뒤로 — 승인만 하고 사라졌다. 예약이 풀린 뒤 배치가 되감는다.
      await abandoned('VIRTUAL_CARD', wallet)
      passAbandonThreshold()
      await straggler().sweep()
    }

    // 마지막으로 한 바퀴 더. 남은 것이 있으면 여기서 사라져야 한다.
    passAbandonThreshold()
    await straggler().sweep()

    expect(await mismatches()).toEqual(NO_MISMATCH)
  }, 60_000)

  it('the count is not zero by accident — each definition catches its own fault', async () => {
    const paid = await paidOrder()

    expect(await mismatches()).toEqual(NO_MISMATCH)

    // ① 돈은 받았는데 물건이 안 움직인다.
    await db.execute(`UPDATE "SellerOrder" SET "status" = 'PAYMENT_PENDING' WHERE "orderId" = $1`, [
      paid.orderId,
    ])
    expect(await mismatches()).toMatchObject({ paidWithoutOrder: 1 })
    await db.execute(`UPDATE "SellerOrder" SET "status" = 'PAID' WHERE "orderId" = $1`, [
      paid.orderId,
    ])

    // ③ 아무도 못 사는 재고가 잠겼다.
    await db.execute(`UPDATE "ProductVariant" SET "reserved" = "reserved" + 1 WHERE "id" = $1`, [
      paid.variantId,
    ])
    expect(await mismatches()).toMatchObject({ reservedDrift: 1 })
    await db.execute(`UPDATE "ProductVariant" SET "reserved" = "reserved" - 1 WHERE "id" = $1`, [
      paid.variantId,
    ])

    // ⑤ 재고가 원장으로 설명되지 않는다.
    await db.execute(`UPDATE "ProductVariant" SET "stock" = "stock" + 1 WHERE "id" = $1`, [
      paid.variantId,
    ])
    expect(await mismatches()).toMatchObject({ ledgerDrift: 1 })
    await db.execute(`UPDATE "ProductVariant" SET "stock" = "stock" - 1 WHERE "id" = $1`, [
      paid.variantId,
    ])

    // ② 취소했는데 한도가 안 돌아왔다. 배치가 되감은 뒤에는 0 이고, 원장의
    // 되돌림 한 줄을 지우면 1 이 된다 — 즉 이 숫자는 **실제로 그 줄을 보고 있다.**
    const canceled = await abandoned()

    passAbandonThreshold()
    await straggler().sweep()

    expect(await mismatches()).toEqual(NO_MISMATCH)

    await db.execute(
      `DELETE FROM "VirtualCardTransaction" WHERE "refId" = $1 AND "kind" = 'CANCEL'`,
      [canceled.paymentId],
    )
    expect(await mismatches()).toMatchObject({ stuckCardLimit: 1 })

    // ④ 받지도 않은 돈으로 물건이 나간다.
    await db.execute(`UPDATE "Payment" SET "status" = 'FAILED' WHERE "id" = $1`, [paid.paymentId])
    expect(await mismatches()).toMatchObject({ unpaidButSold: 1 })
  }, 30_000)
})
