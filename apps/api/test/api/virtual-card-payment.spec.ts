import type { ApiClient } from '@shopping/shared'
import { cartResponseSchema, checkoutResponseSchema, orderResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { OrderService } from '../../src/orders/order.service.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import { SIMULATED_DELAY_MS } from '../../src/payment/virtual-card.provider.js'
import type { IssuedCard } from '../../src/payment/virtual-card.service.js'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import type { ApiApp } from '../support/api-app.js'
import { useApiApp } from '../support/api-app.js'
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
 * 가상 카드로 하는 결제와 그 실패 (TASK-0054), 이 워커의 실제 데이터베이스에 대해.
 *
 * **이 파일이 지키는 것은 「결제됐다」가 뜻하는 것 전부다.** 카드에서 돈이 빠지는
 * 것은 그 사슬의 첫 칸일 뿐이고, 그 뒤로 예약이 확정되고 재고가 실제로 줄고 판매자
 * 몫이 `PAID` 로 가야 비로소 물건이 팔린 것이다. 그 사슬은 M07(예약)과 M08(결제)이
 * 존재하는 이유이면서, **한 칸씩 따로 보는 검사는 전부 초록인 것**이 특징이다 —
 * 카드만 보면 「돈은 빠졌는데 아무도 물건을 보내지 않는」 주문이 통과하고, 주문만
 * 보면 「재고는 줄었는데 돈이 안 빠진」 주문이 통과한다. 그래서 F1 은 그 사슬을
 * **한 검사 안에서 끝까지** 잰다.
 *
 * 나머지 절반은 **실패가 무엇을 남기는가**다. 4.3 이 「거절당해도 예약은 풀지
 * 않는다」로 정한 이상, 한도가 모자라 진 사람이 다른 카드로 다시 하면 **같은 예약
 * 위에서** 결제가 완결돼야 한다 — 그것을 재지 않으면 4.3 은 주석일 뿐이다.
 *
 * 서비스를 앱에서 꺼내 쓴다. 시험 대상은 **서비스와 데이터베이스**이고 컨트롤러가
 * 아니다 (QUALITY-GATES Q5). 주문서를 만드는 앞부분만 실제 HTTP 로 지나간다 —
 * `checkouts.integration.spec.ts` 와 같은 길이라야 이 파일이 재는 예약이 실제
 * 구매자가 잡는 그 예약이 된다.
 *
 * **기본 앱은 재현 장치가 꺼져 있다** (`testAppConfig` 의 `paymentSimulation: 'off'`).
 * 즉 F1~F3 · F6 · F7 · F8 은 운영과 같은 모양에서 지나간다. 지연(F4)과 타임아웃(F5)만
 * 모드를 켠 앱을 자기 `describe` 안에서 따로 띄운다 — 플래그는 **부팅 시각의
 * 설정**이라 요청마다 바꿀 수 없고(4.4), 바꿀 수 있다면 그것은 이미 「운영에서
 * 코드 경로가 닫힌다」가 아니다. 그 앱들은 같은 워커 데이터베이스를 보므로, 여기서
 * 만든 주문을 저기서 결제해도 같은 행이다.
 */

const db = useDatabase()

/** 운영과 같은 모양. 재현 장치는 꺼져 있다 (4.4). */
const api = useApiApp({ database: db, authenticate: true })

/** 「끊겼다」를 기다려 줄 상한. 이만큼 걸리면 그것은 끊긴 것이 아니다 (F5). */
const PROMPT_MS = 1_000

/** 느린 검사의 여유. 단언이 실패를 보고해야지 시간 초과가 보고하면 안 된다. */
const SLOW_TEST_MS = 30_000

function payments(app: ApiApp = api): PaymentService {
  return app.resolve<PaymentService>(PaymentService)
}

function cards(app: ApiApp = api): VirtualCardService {
  return app.resolve<VirtualCardService>(VirtualCardService)
}

function orders(app: ApiApp = api): OrderService {
  return app.resolve<OrderService>(OrderService)
}

let buyer: TestCaller
let principal: RequestPrincipal
let addressId: string
let categoryId: number

beforeEach(async () => {
  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  principal = { app: 'shop', userId: account.id, roles: ['BUYER'], sellerId: null }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

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

/** 담고 그 줄의 id 를 돌려준다. */
async function add(variantId: string, quantity: number): Promise<string> {
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity },
    schema: cartResponseSchema,
  })
  const line = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === variantId)

  return line?.id ?? ''
}

