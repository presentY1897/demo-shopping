import type { ApiClient, Payment, PaymentResponse } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  paymentResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import type { TossClient, TossConfirmRequest, TossPayment } from '../../src/payment/toss.client.js'
import { TOSS_CLIENT, TOSS_UNREACHABLE, TossError } from '../../src/payment/toss.client.js'
import type { TossStatus } from '../../src/payment/toss-rules.js'
import type { ApiApp } from '../support/api-app.js'
import { useApiApp } from '../support/api-app.js'
import { testTossConfig } from '../support/app-config.js'
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
 * 토스페이먼츠 연동 (TASK-0055), 이 워커의 실제 데이터베이스에 대해.
 *
 * **이 파일이 재는 것은 「토스가 잘 동작하는가」가 아니라 「우리가 토스를 잘못
 * 믿지 않는가」다** (4.2). 그래서 아래의 단언은 하나도 남김없이 **우리 코드**에
 * 관한 것이다 — 결제창이 돌려준 금액을 DB 의 승인액과 맞추는가(F2), 결제창 성공을
 * 승인으로 착각하지 않는가(F1 · F4), 취소 누계가 승인액을 넘지 못하는가(F5 · F6),
 * 실패가 무엇을 남기는가(F3 · F4).
 *
 * **토스의 HTTP 는 가짜다** (4.1). `TOSS_CLIENT` 가 토스와 말하는 유일한 자리라
 * 그 포트를 대역으로 바꾸면 나머지 — 라우트, 서비스, 프로바이더, 데이터베이스 —
 * 는 전부 배포되는 그것이다. 진짜를 부르는 검사는 **네트워크와 남의 가동률에 따라
 * 빨개지고**, 그때 우리에게 고칠 것이 없다. 진짜 결제창은 사람이 키를 넣고 눌러
 * 보는 것이고, 그것은 검사가 대신할 수 없는 종류다.
 *
 * **F2 가 이 파일에서 가장 중요하다.** PG 연동에서 가장 흔한 실수가 결제창이
 * 돌려준 금액을 그대로 믿는 것이고, 그것을 재는 단언은 「거절됐다」로 끝나면 안
 * 된다 — 토스를 **부르고 나서** 거절하는 구현도 그 단언을 통과하는데, 그쪽은 저쪽에
 * 승인된 결제가 남고 우리 장부에는 남지 않는 훨씬 나쁜 모양이다. 그래서 F2 는
 * 매번 **가짜 토스가 한 마디도 듣지 않았다**를 함께 확인한다.
 *
 * **시작·승인·매입은 실제 HTTP 로 지나간다.** 금액 대조가 일어나는 자리가 라우트라
 * (`POST /payments/:id/toss/confirm`), 브라우저가 보낸 값이 실제로 지나는 길을
 * 그대로 지나야 재는 것이 그 대조가 된다. 취소만 서비스를 꺼내 쓴다 — 환불에는
 * 아직 라우트가 없고(`payment.controller.ts`), 그것을 여는 것은 클레임 쪽이다
 * (TASK-0066 · 0068).
 */

const db = useDatabase()

/** 결제창이 돌려주는 키. 값이 아니라 **이것이 그대로 토스로 돌아가는가**가 전부다. */
const WIDGET_KEY = 'toss-widget-payment-key'

/** 토스에 나간 한 마디. 무엇이 어느 「주문」으로 얼마에 나갔는지가 전부다. */
interface TossCall {
  readonly method: 'confirm' | 'cancel' | 'get'
  readonly paymentKey: string
  /** 토스가 부르는 「주문」. 4.3 대로 우리 `Payment.id` 여야 한다. `confirm` 에만 있다. */
  readonly orderId: string | null
  readonly amount: number | null
  readonly reason: string | null
}

/**
 * 검사가 대본을 쥔 토스.
 *
 * 모킹이 아니라 **포트의 또 하나의 구현**이다 (게이트 6장이 밖으로 나가는 계통에
 * 허용하는 대역이고, 데이터베이스는 여기 해당하지 않는다). 기록하는 것이 「무엇이
 * 몇 번, 어느 주문으로, 얼마에 나갔나」인 이유는 이 도메인에서 가장 비싼 실패가
 * **우리 장부와 결제사가 어긋나는 순간**이기 때문이다.
 */
class FakeToss implements TossClient {
  readonly calls: TossCall[] = []
  /**
   * 다음 승인에 토스가 답할 상태. 성공은 `DONE` 하나뿐이다.
   *
   * **2xx 로 왔다는 것과 승인됐다는 것은 다르다.** 가상계좌는 「입금을 기다리는」
   * 상태로도 200 을 돌려주고, 그 둘을 같게 읽는 구현이 F4 가 잡으려는 것이다.
   */
  confirmStatus: TossStatus = 'DONE'
  /** 승인 호출이 아예 실패한다 — 저쪽에 닿지 못한 경우 (F4). */
  confirmFailure: TossError | null = null

