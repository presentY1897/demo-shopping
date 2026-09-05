import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  paymentResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  hasValidSignature,
  signWebhook,
  TOSS_WEBHOOK_ROUTE,
  TOSS_WEBHOOK_SIGNATURE_HEADER,
} from '../../src/payment/payment-webhook.js'
import type { TossClient, TossConfirmRequest, TossPayment } from '../../src/payment/toss.client.js'
import { TOSS_CLIENT, TOSS_UNREACHABLE, TossError } from '../../src/payment/toss.client.js'
import type { ApiApp } from '../support/api-app.js'
import { useApiApp } from '../support/api-app.js'
import { testTossConfig } from '../support/app-config.js'
import { DEFAULT_TEST_INSTANT } from '../support/clock.js'
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
 * 결제 웹훅 수신 (TASK-0056 F1~F5), 이 워커의 실제 데이터베이스에 대해.
 *
 * **이 파일이 재는 것은 「웹훅을 잘 읽는가」가 아니라 「웹훅을 믿지 않는가」다.**
 * 도착한 본문은 「지금 확인해 보라」는 신호일 뿐이고 상태를 정하는 것은 우리가
 * 저쪽에 다시 물어본 답이다 — 그래서 아래의 단언 중 **본문의 `status` 를 근거로
 * 상태를 확인하는 것은 하나도 없다.** 오히려 반대다: 본문이 「취소됐다」고 말해도
 * 상태가 그대로인 것을 F3 이 잰다.
 *
 * 그 선택이 F2·F3 을 접는 방식이 이 파일의 주제다.
 *
 * | | 어떻게 되는가 |
 * | --- | --- |
 * | 같은 웹훅 3회 | 세 번 다 저쪽에 물어보려 하지만, 두 번째부터는 이미 풀린 결제라 `noop` 이다. **상태는 한 번만 움직이고 도착은 세 번 남는다** |
 * | 오래된 이벤트 | 우리가 읽는 것은 그 이벤트가 아니라 **현재**다. 덮을 것이 없다 |
 * | 위조 | 서명이 유일한 자격이고, 통과하지 못한 요청은 **아무 자국도 남기지 않는다** |
 *
 * **HTTP 는 `fetch` 로 직접 건다.** `createApiClient` 를 쓰지 않는 유일한 스펙인데,
 * 이유는 이 라우트의 본문이 **바이트**이기 때문이다 — 클라이언트가 객체를 직렬화해
 * 주면 우리가 서명한 바이트열과 같다는 보장이 없고, 그 순간 이 파일은 서명을 재는
 * 대신 직렬화기가 안정적인지를 재게 된다.
 *
 * **토스의 HTTP 는 가짜다** (QUALITY-GATES 6장). `TOSS_CLIENT` 하나를 대역으로
 * 바꾸면 나머지 — 라우트, 미들웨어, 서비스, 데이터베이스 — 는 배포되는 그것이다.
 */

const db = useDatabase()

/** 이 배포의 웹훅 시크릿. 32자 이상이라는 규칙은 `env.schema.ts` 의 것이다. */
const WEBHOOK_SECRET = 'webhook-secret-0000000000000000000000'

const WIDGET_KEY = 'toss-widget-payment-key'

/** 승인 요청이 저쪽에 닿지 못했다 — 결제가 `UNRESOLVED` 로 남는 유일한 길이다. */
const UNREACHABLE = new TossError(TOSS_UNREACHABLE, '토스 승인 API 에 닿지 못했습니다')

/** 토스에 나간 한 마디. 웹훅이 **저쪽에 다시 물었는가**가 이 파일의 관심사다. */
interface TossCall {
  readonly method: 'confirm' | 'cancel' | 'get' | 'getByOrderId'
  readonly orderId: string | null
}

/**
 * 검사가 대본을 쥔 토스.
 *
 * `toss-payment.spec.ts` 의 `FakeToss` 와 같은 자리를 채우지만 **재는 것이 달라
 * 더 좁다.** 저 파일은 「무엇이 얼마에 나갔나」를 세고, 여기서는 「우리 결제 id 로
 * 몇 번 물었나」만 있으면 된다 — 멱등의 증거가 그 횟수이기 때문이다.
 */