interface PlacedOrder {
  readonly orderId: string
  /** 이 주문이 잡은 예약을 찾는 열쇠다 (`Order.checkoutId`). */
  readonly checkoutId: string
  /** 승인액. 카드 한도를 이 값 기준으로 잡으므로 거의 모든 검사가 여기서 출발한다. */
  readonly paidAmount: number
  readonly variantId: string
}

/**
 * 결제를 붙일 수 있는 진짜 주문 하나.
 *
 * 장바구니 → 주문서 → 주문. `checkouts.integration.spec.ts` 와 같은 길이고, 그래서
 * 이 주문이 들고 있는 예약은 실제 구매자가 잡는 그 예약이다. 금액도 배송비 규칙을
 * 지나온 값이라, 이 파일 어디에도 총액을 손으로 적지 않는다.
 */
async function place(
  options: { readonly quantity?: number; readonly stock?: number; readonly price?: number } = {},
): Promise<PlacedOrder> {
  const variantId = await listing(options.price ?? 20_000, options.stock ?? 10)
  const itemId = await add(variantId, options.quantity ?? 2)
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

  return {
    orderId: order.id,
    checkoutId: checkout.id,
    paidAmount: order.paidAmount,
    variantId,
  }
}

/** 한도 `creditLimit` 짜리 카드 한 장. 이 구매자의 것이다. */
function issueCard(creditLimit: number): Promise<IssuedCard> {
  return cards().issueFor(buyer.userId, creditLimit)
}

/**
 * 결제를 시작하고 그 id 를 돌려준다.
 *
 * **어느 카드로 낼지는 여기서 정한다.** 승인 시점에 고르게 두면 「무엇으로 결제
 * 중인가」가 결제 행에 없는 시간이 생기고, 그 사이에 죽은 결제는 되짚을 수 없다.
 */
async function startPayment(
  order: PlacedOrder,
  cardId: string,
  app: ApiApp = api,
): Promise<string> {
  const { payment } = await payments(app).start(principal, order.orderId, 'VIRTUAL_CARD', {
    methodRef: cardId,
  })

  expect(payment).toMatchObject({ status: 'READY', authorizedAmount: order.paidAmount })

  return payment.id
}