  /** 승인된 결제의 금액. 취소와 조회가 그럴듯한 답을 하려면 이것이 필요하다. */
  private readonly approved = new Map<string, number>()

  reset(): void {
    this.calls.length = 0
    this.confirmStatus = 'DONE'
    this.confirmFailure = null
    this.approved.clear()
  }

  /** 이 대역이 받은 특정 호출만. */
  callsTo(method: TossCall['method']): readonly TossCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  confirm(request: TossConfirmRequest): Promise<TossPayment> {
    this.calls.push({
      method: 'confirm',
      paymentKey: request.paymentKey,
      orderId: request.orderId,
      amount: request.amount,
      reason: null,
    })

    if (this.confirmFailure !== null) return Promise.reject(this.confirmFailure)

    this.approved.set(request.paymentKey, request.amount)

    return Promise.resolve({
      paymentKey: request.paymentKey,
      status: this.confirmStatus,
      // 우리가 보낸 금액을 그대로 되돌려준다 — 진짜 토스도 자기가 아는 금액과
      // 다르면 승인하지 않으므로, 여기서 다른 값을 지어내면 대역이 실물보다
      // 너그러워진다.
      totalAmount: request.amount,
    })
  }

  cancel(paymentKey: string, reason: string, amount?: number): Promise<TossPayment> {
    this.calls.push({
      method: 'cancel',
      paymentKey,
      orderId: null,
      amount: amount ?? null,
      reason,
    })

    const total = this.approved.get(paymentKey) ?? 0
    const canceled = amount ?? total

    return Promise.resolve({
      paymentKey,
      status: canceled < total ? 'PARTIAL_CANCELED' : 'CANCELED',
      totalAmount: total,
    })
  }

  get(paymentKey: string): Promise<TossPayment> {
    this.calls.push({ method: 'get', paymentKey, orderId: null, amount: null, reason: null })

    return Promise.resolve({
      paymentKey,
      status: this.confirmStatus,
      totalAmount: this.approved.get(paymentKey) ?? 0,
    })
  }
}

const toss = new FakeToss()

/**
 * 키가 있는 앱. 토스는 등록돼 있고 **HTTP 만** 가짜다.
 *
 * 키와 대역이 같이 오는 것이 `testAppConfig` 의 기본값이 `null` 인 이유다
 * (`test/support/app-config.ts`) — 한쪽만 넘기면 실제 토스 서버를 부르게 된다.
 */
const api = useApiApp({
  database: db,
  authenticate: true,
  config: { toss: testTossConfig },
  overrides: [{ token: TOSS_CLIENT, value: toss }],
})

let buyer: TestCaller
let principal: RequestPrincipal
let addressId: string
let categoryId: number

function payments(): PaymentService {
  return api.resolve<PaymentService>(PaymentService)
}

function registryOf(app: ApiApp): PaymentProviderRegistry {
  return app.resolve<PaymentProviderRegistry>(PaymentProviderRegistry)
}

function client(app: ApiApp = api): ApiClient {
  return app.clientAs(buyer)
}