class FakeToss implements TossClient {
  readonly calls: TossCall[] = []
  /** 승인 호출이 실패한다. 이 파일은 늘 실패시킨다 — 출발점이 `UNRESOLVED` 라서다. */
  confirmFailure: TossError | null = UNREACHABLE
  /** 저쪽이 아는 결제. 대사·웹훅이 되찾을 수 있는 것들이다. */
  private readonly byOrderId = new Map<string, TossPayment>()

  reset(): void {
    this.calls.length = 0
    this.confirmFailure = UNREACHABLE
    this.byOrderId.clear()
  }

  /** 저쪽이 이 결제를 「승인됨」으로 알고 있는 것으로 만든다. */
  knows(orderId: string, payment: TossPayment): void {
    this.byOrderId.set(orderId, payment)
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

  cancel(): Promise<TossPayment> {
    return Promise.reject(new Error('이 스펙은 취소를 부르지 않습니다.'))
  }

  get(): Promise<TossPayment> {
    return Promise.reject(new Error('이 스펙은 조회를 부르지 않습니다.'))
  }
}

const toss = new FakeToss()

const api = useApiApp({
  database: db,
  authenticate: true,
  config: { toss: testTossConfig, tossWebhookSecret: WEBHOOK_SECRET },
  overrides: [{ token: TOSS_CLIENT, value: toss }],
})

let buyer: TestCaller
let addressId: string
let categoryId: number

function client(app: ApiApp = api): ApiClient {
  return app.clientAs(buyer)
}

beforeEach(async () => {
  toss.reset()

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

// --------------------------------------------------------------- 주문과 결제

/** 팔 수 있는 조합 하나. */
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

/**
 * **결과를 모르는 결제 하나.** 이 파일의 모든 시나리오가 여기서 출발한다.
 *
 * 웹훅이 상태를 옮길 수 있는 결제는 `UNRESOLVED` 뿐이고(D-220), 그 상태는 승인
 * 요청이 저쪽에 **닿지 못했을 때만** 생긴다. 그래서 가짜 토스의 승인이 실패한다 —
 * 거절이 아니라 실패다. 그 둘이 다른 상태로 가는 것이 D-220 의 요지다.
 */
async function unresolvedPayment(): Promise<{ readonly paymentId: string }> {
  const variantId = await listing(20_000, 10)
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity: 2 },
    schema: cartResponseSchema,
  })
  const itemId = cart.groups.flatMap((group) => group.items)[0]?.id ?? ''
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
  const { payment } = await client().request({
    path: '/payments',
    method: 'POST',
    body: { orderId: order.id, provider: 'TOSS' },
    schema: paymentResponseSchema,
  })

  const confirmed = await client().request({
    path: `/payments/${payment.id}/toss/confirm`,
    method: 'POST',
    body: { paymentKey: WIDGET_KEY, amount: order.paidAmount },
    schema: paymentResponseSchema,
  })

  // 출발점을 단언한다. 여기가 틀리면 아래의 「상태가 움직였다」가 아무 뜻도 없다.
  expect(confirmed.payment.status).toBe('UNRESOLVED')

  return { paymentId: payment.id }
}

// ------------------------------------------------------------------ 웹훅 전송

/** 토스가 보내는 모양의 본문 하나. 문자열로 만드는 것이 요점이다 — 서명은 바이트다. */
function webhookBody(paymentId: string, status = 'DONE'): string {
  return JSON.stringify({
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt: '2026-09-03T00:00:00.000Z',
    data: { paymentKey: WIDGET_KEY, orderId: paymentId, status },
  })
}

function sign(raw: string): string {
  return signWebhook(WEBHOOK_SECRET, Buffer.from(raw, 'utf8'))
}

/**
 * 웹훅 한 건을 실제 소켓으로 보낸다.
 *
 * `signature` 를 주지 않으면 본문에 맞는 서명이 붙는다 — 서명을 재는 시나리오만
 * 그 값을 직접 정한다.
 */