/** 이 주문의 판매자 몫 상태 전부. 하나라도 뒤처지면 그 판매자는 물건을 안 보낸다. */
async function sellerOrderStatuses(orderId: string): Promise<string[]> {
  const rows = await db.query<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "orderId" = $1 ORDER BY "id"`,
    [orderId],
  )

  return rows.map((row) => row.status)
}

interface HistoryRow {
  readonly fromStatus: string | null
  readonly toStatus: string
}

function historyOf(orderId: string): Promise<HistoryRow[]> {
  return db.query<HistoryRow>(
    `SELECT h."fromStatus"::text AS "fromStatus", h."toStatus"::text AS "toStatus"
       FROM "OrderStatusHistory" h
       JOIN "SellerOrder" s ON s."id" = h."sellerOrderId"
      WHERE s."orderId" = $1
      ORDER BY h."id"`,
    [orderId],
  )
}

interface ReservationRow {
  readonly id: string
  readonly status: string
  readonly quantity: number
  readonly settledAt: Date | null
}

/** 이 주문서 시도가 잡은 예약들. `Order.checkoutId` 가 그 열쇠다. */
function reservationsOf(checkoutId: string): Promise<ReservationRow[]> {
  return db.query<ReservationRow>(
    `SELECT "id", "status"::text AS "status", "quantity", "settledAt"
       FROM "StockReservation" WHERE "checkoutId" = $1 ORDER BY "id"`,
    [checkoutId],
  )
}

/** 표에서 바로 읽은 실물 재고와 예약분. */
function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

interface StockEntry {
  readonly type: string
  readonly quantity: number
  readonly balanceAfter: number
  readonly refType: string | null
  readonly refId: string | null
}

/**
 * 이 조합의 재고 원장 전부.
 *
 * 공장(`createProductVariant`)은 원장 행 없이 조합을 만드므로, 여기 나오는 줄은
 * 전부 **이 검사가 일으킨 것**이다.
 */
function stockLedgerOf(variantId: string): Promise<StockEntry[]> {
  return db.query<StockEntry>(
    `SELECT "type"::text AS "type", "quantity", "balanceAfter",
            "refType"::text AS "refType", "refId"
       FROM "StockLedger" WHERE "variantId" = $1 ORDER BY "seq"`,
    [variantId],
  )
}

interface CardEntry {
  readonly kind: string
  readonly amount: number
  readonly balanceAfter: number
  readonly refId: string
}

function cardLedgerOf(cardId: string): Promise<CardEntry[]> {
  return db.query<CardEntry>(
    `SELECT "kind"::text AS "kind", "amount", "balanceAfter", "refId"
       FROM "VirtualCardTransaction" WHERE "cardId" = $1 ORDER BY "createdAt", "id"`,
    [cardId],
  )
}

function cardUsage(cardId: string): Promise<{ usedAmount: number; status: string }> {
  return db.one(
    `SELECT "usedAmount", "status"::text AS "status" FROM "VirtualCard" WHERE "id" = $1`,
    [cardId],
  )
}

/**
 * 거절 사유들. 결제 표에는 사유 칸이 없고, 남는 자리는 `PaymentEvent` 다.
 *
 * 사유가 없으면 화면은 「결제에 실패했어요」밖에 말하지 못하고, 그때 구매자가 할 수
 * 있는 일은 같은 카드로 다시 눌러 보는 것뿐이다.
 */
async function declineReasons(paymentId: string): Promise<string[]> {
  const rows = await db.query<{ reason: string | null }>(
    `SELECT "payload"->>'reason' AS "reason" FROM "PaymentEvent"
      WHERE "paymentId" = $1 AND "kind" = 'FAILED' ORDER BY "id"`,
    [paymentId],
  )

  return rows.map((row) => row.reason ?? '')
}

/** 승인 한 번. 얼마나 걸렸는지까지 돌려준다 (F4 · F5 · F8). */
async function authorizeTimed(
  paymentId: string,
  app: ApiApp = api,
): Promise<{ status: string; elapsedMs: number }> {
  // **주입된 시계가 아니라 실제 경과 시간이다.** 이 셋이 재는 것은 도메인의
  // 시각(만료·승인 시각)이 아니라 「호출이 실제로 얼마나 걸렸나」이고, 고정 시계는
  // 정의상 움직이지 않으므로 그 질문에 답할 수 없다 — 성능 스펙들이 같은 이유로
  // `performance.now()` 를 쓴다. 도메인 시각을 재는 단언은 이 파일에 하나도 없다.
  const startedAt = performance.now()
  const { payment } = await payments(app).authorize(principal, paymentId)

  return { status: payment.status, elapsedMs: performance.now() - startedAt }
}

describe('부팅 배선', () => {
  it('registers the virtual card provider without a spec having to', () => {
    // 레지스트리가 비어 있으면 결제 시작이 500 으로 끝나고, 그 500 은 결제 화면이
    // 붙는 날에야 보인다. `payments.integration.spec.ts` 는 가짜를 직접 등록해서
    // 잰 것이므로, 「진짜가 부팅에 실려 있다」를 말하는 검사는 여기뿐이다.
    expect(api.resolve<PaymentProviderRegistry>(PaymentProviderRegistry).registered()).toContain(
      'VIRTUAL_CARD',
    )
  })
})

describe('정상 승인 (F1)', () => {
  it('confirms the holds, takes the stock down and marks every seller order paid', async () => {
    const placed = await place({ quantity: 2, stock: 10 })
    const card = await issueCard(placed.paidAmount)
    const paymentId = await startPayment(placed, card.id)

    // 아직 아무것도 안 움직였다. `READY` 는 「결제창을 열었다」이지 「냈다」가 아니다.
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
    expect(await cardLedgerOf(card.id)).toEqual([])

    const approved = await payments().authorize(principal, paymentId)

    expect(approved.payment.status).toBe('AUTHORIZED')
    expect(approved.payment.paymentKey).not.toBeNull()
    expect(approved.payment.approvedAt).not.toBeNull()

    // 매입이 끝나면 「주문이 결제됐다」가 주문 쪽으로 간다 (4.2). **결제가 예약을
    // 직접 확정하지 않는다** — 프로바이더가 무엇이든 그 뒤는 같아야 하고, 그 「뒤」를
    // 아는 것은 주문 쪽이다. 그래서 아래 다섯 가지는 매입 한 번으로 전부 참이 된다.
    const settled = await payments().capture(principal, paymentId)

    expect(settled.payment).toMatchObject({ status: 'PAID', canceledAmount: 0 })

    // ① 판매자 몫이 전부 `PAID` 다. 하나라도 `PAYMENT_PENDING` 에 남으면 그
    //    판매자의 화면에는 이 주문이 뜨지 않고, 물건은 영영 안 나간다.
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
    // 그리고 그 이동이 이력에 남았다. 앞 행의 도착지가 다음 행의 출발지다.
    expect(await historyOf(placed.orderId)).toEqual([
      { fromStatus: null, toStatus: 'PAYMENT_PENDING' },
      { fromStatus: 'PAYMENT_PENDING', toStatus: 'PAID' },
    ])

    // ② 예약이 확정됐다. `HELD` 로 남으면 TTL 이 지나는 순간 만료 스케줄러가
    //    **결제된 주문의 재고를** 남에게 넘긴다 (TASK-0051).
    const held = await reservationsOf(placed.checkoutId)

    expect(held.map((row) => row.status)).toEqual(['CONFIRMED'])
    expect(held.map((row) => row.quantity)).toEqual([2])
    expect(held[0]?.settledAt).not.toBeNull()

    // ③ 재고가 **실제로** 줄었고 예약분은 돌아왔다. 둘 다 움직여야 가용재고가 8이다
    //    — `reserved` 만 돌려주면 판 물건이 다시 진열되고, `stock` 만 줄이면 같은
    //    두 개가 두 번 잠긴다.
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 8, reserved: 0 })

    // ④ 그리고 그 감소가 원장에 있다. **원장이 사실이고 `stock` 은 그 결과**라는
    //    규약(TASK-0036)이 결제 경로에서도 깨지지 않는다 — 여기가 비어 있으면
    //    「재고가 왜 줄었나」에 아무도 답할 수 없다.
    expect(await stockLedgerOf(placed.variantId)).toEqual([
      {
        type: 'RESERVE_CONFIRM',
        quantity: -2,
        balanceAfter: 8,
        refType: 'STOCK_RESERVATION',
        refId: held[0]?.id ?? '',
      },
    ])

    // ⑤ 카드에서 정확히 그만큼 나갔고, 그 사용이 **어느 결제였는지**가 남았다.
    //    대사는 그 참조로만 양쪽을 맞춰 볼 수 있다.
    expect(await cardUsage(card.id)).toEqual({ usedAmount: placed.paidAmount, status: 'ACTIVE' })
    expect(await cardLedgerOf(card.id)).toEqual([
      {
        kind: 'CHARGE',
        amount: placed.paidAmount,
        balanceAfter: placed.paidAmount,
        refId: paymentId,
      },
    ])
    expect(await cards().reconcile()).toEqual([])
  })

  it('takes the stock down once however many times the news of payment arrives', async () => {
    const placed = await place({ quantity: 3, stock: 10 })
    const card = await issueCard(placed.paidAmount)
    const paymentId = await startPayment(placed, card.id)

    await payments().authorize(principal, paymentId)
    await payments().capture(principal, paymentId)

    // 두 번째다. 결제 승인 웹훅은 두 번 오고(TASK-0056) 재시도도 두 번 부른다 —
    // 두 번째가 재고를 한 번 더 깎으면 그 조합은 팔지도 않은 세 개를 잃는다.
    await orders().markPaid(placed.orderId)

    expect(await levelsOf(placed.variantId)).toEqual({ stock: 7, reserved: 0 })
    expect(await stockLedgerOf(placed.variantId)).toHaveLength(1)
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
    // 이력도 두 줄 그대로다. 아무 일도 없었으므로 기록할 것도 없다.
    expect(await historyOf(placed.orderId)).toHaveLength(2)
  })
})

describe('한도 초과 (F2 · 4.3)', () => {
  it('declines, leaves the order unfinished and keeps the holds where they were', async () => {
    const placed = await place({ quantity: 2, stock: 10 })
    // 1원이 모자란다. 큰 차이로 시험하면 「한도를 본다」와 「이 카드는 못 쓴다」가
    // 구별되지 않는다.
    const card = await issueCard(placed.paidAmount - 1)
    const paymentId = await startPayment(placed, card.id)

    // 거절은 예외가 아니라 값이다 (TASK-0052 4.3). 한도 초과는 프로그램의 오류가
    // 아니라 정상적인 대답이고, 서비스는 그것을 상태로 옮겨 적을 뿐이다.
    const declined = await payments().authorize(principal, paymentId)

    expect(declined.payment).toMatchObject({
      status: 'FAILED',
      paymentKey: null,
      approvedAt: null,
    })
    // 사유가 남았다. 「이만큼까지는 된다」를 말해 줄 수 있어야 다음 행동이 정해진다.
    expect(await declineReasons(paymentId)).not.toEqual([''])

    // 주문은 완료되지 않았다.
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])
    expect(await historyOf(placed.orderId)).toEqual([
      { fromStatus: null, toStatus: 'PAYMENT_PENDING' },
    ])

    // **예약은 그대로 `HELD` 다** (4.3). 풀어 버리면, 거절당한 사람이 다른 카드를
    // 꺼내는 30초 사이에 재고가 남에게 가고 그 재시도는 무의미해진다. 풀어 주는
    // 것은 TTL 이지 실패가 아니다.
    const held = await reservationsOf(placed.checkoutId)

    expect(held.map((row) => row.status)).toEqual(['HELD'])
    expect(held[0]?.settledAt).toBeNull()
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
    expect(await stockLedgerOf(placed.variantId)).toEqual([])

    // 그리고 카드는 한 푼도 쓰지 않았다. 거절해 놓고 사용액만 올리는 구현은
    // 「거절됐다」만 보는 검사를 전부 통과하고, 그 카드는 그 뒤로 영영 한도가 모자란다.
    expect(await cardUsage(card.id)).toEqual({ usedAmount: 0, status: 'ACTIVE' })
    expect(await cardLedgerOf(card.id)).toEqual([])
  })

  it('pays the same order with another card, on the very holds the decline kept', async () => {
    const placed = await place({ quantity: 2, stock: 10 })
    const thin = await issueCard(placed.paidAmount - 1)
    const declined = await startPayment(placed, thin.id)

    expect((await payments().authorize(principal, declined)).payment.status).toBe('FAILED')

    const held = await reservationsOf(placed.checkoutId)

    // 다음에 할 일은 **다른 카드로 다시 하는 것**이다 (4.3). 그 재시도가 성립하는
    // 이유가 「예약이 아직 있다」이므로, 이 검사가 곧 4.3 의 근거다.
    const spare = await issueCard(placed.paidAmount)
    const retried = await startPayment(placed, spare.id)

    expect((await payments().authorize(principal, retried)).payment.status).toBe('AUTHORIZED')
    await payments().capture(principal, retried)

    const settled = await reservationsOf(placed.checkoutId)

    // **같은 예약이다.** 새로 잡은 것이라면 그 사이에 품절될 수 있었고, 그러면
    // 4.3 이 지키려던 것이 지켜지지 않은 것이다.
    expect(settled.map((row) => row.id)).toEqual(held.map((row) => row.id))
    expect(settled.map((row) => row.status)).toEqual(['CONFIRMED'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 8, reserved: 0 })
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])

    // 진 카드는 여전히 깨끗하다. 두 결제가 한 주문에 붙었어도 돈은 한 번만 나갔다.
    expect(await cardUsage(thin.id)).toMatchObject({ usedAmount: 0 })
    expect(await cardUsage(spare.id)).toMatchObject({ usedAmount: placed.paidAmount })
  })
})

describe('카드 정지 (F3)', () => {
  it('declines a suspended card, and says something other than “no room”', async () => {
    const placed = await place({ quantity: 1, stock: 10 })
    const card = await issueCard(placed.paidAmount)

    // `SUSPENDED` 다 — `BLOCKED` 가 아니다 (4.1). 되살릴 수 있는 상태라야 시연이
    // 되고, TASK-0053 이 만든 상태 셋 중 그 뜻인 것은 이것뿐이다.
    expect((await cards().suspend(principal, card.id)).status).toBe('SUSPENDED')

    const paymentId = await startPayment(placed, card.id)
    const declined = await payments().authorize(principal, paymentId)

    expect(declined.payment.status).toBe('FAILED')

    const [suspendedReason] = await declineReasons(paymentId)

    // 사유가 **비어 있지 않다.** 「결제에 실패했어요」로 끝나면 구매자가 할 수 있는
    // 일은 같은 카드로 다시 눌러 보는 것뿐이고, 그것은 또 실패한다.
    expect(suspendedReason).toBeDefined()
    expect(suspendedReason).not.toBe('')

    // 예약은 여기서도 유지된다 (4.3) — 카드를 다시 켜거나 다른 카드를 쓰는 것이
    // 다음 행동이고, 둘 다 재고가 남아 있어야 뜻이 있다.
    expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual(['HELD'])
    expect(await cardLedgerOf(card.id)).toEqual([])
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])

    // 그리고 **한도 초과와 다른 문장이다.** 두 실패가 같은 말을 하면 화면은
    // 「카드를 다시 켜세요」와 「다른 카드를 쓰세요」를 구별해 줄 수 없다.
    const second = await place({ quantity: 1, stock: 10 })
    const thin = await issueCard(second.paidAmount - 1)
    const overLimit = await startPayment(second, thin.id)

    await payments().authorize(principal, overLimit)

    expect(await declineReasons(overLimit)).not.toEqual([suspendedReason])
  })
})

describe('승인 지연 (F4 · 4.4)', () => {
  /**
   * `delay` 모드로 띄운 앱.
   *
   * 두 번째 앱인 이유는 플래그가 **부팅 시각의 설정**이기 때문이다 (4.4). 이
   * `describe` 안에서 띄우고 끝나면 닫히므로, 한 순간에 살아 있는 앱은 둘이다.
   */
  const delayed = useApiApp({
    database: db,
    authenticate: true,
    config: { paymentSimulation: 'delay' },
  })

  it(
    'answers late but normally when the reproduction device is switched on',
    async () => {
      const placed = await place({ quantity: 1, stock: 10 })
      const card = await issueCard(placed.paidAmount)
      const paymentId = await startPayment(placed, card.id, delayed)

      const authorized = await authorizeTimed(paymentId, delayed)

      // 실제로 늦었다. **하한만 잰다** — 상한을 재면 느린 기계에서 빨개지고, 그
      // 빨강은 결함이 아니라 부하다.
      expect(authorized.elapsedMs).toBeGreaterThanOrEqual(SIMULATED_DELAY_MS)

      // 그러나 **정상 승인**이다. 지연이 바꾸는 것은 언제이지 무엇이 아니다 —
      // 로딩이 길었다는 이유로 결과가 달라지면 그것은 재현 장치가 아니라 결함이다.
      expect(authorized.status).toBe('AUTHORIZED')

      await payments(delayed).capture(principal, paymentId)

      // 그리고 그 뒤의 사슬도 같다. 「느리게 왔다」가 「덜 처리됐다」가 되면 안 된다.
      expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
      expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual([
        'CONFIRMED',
      ])
      expect(await levelsOf(placed.variantId)).toEqual({ stock: 9, reserved: 0 })
      expect(await cardUsage(card.id)).toMatchObject({ usedAmount: placed.paidAmount })
    },
    SLOW_TEST_MS,
  )
})

describe('타임아웃 (F5 · 4.5)', () => {
  /**
   * `timeout` 모드로 띄운 앱.
   *
   * **`delay` 를 아주 길게 잡은 것이 아니라 다른 모드다** (4.5). 지연을 늘려 흉내
   * 내면 재는 것이 프로바이더가 아니라 검사의 인내심이 되고, 「끊긴 뒤 상태가
   * 일관적인가」를 초 단위로 기다리지 않고는 물어볼 수 없게 된다.
   */
  const cutOff = useApiApp({
    database: db,
    authenticate: true,
    config: { paymentSimulation: 'timeout' },
  })

  it(
    'cuts the authorization off itself, and leaves nothing half done',
    async () => {
      const placed = await place({ quantity: 2, stock: 10 })
      const card = await issueCard(placed.paidAmount)
      const paymentId = await startPayment(placed, card.id, cutOff)

      const timedOut = await authorizeTimed(paymentId, cutOff)

      // **프로바이더가 스스로 끊었다.** 부르는 쪽은 기다리다 포기한 것이 아니라
      // 답을 받았고, 그래서 이 검사는 초를 세지 않는다 — 그것이 4.5 가 「끊는다」와
      // 「오래 걸린다」를 가른 이유다.
      expect(timedOut.elapsedMs).toBeLessThan(PROMPT_MS)

      // 끊긴 결제는 `FAILED` 다. 낙관적으로 `AUTHORIZED` 로 두면 그 불일치는 매입할
      // 때가 되어서야 돈으로 나타난다.
      expect(timedOut.status).toBe('FAILED')

      const { payment } = await payments(cutOff).get(principal, paymentId)

      expect(payment).toMatchObject({ status: 'FAILED', paymentKey: null, approvedAt: null })
      // 사유가 남았다 — 「한도가 모자랐다」와 「끊겼다」는 다음 행동이 다르다.
      // 앞의 것은 다른 카드를 꺼내는 일이고 뒤의 것은 그냥 다시 눌러 보는 일이다.
      expect(await declineReasons(paymentId)).not.toEqual([''])

      // 그리고 반쯤 결제된 자리가 하나도 없다 — 그것이 「상태 일관성」이 뜻하는
      // 전부다. 예약은 4.3 대로 유지된다.
      expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])
      expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual(['HELD'])
      expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
      expect(await stockLedgerOf(placed.variantId)).toEqual([])

      // 카드도 건드리지 않았다. 끊긴 승인이 한도를 물고 있으면 그 금액은 어느
      // 결제에도 속하지 않은 채 묶이고, 구매자는 이유 없이 한도가 모자란 카드를
      // 들게 된다 — 대사(TASK-0056 · 0057)가 찾아 줄 때까지.
      expect(await cardUsage(card.id)).toEqual({ usedAmount: 0, status: 'ACTIVE' })
      expect(await cardLedgerOf(card.id)).toEqual([])
      expect(await cards(cutOff).reconcile()).toEqual([])
    },
    SLOW_TEST_MS,
  )
})

describe('취소·환불 (F6 · F7)', () => {
  /** 매입까지 간 결제 하나. 환불을 시험하려면 여기서 출발해야 한다. */
  async function captured(): Promise<{
    readonly paymentId: string
    readonly card: IssuedCard
    readonly amount: number
  }> {
    const placed = await place({ quantity: 2, stock: 10 })
    // 한도가 승인액의 두 배에서 1원 모자란다. F6 의 마지막 줄 — 돌려받은 자리로
    // 다시 결제된다 — 이 **돌려받은 덕분에** 지나가는 것이 되게 하는 값이다.
    const card = await issueCard(placed.paidAmount * 2 - 1)
    const paymentId = await startPayment(placed, card.id)

    await payments().authorize(principal, paymentId)
    await payments().capture(principal, paymentId)

    return { paymentId, card, amount: placed.paidAmount }
  }

  it('gives the whole balance back when the payment is cancelled in full', async () => {
    const { paymentId, card, amount } = await captured()

    expect(await cardUsage(card.id)).toMatchObject({ usedAmount: amount })

    const refunded = await payments().refund(principal, paymentId, amount, '단순 변심')

    expect(refunded.payment).toMatchObject({ status: 'CANCELED', canceledAmount: amount })

    // **잔액이 눈으로 원복된다.** 이 카드가 존재하는 이유가 그것이다 — 환불이
    // 제대로 됐는지를 화면에서 확인할 수 있게 하는 장치이고, 여기가 어긋나면 그
    // 확인이 거짓말이 된다.
    expect(await cardUsage(card.id)).toMatchObject({ usedAmount: 0 })

    const entries = await cardLedgerOf(card.id)

    // 승인 행을 **지운 것이 아니라** 되돌린 줄이 하나 더 붙었다. 지우는 구현은
    // 합계만 맞고 「무슨 일이 있었나」에 답하지 못한다.
    expect(entries).toHaveLength(2)
    expect(entries[1]).toMatchObject({ amount: -amount, balanceAfter: 0 })
    expect(await cards().reconcile()).toEqual([])

    // 한도가 정말로 돌아왔다 — 돌려받은 자리로 그만큼 다시 결제할 수 있다. 사용액만
    // 0으로 적어 두고 한도를 안 돌려주는 구현은 위의 단언을 전부 통과한다.
    const again = await place({ quantity: 2, stock: 10 })
    const next = await startPayment(again, card.id)

    expect((await payments().authorize(principal, next)).payment.status).toBe('AUTHORIZED')
  })

  it('gives back only the part that was refunded, and keeps the rest used', async () => {
    const { paymentId, card, amount } = await captured()
    const part = Math.floor(amount / 3)

    const refunded = await payments().refund(principal, paymentId, part, '한 벌만 반품')

    // 잔액이 남아 있으므로 아직 끝이 아니다 — `PARTIAL_CANCELED` 는 종착지가 아니다.
    expect(refunded.payment).toMatchObject({ status: 'PARTIAL_CANCELED', canceledAmount: part })

    // **나머지는 그대로 쓰인 채로 있다.** 부분 환불이 전액을 돌려주면 카드는 받지도
    // 않은 돈을 돌려준 것이 되고, 그 차액은 대사에서만 보인다.
    expect(await cardUsage(card.id)).toMatchObject({ usedAmount: amount - part })

    const entries = await cardLedgerOf(card.id)

    expect(entries).toHaveLength(2)
    expect(entries[1]).toMatchObject({ amount: -part, balanceAfter: amount - part })

    // 남은 만큼을 마저 돌려주면 그때 0이 된다 — 두 번에 나눠 돌려준 합이 승인액이다.
    const rest = await payments().refund(principal, paymentId, amount - part, '나머지도 반품')

    expect(rest.payment).toMatchObject({ status: 'CANCELED', canceledAmount: amount })
    expect(await cardUsage(card.id)).toMatchObject({ usedAmount: 0 })
    expect(await cardLedgerOf(card.id)).toHaveLength(3)
    expect(await cards().reconcile()).toEqual([])
  })
})

describe('운영 비활성 (F8 · 4.4 · R1)', () => {
  /**
   * 이 describe 는 **기본 앱**에서 돈다 — `paymentSimulation` 이 `'off'` 인 앱이다.
   *
   * **무엇을 증명하는가.** 플래그가 꺼진 프로세스는 지연도 랜덤 거절도 하지 않는다.
   * 위의 F4 가 **같은 호출**에 최소 {@link SIMULATED_DELAY_MS} 를 쓴다는 것이
   * 대조군이라, 아래의 「그보다 빨리 끝났다」는 그 경로가 정말로 닫혔다는 뜻이다.
   * 재현 장치를 화면에서만 감춘 구현 — 서버는 여전히 지연하는 구현 — 은 여기서
   * 빨개진다. 상한을 그 상수 자신으로 잡은 것도 그래서다. 손으로 적은 숫자는 재현
   * 지연이 바뀌는 날 아무것도 재지 않게 되고, 그 사실이 조용히 지나간다.
   *
   * **무엇을 증명하지 못하는가.** 두 가지다.
   *
   * 첫째, 이것은 **관측된 행동**이지 「코드 경로가 없다」의 정적 증명이 아니다.
   * 플래그를 읽는 조건문이 있고 그것이 꺼져 있는 구현과, 조건문 자체가 없는 구현을
   * 이 검사는 구별하지 못한다 — 구별하려면 코드를 읽어야 하고, 그것은 검사가 할 수
   * 있는 일이 아니다.
   *
   * 둘째, 아래의 「여섯 번 연속 승인」은 랜덤 거절이 **없다**가 아니라 **흔하지
   * 않다**를 말한다. 1000분의 1짜리 거절은 이 검사를 그냥 지나간다. 그래도 뜻이
   * 있는 이유는 재현 장치의 성질에 있다 — 시연에서 보일 만큼 자주 거절해야 장치이고,
   * 그만큼 자주라면 여섯 번 중 하나는 걸린다.
   */

  it(
    'authorizes without any of the delay the device would have added',
    async () => {
      const placed = await place({ quantity: 1, stock: 10 })
      const card = await issueCard(placed.paidAmount)
      const paymentId = await startPayment(placed, card.id)

      const authorized = await authorizeTimed(paymentId)

      // 켜져 있었다면 최소 {@link SIMULATED_DELAY_MS} 가 걸렸을 호출이다.
      expect(authorized.elapsedMs).toBeLessThan(SIMULATED_DELAY_MS)

      // 「지연이 없다」로 끝나지 않는다. 요청을 통째로 거절해 버리는 구현도 지연은
      // 하지 않지만, 그것은 운영에서 결제가 안 되는 것이다 — **정상 승인**이라야 한다.
      expect(authorized.status).toBe('AUTHORIZED')

      await payments().capture(principal, paymentId)

      expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
      expect(await cardUsage(card.id)).toMatchObject({ usedAmount: placed.paidAmount })
    },
    SLOW_TEST_MS,
  )

  it(
    'approves six payments in a row, so nothing is declining at random',
    async () => {
      const card = await issueCard(5_000_000)
      const statuses: string[] = []

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const placed = await place({ quantity: 1, stock: 10 })
        const paymentId = await startPayment(placed, card.id)

        statuses.push((await payments().authorize(principal, paymentId)).payment.status)
      }

      // 한도는 넉넉하고 카드는 `ACTIVE` 다. 여기서 하나라도 지면 그 거절은 **정상
      // 기능이 아니라 재현 장치**이고, 그것이 운영에 남아 있다는 뜻이다 (R1).
      expect(statuses).toEqual(Array.from({ length: 6 }, () => 'AUTHORIZED'))
      expect(await cardUsage(card.id)).toMatchObject({ status: 'ACTIVE' })
    },
    SLOW_TEST_MS,
  )
})