beforeEach(async () => {
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
  /** 승인액. 결제창이 돌려줄 금액이 이것과 같아야 한다 — F2 가 그것을 잰다. */
  readonly paidAmount: number
  readonly variantId: string
}

/**
 * 결제를 붙일 수 있는 진짜 주문 하나.
 *
 * 장바구니 → 주문서 → 주문. `checkouts.integration.spec.ts` 와 같은 길이라, 이
 * 주문이 들고 있는 예약은 실제 구매자가 잡는 그 예약이다. 금액도 배송비 규칙을
 * 지나온 값이라 이 파일 어디에도 총액을 손으로 적지 않는다 — 손으로 적으면 F2 가
 * 재는 「DB 의 주문 금액과 맞다」가 「검사가 적은 숫자와 맞다」가 된다.
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

/**
 * 결제를 시작한다 — 결제창을 여는 데까지다.
 *
 * 금액을 보내지 않는다. 승인액은 **주문이 정하고**, 브라우저가 정하게 두면 F2 가
 * 대조할 원본이 사라진다.
 */
async function startToss(placed: PlacedOrder, app: ApiApp = api): Promise<string> {
  const { payment } = await client(app).request({
    path: '/payments',
    method: 'POST',
    body: { orderId: placed.orderId, provider: 'TOSS' },
    schema: paymentResponseSchema,
  })

  expect(payment).toMatchObject({
    provider: 'TOSS',
    status: 'READY',
    authorizedAmount: placed.paidAmount,
    paymentKey: null,
  })

  return payment.id
}

/** 결제창이 돌아온 뒤의 서버 승인 요청. 여기가 금액 대조가 일어나는 자리다. */
function confirmCall(
  paymentId: string,
  body: { readonly paymentKey: string; readonly amount: number },
): Promise<PaymentResponse> {
  return client().request({
    path: `/payments/${paymentId}/toss/confirm`,
    method: 'POST',
    body,
    schema: paymentResponseSchema,
  })
}

async function confirm(
  paymentId: string,
  body: { readonly paymentKey: string; readonly amount: number },
): Promise<Payment> {
  return (await confirmCall(paymentId, body)).payment
}

async function capture(paymentId: string): Promise<Payment> {
  const { payment } = await client().request({
    path: `/payments/${paymentId}/capture`,
    method: 'POST',
    schema: paymentResponseSchema,
  })

  return payment
}

async function readPayment(paymentId: string): Promise<Payment> {
  const { payment } = await client().request({
    path: `/payments/${paymentId}`,
    schema: paymentResponseSchema,
  })

  return payment
}

/** 거부 하나. 상태와 도메인 코드가 전부다. */
interface Refusal {
  readonly status: number
  readonly code: string
}

/** HTTP 로 돌아온 거부. 다른 것이 오면 던진다 — 통과한 요청을 거부로 읽으면 안 된다. */
async function failure(work: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return { status: error.status ?? 0, code: error.body?.error.code ?? '' }
}

/** 서비스가 던진 거부의 상태와 도메인 코드 (환불에는 라우트가 없다). */
async function refusal(work: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (error === null || typeof error !== 'object' || !('getStatus' in error)) {
    throw new Error(`거부를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const exception = error as { getStatus: () => number; getResponse: () => unknown }
  const payload = exception.getResponse()
  const code =
    typeof payload === 'object' && payload !== null && 'code' in payload ? String(payload.code) : ''

  return { status: exception.getStatus(), code }
}

/** 이 주문의 판매자 몫 상태 전부. 하나라도 뒤처지면 그 판매자는 물건을 안 보낸다. */
async function sellerOrderStatuses(orderId: string): Promise<string[]> {
  const rows = await db.query<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "orderId" = $1 ORDER BY "id"`,
    [orderId],
  )

  return rows.map((row) => row.status)
}

interface ReservationRow {
  readonly id: string
  readonly status: string
}

/** 이 주문서 시도가 잡은 예약들. `Order.checkoutId` 가 그 열쇠다. */
function reservationsOf(checkoutId: string): Promise<ReservationRow[]> {
  return db.query<ReservationRow>(
    `SELECT "id", "status"::text AS "status"
       FROM "StockReservation" WHERE "checkoutId" = $1 ORDER BY "id"`,
    [checkoutId],
  )
}

/** 표에서 바로 읽은 실물 재고와 예약분. */
function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

interface EventRow {
  readonly kind: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  /** 실패의 사유. 화면이 「결제에 실패했어요」 이상을 말하려면 이것이 있어야 한다. */
  readonly reason: string | null
  /** 금액 대조가 진 경우에만 채워진다 — 우리가 알던 값과 브라우저가 보낸 값. */
  readonly expected: number | null
  readonly received: number | null
}

/**
 * 이 결제에 남은 사건 전부.
 *
 * **거절도 사건이다.** 남기지 않으면 「금액이 조작된 요청이 온 적이 있는가」에
 * 아무도 답할 수 없고, F2 의 완료 기준이 「거부 + 로그 기록」인 이유가 그것이다.
 */
function eventsOf(paymentId: string): Promise<EventRow[]> {
  return db.query<EventRow>(
    `SELECT "kind", "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
            "payload"->>'reason' AS "reason",
            ("payload"->>'expected')::int AS "expected",
            ("payload"->>'received')::int AS "received"
       FROM "PaymentEvent" WHERE "paymentId" = $1 ORDER BY "createdAt", "id"`,
    [paymentId],
  )
}

/** 이 주문에 달린 결제 행의 수. 「만들어지지도 않았다」를 말할 수 있는 유일한 자리다. */
async function paymentCountOf(orderId: string): Promise<number> {
  const row = await db.one<{ count: number }>(
    `SELECT count(*)::int AS "count" FROM "Payment" WHERE "orderId" = $1`,
    [orderId],
  )

  return row.count
}

describe('부팅 배선 (4.1)', () => {
  it('registers the Toss provider when both keys are configured', () => {
    const registered = registryOf(api).registered()

    // 둘 다 있어야 추상화가 장식이 아니다 (D-031). 하나뿐이면 그 하나의 모양이 곧
    // 인터페이스가 된다.
    expect(registered).toContain('TOSS')
    expect(registered).toContain('VIRTUAL_CARD')
  })

  describe('키가 없는 프로세스', () => {
    /**
     * 토스 키가 하나도 없는 앱.
     *
     * **CI 가 실제로 이 모양이다** (4.1). 그래서 이것은 예외적인 구성이 아니라
     * 기본값이고, 여기서 나머지가 그대로 돈다는 것이 「키를 기다리지 않는다」의
     * 전부다. 대역도 넘기지 않는다 — 등록되지 않은 프로바이더는 대역도 필요 없고,
     * 넘기지 않는 편이 「정말 안 붙었나」를 더 정직하게 잰다.
     */
    const unconfigured = useApiApp({ database: db, authenticate: true, config: { toss: null } })

    it('leaves TOSS out of the registry and refuses to start one, with the rest untouched', async () => {
      const registered = registryOf(unconfigured).registered()

      expect(registered).not.toContain('TOSS')
      // 나머지는 그대로 돈다. 이 줄이 없으면 위의 단언은 「앱이 안 떴다」로도 참이다.
      expect(registered).toContain('VIRTUAL_CARD')

      const placed = await place()
      const refused = await failure(
        client(unconfigured).request({
          path: '/payments',
          method: 'POST',
          body: { orderId: placed.orderId, provider: 'TOSS' },
          schema: paymentResponseSchema,
        }),
      )

      // 500 이다 — 레지스트리가 없는 구현을 물으면 던진다(`payment-registry.ts`).
      // 사용자의 잘못이 아니라 **배선이 빠진 것**이라 요청을 고쳐도 낫지 않는다:
      // 애초에 토스는 결제수단 목록에 없고, 그것을 골라 부른 화면 쪽이 틀렸다.
      expect(refused.status).toBe(500)
      // 그리고 **결제 행이 생기지 않았다.** 아무도 쓸 수 없는 `READY` 가 남으면
      // 그 주문은 결제 화면에서 영영 이상해진다.
      expect(await paymentCountOf(placed.orderId)).toBe(0)

      // 그리고 가상 카드로는 여전히 결제가 시작된다 — 키가 없으면 **그 기능만**
      // 없는 것이 이 저장소가 R2·Google 에서 두 번 산 성질이다.
      const { payment } = await client(unconfigured).request({
        path: '/payments',
        method: 'POST',
        body: { orderId: placed.orderId, provider: 'VIRTUAL_CARD' },
        schema: paymentResponseSchema,
      })

      expect(payment).toMatchObject({ provider: 'VIRTUAL_CARD', status: 'READY' })
    })
  })
})

describe('승인 2단계 (F1)', () => {
  it('finishes the order only after the server has confirmed with Toss', async () => {
    const placed = await place({ quantity: 2, stock: 10 })
    const paymentId = await startToss(placed)

    // 결제창을 열었을 뿐이다. 재고도 예약도 그대로고, 토스에는 한 마디도 안 갔다.
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
    expect(toss.calls).toEqual([])

    const authorized = await confirm(paymentId, {
      paymentKey: WIDGET_KEY,
      amount: placed.paidAmount,
    })

    // **서버 승인이 최종 확정이다** — 그 호출이 실제로 토스로 나갔고, 우리가 보낸
    // 금액은 브라우저가 말한 값이 아니라 DB 의 승인액이다.
    expect(toss.callsTo('confirm')).toEqual([
      {
        method: 'confirm',
        paymentKey: WIDGET_KEY,
        // 토스가 부르는 「주문」은 우리 `Payment.id` 다 (4.3).
        orderId: paymentId,
        amount: placed.paidAmount,
        reason: null,
      },
    ])
    expect(authorized).toMatchObject({
      status: 'AUTHORIZED',
      authorizedAmount: placed.paidAmount,
      // 대사의 열쇠가 토스가 부르는 그 키다. 우리가 지어낸 값이 여기 남으면
      // 대사에서 양쪽을 맞춰 볼 방법이 없다.
      paymentKey: WIDGET_KEY,
    })
    expect(authorized.approvedAt).not.toBeNull()

    // **그러나 주문은 아직 완료가 아니다.** 승인과 매입이 두 라우트인 것은 가상
    // 카드의 사정이 아니라 계약이고(TASK-0054), 토스도 그 순서를 따른다.
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])
    expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual(['HELD'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })

    const paid = await capture(paymentId)

    // 그리고 매입 한 번으로 사슬 전부가 참이 된다 — 주문이 `PAID`, 예약이 확정,
    // 재고가 실제로 감소. 한 칸씩 따로 보는 검사는 그 사슬이 끊긴 날에도 전부 초록이다.
    expect(paid).toMatchObject({ status: 'PAID', canceledAmount: 0 })
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
    expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual([
      'CONFIRMED',
    ])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 8, reserved: 0 })

    // **매입은 토스에 아무것도 보내지 않는다.** 토스의 승인 한 번이 매입까지이기
    // 때문이고, 그래서 이 파일 전체에서 토스에 나간 것은 그 승인 하나뿐이다 — 매입이
    // 저쪽을 한 번 더 부르면 두 번 청구된다. 우리 쪽 상태는 그래도 옮겨간다:
    // 승인과 매입을 나누는 결제사가 있는 한 그 단계는 계약에 남아 있어야 한다.
    expect(toss.calls).toHaveLength(1)
    expect(toss.callsTo('confirm')).toHaveLength(1)
  })

  it('refuses a second confirmation of the same redirect', async () => {
    const placed = await place()
    const paymentId = await startToss(placed)

    await confirm(paymentId, { paymentKey: WIDGET_KEY, amount: placed.paidAmount })

    // **같은 리다이렉트가 두 번 열리는 것** — 뒤로 가기, 새로고침, 두 탭 — 이
    // 정확히 이 경우다. 금액은 맞으므로 대조는 통과하고, 막아 주는 것은 상태뿐이다.
    const refused = await failure(
      confirmCall(paymentId, { paymentKey: WIDGET_KEY, amount: placed.paidAmount }),
    )

    // 상태의 문제라 409 다 — 보낸 값은 옳고 세상이 그 상태가 아니다.
    expect(refused).toEqual({ status: 409, code: 'PAYMENT_TRANSITION_REFUSED' })
    // 그리고 **토스에는 한 번만 나갔다.** 두 번 보내면 저쪽에서 두 번 승인될 수
    // 있고, 그 두 번째는 우리 장부 어디에도 없는 결제가 된다.
    expect(toss.callsTo('confirm')).toHaveLength(1)
    expect((await readPayment(paymentId)).status).toBe('AUTHORIZED')
  })
})