function deliver(
  raw: string,
  options: { readonly signature?: string | null; readonly app?: ApiApp } = {},
): Promise<Response> {
  const app = options.app ?? api
  const signature = options.signature === undefined ? sign(raw) : options.signature

  return fetch(`${app.baseUrl}/api/v1/${TOSS_WEBHOOK_ROUTE}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === null ? {} : { [TOSS_WEBHOOK_SIGNATURE_HEADER]: signature }),
    },
    body: raw,
  })
}

// ------------------------------------------------------------------ 읽어 보기

interface EventRow {
  readonly kind: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
  readonly raw: string | null
  readonly signature: string | null
}

function eventsOf(paymentId: string): Promise<EventRow[]> {
  return db.query<EventRow>(
    `SELECT "kind"::text AS "kind", "fromStatus"::text AS "fromStatus",
            "toStatus"::text AS "toStatus",
            "payload"->>'raw' AS "raw", "payload"->>'signature' AS "signature"
       FROM "PaymentEvent" WHERE "paymentId" = $1 ORDER BY "createdAt", "id"`,
    [paymentId],
  )
}

async function statusOf(paymentId: string): Promise<string> {
  const row = await db.one<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "Payment" WHERE "id" = $1`,
    [paymentId],
  )

  return row.status
}

async function webhookEventCount(): Promise<number> {
  const row = await db.one<{ count: number }>(
    `SELECT count(*)::int AS "count" FROM "PaymentEvent" WHERE "kind" = 'WEBHOOK'`,
  )

  return row.count
}

/** 「저쪽이 승인해 뒀다」를 세팅한다. 웹훅이 물었을 때 나올 답이다. */
function tossApproved(paymentId: string): void {
  toss.knows(paymentId, { paymentKey: WIDGET_KEY, status: 'DONE', totalAmount: 40_000 })
}

describe('정상 수신 (F1)', () => {
  it('moves the payment the way the provider answers, not the way the body says', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)

    const response = await deliver(webhookBody(paymentId))

    expect(response.status).toBe(200)

    // **저쪽이 「승인됨」이라 했으므로 승인이고, 이 저장소의 승인은 매입까지 간다**
    // (`resolveUnresolved`). 놓아 두면 돈은 잡혀 있는데 주문이 없다.
    expect(await statusOf(paymentId)).toBe('PAID')

    // 그리고 **우리가 저쪽에 물어봤다.** 이 단언이 없으면 본문의 `status: 'DONE'`
    // 을 그대로 믿는 구현도 위의 두 줄을 통과한다 — 그쪽은 위조된 본문 하나로
    // 결제가 확정되는 구현이다.
    expect(toss.callsTo('getByOrderId').map((call) => call.orderId)).toEqual([paymentId])
  })

  it('records the arrival next to the state changes it caused', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)
    await deliver(webhookBody(paymentId))

    const events = await eventsOf(paymentId)

    // 도착이 먼저 남고 그다음에 상태가 움직인다. 순서가 뒤집히면 처리 중에 터진 날
    // 「왔었다」는 사실이 사라진다.
    expect(events.map((event) => event.kind)).toEqual([
      'REQUESTED',
      'FAILED',
      'WEBHOOK',
      'AUTHORIZED',
      'CAPTURED',
    ])

    const [webhook] = events.filter((event) => event.kind === 'WEBHOOK')

    // 웹훅 자체는 상태를 옮기지 않는다 — 옮기는 것은 그 뒤의 조회다. 그래서 전후가
    // 둘 다 없고, `PaymentEvent_transition_check` 가 그 짝을 강제한다.
    expect(webhook).toMatchObject({ fromStatus: null, toStatus: null })
  })

  it('sends the payment to failed when the provider does not know it', async () => {
    const { paymentId } = await unresolvedPayment()

    // 저쪽에 아무것도 세팅하지 않았다 — 요청이 도착조차 하지 않았다는 뜻이다.
    const response = await deliver(webhookBody(paymentId))

    expect(response.status).toBe(200)
    expect(await statusOf(paymentId)).toBe('FAILED')
  })
})