describe('금액 대조 (F2)', () => {
  it('refuses a tampered amount without ever calling Toss', async () => {
    const placed = await place({ quantity: 2, stock: 10 })
    const paymentId = await startToss(placed)

    const refused = await failure(
      // 결제창이 돌려준 값을 브라우저에서 깎았다. PG 연동에서 가장 흔한 공격이고,
      // 그대로 믿는 구현에서는 이 요청이 그냥 지나간다.
      confirmCall(paymentId, { paymentKey: WIDGET_KEY, amount: placed.paidAmount - 10_000 }),
    )

    // **토스는 한 마디도 듣지 않았다.** 이 줄이 F2 의 전부다 — 부르고 나서 거절하는
    // 구현은 「거절됐다」만 보는 단언을 통과하지만, 그쪽은 저쪽에 승인된 결제가 남고
    // 우리 장부에는 남지 않는 훨씬 나쁜 모양이다. 그리고 그 불일치는 대사가 찾아
    // 줄 때까지 아무에게도 보이지 않는다.
    expect(toss.calls).toEqual([])

    // 거절에는 **자기 코드**가 붙는다. 「결제에 실패했어요」로 끝나면 사람이 할 수
    // 있는 일은 다시 눌러 보는 것뿐이고, 그것은 또 실패한다. 400 인 것도 뜻이 있다 —
    // 5xx 는 「우리가 깨졌다」라 다시 눌러 보라는 말이 되는데, 금액이 안 맞는 요청은
    // 몇 번을 눌러도 안 맞는다.
    expect(refused).toEqual({ status: 400, code: 'PAYMENT_AMOUNT_MISMATCH' })

    // 그리고 **거절이 기록으로 남았다** (6.1 F2 의 「거부 + 로그 기록」). 금액이
    // 조작된 요청이 온 적이 있는가에 답할 수 있는 자리는 이 표뿐이다.
    const events = await eventsOf(paymentId)

    expect(events.map((event) => event.kind)).toEqual(['REQUESTED', 'FAILED'])
    expect(events[1]).toMatchObject({
      // 상태는 옮기지 않았으므로 전후가 **둘 다 없다** — 그 짝을
      // `PaymentEvent_transition_check` 가 강제한다. 사건은 있었고 상태는 그대로다.
      fromStatus: null,
      toStatus: null,
      // 두 숫자가 함께 남는다. 하나만 남기면 조사하는 사람이 「무엇과 무엇이
      // 달랐나」를 다시 물어야 한다.
      expected: placed.paidAmount,
      received: placed.paidAmount - 10_000,
    })
    expect(events[1]?.reason ?? '').not.toBe('')

    // 아무것도 움직이지 않았다. 결제는 아직 시작한 그대로라 **다시 시도할 수 있고**,
    // 예약도 유지된다.
    expect((await readPayment(paymentId)).status).toBe('READY')
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])
    expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual(['HELD'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
  })

  it('refuses the single won that does not match, in either direction, and lets the exact amount through', async () => {
    const placed = await place()
    const paymentId = await startToss(placed)

    // **1원만 틀려도 거절이다.** 큰 금액으로만 시험하면 「대략 맞으면 통과」하는
    // 구현이 지나가고, 실제로 새는 것은 언제나 이 한 칸이다.
    const short = await failure(
      confirmCall(paymentId, { paymentKey: WIDGET_KEY, amount: placed.paidAmount - 1 }),
    )

    expect(short).toEqual({ status: 400, code: 'PAYMENT_AMOUNT_MISMATCH' })
    expect(toss.calls).toEqual([])

    // 반대 방향도 같다. 「더 많이 보냈으면 손해 볼 것 없다」로 통과시키면 우리가
    // 청구하지 않은 금액이 승인되고, 그 차액은 환불로만 되돌아간다.
    const over = await failure(
      confirmCall(paymentId, { paymentKey: WIDGET_KEY, amount: placed.paidAmount + 1 }),
    )

    expect(over).toEqual({ status: 400, code: 'PAYMENT_AMOUNT_MISMATCH' })
    expect(toss.calls).toEqual([])

    // 그리고 정확히 그 금액은 지나간다. 이 줄이 없으면 위의 두 거절이 「대조에서
    // 졌다」인지 「이 라우트가 늘 거절한다」인지 구별되지 않는다.
    const authorized = await confirm(paymentId, {
      paymentKey: WIDGET_KEY,
      amount: placed.paidAmount,
    })

    expect(authorized.status).toBe('AUTHORIZED')
    expect(toss.callsTo('confirm')).toHaveLength(1)
  })

  it('refuses a payment that was never started with Toss', async () => {
    const placed = await place()
    // 가상 카드로 시작한 결제다. 카드를 고르지 않아도 시작은 되고(승인 때 정해진다),
    // 이 라우트에 그것을 주는 것은 **결제창을 거치지 않고 승인 키를 지어낸** 요청이다.
    const { payment } = await client().request({
      path: '/payments',
      method: 'POST',
      body: { orderId: placed.orderId, provider: 'VIRTUAL_CARD' },
      schema: paymentResponseSchema,
    })

    const refused = await failure(
      confirmCall(payment.id, { paymentKey: WIDGET_KEY, amount: placed.paidAmount }),
    )

    // 금액은 맞다. 그런데도 거절되는 것이 요점이다 — 대조를 통과했다고 승인 경로가
    // 열리면, 토스 승인 라우트가 남의 결제를 확정하는 문이 된다.
    expect(refused).toEqual({ status: 400, code: 'PAYMENT_PROVIDER_MISMATCH' })
    expect(toss.calls).toEqual([])
    expect((await readPayment(payment.id)).status).toBe('READY')
  })
})

describe('토스가 부르는 「주문」 (4.3)', () => {
  it('sends our payment id, so one order can be paid for more than once', async () => {
    const placed = await place()
    const first = await startToss(placed)

    // 첫 시도가 진다. 다른 카드로 다시 하는 것이 정확히 이 경우이고, 여기에 우리
    // `Order.id` 를 줬다면 토스가 그것을 이미 쓴 주문번호로 보고 두 번째를 거절한다.
    toss.confirmStatus = 'ABORTED'

    const declined = await confirm(first, {
      paymentKey: 'toss-first-attempt',
      amount: placed.paidAmount,
    })

    expect(declined.status).toBe('FAILED')
    toss.confirmStatus = 'DONE'

    const second = await startToss(placed)
    const authorized = await confirm(second, {
      paymentKey: 'toss-second-attempt',
      amount: placed.paidAmount,
    })

    expect(authorized.status).toBe('AUTHORIZED')

    const sentOrderIds = toss.callsTo('confirm').map((call) => call.orderId)

    // 두 번 다 **그 시도의 결제 id** 가 나갔다. 결제 시도마다 새로 생기는 값이라
    // 토스가 뜻하는 「주문」에 더 가깝다.
    expect(sentOrderIds).toEqual([first, second])
    expect(first).not.toBe(second)
    // 우리 주문 id 는 한 번도 나가지 않았다.
    expect(sentOrderIds).not.toContain(placed.orderId)
  })
})