describe('멱등 (F2)', () => {
  it('answers 200 three times, moves the state once, and keeps three arrivals', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)

    const raw = webhookBody(paymentId)
    const responses = [await deliver(raw), await deliver(raw), await deliver(raw)]

    // **오류를 주면 PG 가 계속 재전송한다.** 중복이 오류가 아니라는 것이 이 라우트의
    // 계약이고, 세 번 다 200 인 것이 그 계약의 모양이다.
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])

    expect(await statusOf(paymentId)).toBe('PAID')

    const events = await eventsOf(paymentId)

    // **세 줄이 남는다.** 도착은 상태를 바꿨는지와 무관하게 남아야 한다 — 중복
    // 조사에서 가장 먼저 묻는 것이 「몇 번 왔는가」이고, 두 번째 도착을 지운
    // 기록으로는 답할 수 없다. 멱등 열쇠를 유니크 컬럼으로 두지 않은 이유가 이것이다.
    expect(events.filter((event) => event.kind === 'WEBHOOK')).toHaveLength(3)

    // 그런데 **상태를 옮긴 사건은 각각 하나뿐이다.** 이것이 「한 번만 반영된다」의
    // 실제 모양이고, 위의 세 줄과 같이 봐야 뜻이 된다.
    expect(events.filter((event) => event.kind === 'AUTHORIZED')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'CAPTURED')).toHaveLength(1)

    // 저쪽에 물어본 것도 한 번뿐이다. 두 번째부터는 이미 풀린 결제라 문 앞에서
    // 되돌아온다(`noop`) — 결제사 호출이 중복 요청만큼 늘어나지 않는다.
    expect(toss.callsTo('getByOrderId')).toHaveLength(1)
  })
})

describe('순서 역전 (F3)', () => {
  it('does not let an old event overwrite the current state', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)
    await deliver(webhookBody(paymentId))

    expect(await statusOf(paymentId)).toBe('PAID')

    // 뒤늦게 도착한 **오래된** 이벤트다. 본문은 「취소됐다」고 말하고 시각도 앞선다.
    const stale = JSON.stringify({
      eventType: 'PAYMENT_STATUS_CHANGED',
      createdAt: '2026-09-01T00:00:00.000Z',
      data: { paymentKey: WIDGET_KEY, orderId: paymentId, status: 'CANCELED' },
    })

    const response = await deliver(stale)

    expect(response.status).toBe(200)

    // **덮이지 않는다 — 이벤트 시각을 비교했기 때문이 아니라 그 본문을 읽지 않기
    // 때문이다.** 우리가 보는 것은 그 이벤트가 아니라 현재 상태이고, 현재는 이미
    // 풀린 결제라 물어볼 것이 없다.
    expect(await statusOf(paymentId)).toBe('PAID')

    const events = await eventsOf(paymentId)

    // 그래도 도착은 남는다. 「그때 취소됐다는 웹훅이 왔었다」는 나중에 답해야 할
    // 질문이고, 상태를 안 바꿨다는 것이 기록하지 않을 이유는 아니다.
    expect(events.filter((event) => event.kind === 'WEBHOOK')).toHaveLength(2)
    expect(events.filter((event) => event.kind === 'CAPTURED')).toHaveLength(1)
  })
})