describe('결제창 취소 (F3)', () => {
  it('leaves the order retryable when the buyer closes the payment window', async () => {
    const placed = await place({ quantity: 2, stock: 10 })
    const abandoned = await startToss(placed)

    // 결제창을 닫으면 서버로 오는 것이 **없다**. 승인 요청이 오지 않는 것이 곧
    // 「취소됐다」이고, 그래서 이 검사가 재는 것은 그 침묵이 무엇을 남겼는가다.
    expect(toss.calls).toEqual([])
    expect((await readPayment(abandoned)).status).toBe('READY')
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])

    const held = await reservationsOf(placed.checkoutId)

    // **예약은 그대로다.** 풀어 버리면, 결제창을 잘못 닫은 사람이 다시 여는 30초
    // 사이에 재고가 남에게 가고 재시도는 무의미해진다. 푸는 것은 TTL 이지 취소가 아니다.
    expect(held.map((row) => row.status)).toEqual(['HELD'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })

    // 다시 열어 끝까지 간다.
    const retried = await startToss(placed)

    await confirm(retried, { paymentKey: WIDGET_KEY, amount: placed.paidAmount })
    await capture(retried)

    const settledHolds = await reservationsOf(placed.checkoutId)

    // **같은 예약이다.** 새로 잡은 것이라면 그 사이에 품절될 수 있었고, 그러면
    // 「재시도 가능」이 지켜지지 않은 것이다.
    expect(settledHolds.map((row) => row.id)).toEqual(held.map((row) => row.id))
    expect(settledHolds.map((row) => row.status)).toEqual(['CONFIRMED'])
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 8, reserved: 0 })
  })
})

describe('승인 실패 (F4)', () => {
  it('records a confirmation Toss did not finish as a failed payment', async () => {
    // 결제창은 지나왔는데 토스에서 끝나지 않았다. 응답은 **200 으로** 오지만 상태가
    // `DONE` 이 아니다 — 가상계좌의 「입금 대기」가 같은 모양으로 온다. 2xx 를
    // 승인으로 읽는 구현이 여기서 빨개지고, 그것이 4.2 가 말하는 「우리가 토스를
    // 잘못 믿는」 모양의 전형이다.
    toss.confirmStatus = 'ABORTED'

    const placed = await place({ quantity: 2, stock: 10 })
    const paymentId = await startToss(placed)

    // 거절은 예외가 아니라 값이다 (TASK-0052 4.3). 토스가 답을 준 이상 그것은
    // 정상적인 대답이고, 우리는 200 과 함께 상태로 옮겨 적는다 — 부르는 쪽은 던져진
    // 예외가 아니라 **상태**를 보고 다음을 정한다.
    const failed = await confirm(paymentId, {
      paymentKey: WIDGET_KEY,
      amount: placed.paidAmount,
    })

    // 금액은 맞았으므로 토스는 불렸다 — 대조에서 진 것이 아니다.
    expect(toss.callsTo('confirm')).toHaveLength(1)
    expect(failed).toMatchObject({ status: 'FAILED', paymentKey: null, approvedAt: null })

    const events = await eventsOf(paymentId)

    // 이번에는 상태가 실제로 움직였으므로 전후가 **둘 다 있다** — 금액 대조에서 진
    // 거절(둘 다 `null`)과 다른 모양이고, 그 차이가 「토스까지 갔는가」를 말해 준다.
    expect(events.map((event) => event.kind)).toEqual(['REQUESTED', 'FAILED'])
    expect(events[1]).toMatchObject({ fromStatus: 'READY', toStatus: 'FAILED' })
    expect(events[1]?.reason ?? '').not.toBe('')

    // 그리고 반쯤 결제된 자리가 하나도 없다 — 그것이 「상태 일관」이 뜻하는 전부다.
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])
    expect((await reservationsOf(placed.checkoutId)).map((row) => row.status)).toEqual(['HELD'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })
  })

  it('keeps the order retryable when the confirm call itself fails', async () => {
    // 이번에는 답이 없다 — 저쪽에 닿지 못했다. **거절과 다른 상황이다**: 승인이
    // 됐는지 안 됐는지를 우리가 모른다.
    const unreachable = new TossError(TOSS_UNREACHABLE, '토스 승인 API 에 닿지 못했습니다')

    toss.confirmFailure = unreachable

    const placed = await place({ quantity: 2, stock: 10 })
    const paymentId = await startToss(placed)

    const failed = await confirm(paymentId, {
      paymentKey: WIDGET_KEY,
      amount: placed.paidAmount,
    })

    // **승인된 것으로 남는 것만은 안 된다.** 낙관적으로 `AUTHORIZED` 로 두면 그
    // 불일치는 매입할 때가 되어서야 돈으로 나타난다.
    expect(failed).toMatchObject({ status: 'FAILED', paymentKey: null })

    // 그리고 **토스가 준 문장이 그대로 남았다.** 다시 쓰면 「한도를 초과했습니다」
    // 같은 것이 두 곳에서 조금씩 달라지고, 사용자에게 그 차이는 그냥 혼란이다.
    expect((await eventsOf(paymentId))[1]?.reason).toBe(unreachable.message)

    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAYMENT_PENDING'])

    const held = await reservationsOf(placed.checkoutId)

    expect(held.map((row) => row.status)).toEqual(['HELD'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 10, reserved: 2 })

    // 그리고 다시 하면 된다. 실패가 예약을 풀지 않았으므로 **같은 예약 위에서**
    // 결제가 완결된다 — 그것을 재지 않으면 「상태 일관」은 주석일 뿐이다.
    toss.confirmFailure = null

    const retried = await startToss(placed)

    await confirm(retried, { paymentKey: WIDGET_KEY, amount: placed.paidAmount })
    await capture(retried)

    const settledHolds = await reservationsOf(placed.checkoutId)

    expect(settledHolds.map((row) => row.id)).toEqual(held.map((row) => row.id))
    expect(settledHolds.map((row) => row.status)).toEqual(['CONFIRMED'])
    expect(await sellerOrderStatuses(placed.orderId)).toEqual(['PAID'])
    expect(await levelsOf(placed.variantId)).toEqual({ stock: 8, reserved: 0 })
  })
})