describe('서명 검증 (F4)', () => {
  it('refuses a tampered signature with 401 and leaves no trace', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)

    const raw = webhookBody(paymentId)
    const forged = sign(`${raw} `)

    const response = await deliver(raw, { signature: forged })

    expect(response.status).toBe(401)

    // **자국이 없다.** 서명이 통과하지 못한 요청은 결제도, 기록도, 헬스체크의 시각도
    // 건드리지 못한다 — 그렇지 않으면 아무나 우리 표에 줄을 쓸 수 있다.
    expect(await statusOf(paymentId)).toBe('UNRESOLVED')
    expect(await webhookEventCount()).toBe(0)
    expect((await api.client.getHealth()).paymentWebhook.lastReceivedAt).toBeNull()
    expect(toss.callsTo('getByOrderId')).toHaveLength(0)
  })

  it('refuses a request with no signature at all', async () => {
    const { paymentId } = await unresolvedPayment()

    const response = await deliver(webhookBody(paymentId), { signature: null })

    expect(response.status).toBe(401)
    expect(await statusOf(paymentId)).toBe('UNRESOLVED')
  })

  it('refuses a signature made for another body', async () => {
    const { paymentId } = await unresolvedPayment()

    // 같은 상대가 보냈지만 본문이 바뀌었다 — 중간에서 금액이나 결제 id 를 갈아
    // 끼우는 것이 정확히 이 모양이다.
    const response = await deliver(webhookBody(paymentId), {
      signature: sign(webhookBody(paymentId, 'CANCELED')),
    })

    expect(response.status).toBe(401)
    expect(await statusOf(paymentId)).toBe('UNRESOLVED')
  })

  it('answers 400 when the signature is good but the body is not JSON', async () => {
    // 서명이 맞으니 보낸 쪽은 아는 상대다. 읽을 수 없는 본문은 재전송해도 같지만,
    // 200 으로 삼키면 양쪽 이력에 「성공」으로 남아 아무도 모르게 된다. 「우리
    // 결제가 아니다」(200)와 다른 자리인 이유가 그것이다 — 그쪽은 보낸 쪽이 아무
    // 잘못도 하지 않았다.
    const response = await deliver('not json at all')

    expect(response.status).toBe(400)
    expect(await webhookEventCount()).toBe(0)
  })

  describe('시크릿이 설정되지 않은 배포', () => {
    const unsigned = useApiApp({
      database: db,
      authenticate: true,
      config: { toss: testTossConfig, tossWebhookSecret: null },
      overrides: [{ token: TOSS_CLIENT, value: toss }],
    })

    it('refuses every webhook, even a correctly signed one', async () => {
      const { paymentId } = await unresolvedPayment()

      tossApproved(paymentId)

      const response = await deliver(webhookBody(paymentId), { app: unsigned })

      // **검증할 수 없는 것을 통과시키지 않는다.** 통과시키면 이 라우트는 아무나
      // 결제 상태를 흔들 수 있는 문이 되고, 인증 가드 밖이라 뒤에 아무 방어선도
      // 없다. 웹훅이 없는 배포에서도 대사 배치가 같은 일을 하므로 결제는 끝난다.
      expect(response.status).toBe(401)
      expect(await statusOf(paymentId)).toBe('UNRESOLVED')
      expect(await webhookEventCount()).toBe(0)
    })

    it('leaves the rest of the API working', async () => {
      // 위의 단언은 「앱이 안 떴다」로도 참이다. 이 줄이 그것을 배제한다.
      const health = await unsigned.client.getHealth()

      expect(health.database).toBe('ok')
    })
  })
})

describe('원문 보존 (F5)', () => {
  it('keeps the bytes that were signed, not a re-serialised copy', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)

    // 공백과 키 순서가 우리 직렬화기와 다른 본문이다. 파싱 뒤 다시 만들어 저장하는
    // 구현은 여기서 다른 문자열을 남긴다.
    const raw = `{ "data" : {"orderId":"${paymentId}", "paymentKey":"${WIDGET_KEY}"} , "eventType":"PAYMENT_STATUS_CHANGED" }`
    const signature = sign(raw)

    await deliver(raw, { signature })

    const [event] = (await eventsOf(paymentId)).filter((row) => row.kind === 'WEBHOOK')

    expect(event?.raw).toBe(raw)
    expect(event?.signature).toBe(signature)

    // **그리고 그 기록만으로 서명을 다시 검증할 수 있다.** 이것이 원문을 바이트
    // 그대로 남기는 값이다 — 분쟁에서 물어야 하는 것이 「뭐라고 왔었나」와 「그게
    // 진짜 저쪽에서 온 것인가」 둘이고, 재직렬화한 JSON 으로는 뒤쪽에 답할 수 없다.
    expect(
      hasValidSignature(
        WEBHOOK_SECRET,
        Buffer.from(event?.raw ?? '', 'utf8'),
        event?.signature ?? undefined,
      ),
    ).toBe(true)
  })
})

describe('결제를 찾는 두 열쇠', () => {
  it('falls back to the payment key when the body carries no order id', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)
    await deliver(webhookBody(paymentId))

    // 승인이 확인되면서 결제키가 붙었다. 그다음 웹훅부터는 저쪽이 그 키만 보내도
    // 우리 결제에 닿아야 한다 — `orderId` 를 안 싣는 이벤트 종류가 있다.
    const keyOnly = JSON.stringify({
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: { paymentKey: WIDGET_KEY },
    })

    const response = await deliver(keyOnly)

    expect(response.status).toBe(200)

    const events = await eventsOf(paymentId)

    expect(events.filter((event) => event.kind === 'WEBHOOK')).toHaveLength(2)
  })

  it('refuses a body larger than the limit before hashing it', async () => {
    // 서명 검증은 본문 전체를 메모리에 들고 해야 한다(HMAC 이 그렇다). 상한이
    // 없으면 서명 없는 요청 하나로 프로세스를 밀어낼 수 있고, 이 라우트는 인증
    // 가드 밖이라 그 요청을 아무나 보낼 수 있다.
    const huge = JSON.stringify({ eventType: 'X', padding: 'a'.repeat(70 * 1024) })
    const response = await deliver(huge)

    expect(response.status).toBe(413)
    expect(await webhookEventCount()).toBe(0)
  })
})