describe('취소 누계 (F5 · F6)', () => {
  /** 매입까지 간 결제 하나. 취소를 시험하려면 여기서 출발해야 한다. */
  async function captured(): Promise<{ readonly paymentId: string; readonly amount: number }> {
    const placed = await place({ quantity: 2, stock: 10 })
    const paymentId = await startToss(placed)

    await confirm(paymentId, { paymentKey: WIDGET_KEY, amount: placed.paidAmount })
    await capture(paymentId)

    return { paymentId, amount: placed.paidAmount }
  }

  it('cancels the whole amount through Toss (F5)', async () => {
    const { paymentId, amount } = await captured()

    const { payment } = await payments().refund(principal, paymentId, amount, '단순 변심')

    expect(payment).toMatchObject({ status: 'CANCELED', canceledAmount: amount })

    const [canceled] = toss.callsTo('cancel')

    // 취소가 **저쪽에도** 나갔고, 그 열쇠는 승인 때 받은 그 키다. 우리 장부만
    // `CANCELED` 로 적고 토스에 말하지 않으면 그 돈은 돌아오지 않는다.
    expect(toss.callsTo('cancel')).toHaveLength(1)
    expect(canceled).toMatchObject({ paymentKey: WIDGET_KEY, amount })
    // 사유도 함께 나갔다 — 토스 쪽 내역에서 이 취소가 무엇이었는지 남는 자리다.
    expect(canceled?.reason ?? '').not.toBe('')
  })

  it('adds partial cancellations up and refuses the one that would pass the approved amount (F6)', async () => {
    const { paymentId, amount } = await captured()
    const part = Math.floor(amount / 3)

    await payments().refund(principal, paymentId, part, '한 벌만 반품')
    const second = await payments().refund(principal, paymentId, part, '한 벌 더 반품')

    // 잔액이 남아 있으므로 아직 끝이 아니다 — `PARTIAL_CANCELED` 는 종착지가 아니다.
    expect(second.payment).toMatchObject({
      status: 'PARTIAL_CANCELED',
      canceledAmount: part * 2,
    })

    // 남은 것보다 **1원 더**. `>` 와 `>=` 를 바꿔 쓴 구현은 큰 금액으로만 시험하면
    // 통과하고, 그때 나간 차액은 우리 돈이라 대사에서 발견돼도 되돌릴 수 없다.
    const refused = await refusal(
      payments().refund(principal, paymentId, amount - part * 2 + 1, '나머지보다 1원 더'),
    )

    expect(refused).toEqual({ status: 409, code: 'PAYMENT_REFUND_EXCEEDS' })
    // **거절은 토스에 나가지 않았다.** 거절해 놓고 저쪽에 말하면 우리 누계와
    // 결제사의 누계가 갈리고, 그 차이는 돈이 나간 뒤에만 보인다.
    expect(toss.callsTo('cancel').map((call) => call.amount)).toEqual([part, part])
    expect((await readPayment(paymentId)).canceledAmount).toBe(part * 2)

    // 정확히 남은 만큼은 지나가고, 그때 누계가 승인액과 같아진다. 이 줄이 없으면
    // 위의 거절이 「1원이 넘어서」인지 「세 번째 취소가 그냥 막혀서」인지 모른다.
    const rest = await payments().refund(principal, paymentId, amount - part * 2, '나머지도 반품')

    expect(rest.payment).toMatchObject({ status: 'CANCELED', canceledAmount: amount })
    expect(rest.payment.canceledAmount).toBeLessThanOrEqual(rest.payment.authorizedAmount)
    expect(toss.callsTo('cancel').map((call) => call.amount)).toEqual([
      part,
      part,
      amount - part * 2,
    ])
    // 우리 표의 환불 행 합계도 같은 이야기를 한다. 다르면 화면이 보는 숫자와 대사가
    // 보는 숫자가 갈린다.
    expect(rest.payment.refunds.reduce((sum, refund) => sum + refund.amount, 0)).toBe(amount)
  })
})