describe('우리 결제가 아닌 웹훅', () => {
  it('accepts it with 200 and changes nothing', async () => {
    const { paymentId } = await unresolvedPayment()

    // 있을 법하지만 우리 것이 아닌 id — 남의 상점이거나 오래된 테스트 데이터다.
    const stranger = '01999a4e-0000-7000-8000-0000000000ff'
    const response = await deliver(webhookBody(stranger))

    // **404 를 주면 PG 가 재전송하고, 그 재전송은 영원히 같은 답을 받는다.**
    expect(response.status).toBe(200)

    expect(await statusOf(paymentId)).toBe('UNRESOLVED')
    // 결제를 못 찾으면 사건을 앉힐 자리가 없다 — `PaymentEvent` 는 결제에 딸린
    // 표다. 남는 것은 애플리케이션 로그와 아래의 수신 시각뿐이다.
    expect(await webhookEventCount()).toBe(0)
    expect(toss.callsTo('getByOrderId')).toHaveLength(0)
  })

  it('still counts as a webhook we received', async () => {
    await deliver(webhookBody('01999a4e-0000-7000-8000-0000000000ff'))

    // 「우리 것이 아닌 웹훅이 온다」와 「웹훅이 아예 안 온다」는 사람이 갈 곳이
    // 다르다. 앞은 PG 콘솔의 등록 설정이고, 뒤는 네트워크다.
    const health = await api.client.getHealth()

    expect(health.paymentWebhook.lastReceivedAt).toBe(DEFAULT_TEST_INSTANT)
  })
})

describe('헬스체크 (2장)', () => {
  it('is null until a webhook arrives', async () => {
    const health = await api.client.getHealth()

    expect(health.paymentWebhook.lastReceivedAt).toBeNull()
  })

  it('carries the arrival, and a quiet endpoint is still ok', async () => {
    const { paymentId } = await unresolvedPayment()

    tossApproved(paymentId)
    await deliver(webhookBody(paymentId))

    const health = await api.client.getHealth()

    expect(health.paymentWebhook.lastReceivedAt).toBe(DEFAULT_TEST_INSTANT)
    // 웹훅이 한 건도 안 온 것은 고장이 아니므로 이 값은 전체 판정에 실리지 않는다.
    // 실려 있었다면 위의 `is null` 케이스에서 `/health` 가 degraded 였을 것이다.
    expect(health.paymentWebhook.lastReceivedAt).not.toBeNull()
  })
})

describe('다른 라우트의 본문 (원문 보존의 대가)', () => {
  it('still parses JSON everywhere else', async () => {
    // 원문 보존 미들웨어가 전역이 되면 **모든 라우트의 `@Body()` 가 Buffer 로
    // 바뀐다.** 이 파일의 다른 케이스가 전부 그것을 지나가지만(장바구니·주문서·
    // 결제 시작이 모두 JSON 본문이다), 한 줄로 못 박아 둔다 — 이 미들웨어를
    // 전역으로 옮기는 변경이 여기서 걸린다.
    const missing = '01999a4e-0000-7000-8000-0000000000fe'
    const error: unknown = await client()
      .request({
        path: '/payments',
        method: 'POST',
        body: { orderId: missing, provider: 'VIRTUAL_CARD' },
        schema: paymentResponseSchema,
      })
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    // **404 인 것이 이 케이스의 전부다.** 그 답이 나오려면 본문이 객체로 파싱돼
    // `orderId` 가 읽히고 그 주문을 찾아본 뒤여야 한다 — Buffer 로 넘어갔다면
    // 스키마 검증에서 400 으로 끝나 여기까지 오지 못한다.
    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({ status: 404 })
  })
})
