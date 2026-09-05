import type { ApiClient, Payment, PaymentProviderName, PaymentStatus } from '@shopping/shared'
import { cartResponseSchema, orderResponseSchema, paymentResponseSchema } from '@shopping/shared'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import type {
  AuthorizeRequest,
  AuthorizeResult,
  PaymentProviderPort,
} from '../../src/payment/payment-provider.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
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
 * 결제 추상화와 결제 스키마 (TASK-0052), 이 워커의 실제 데이터베이스에 대해.
 *
 * **여기서 틀리면 돈이 틀린다.** 재고를 하나 더 파는 것은 사과하고 환불하면
 * 끝나지만, 승인액보다 많이 환불한 건은 우리 돈이 나간 뒤에야 대사에서 발견되고
 * 되돌릴 방법이 없다. 그래서 아래의 단언은 「거절됐다」에서 멈추지 않고 매번
 * **`canceledAmount` 와 `Refund` 행의 합이 여전히 맞는지**까지 본다 — 거절하고도
 * 누계를 올려 버리는 구현은 「거절됐다」만 보는 검사를 통과한다.
 *
 * 서비스를 앱에서 꺼내 쓴다. 결제에는 아직 자기 엔드포인트가 없고(TASK-0053 이
 * 붙인다) 시험 대상은 **서비스와 데이터베이스**다 (QUALITY-GATES Q5).
 *
 * **프로바이더는 이 TASK 의 것이 아니다.** 가상 카드는 TASK-0054, 토스는
 * TASK-0055 가 넣고 레지스트리는 비어 있는 채로 온다 (4.2). 그래서 F1 을 재는
 * 방법은 검사가 가짜를 하나 등록하는 것이고, 그 가짜는 「결제사에 무엇이 몇 번
 * 나갔는지」를 기록한다 — 우리 장부와 결제사가 어긋나는 순간이 이 도메인에서
 * 가장 비싼 실패다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 결제사에 나간 한 마디. 무엇이 몇 번, 얼마로 나갔는지가 전부다. */
interface ProviderCall {
  readonly method: 'authorize' | 'capture' | 'cancel' | 'refund' | 'getStatus'
  readonly paymentKey: string | null
  readonly amount: number | null
  readonly reason: string | null
}

/**
 * 검사가 대본을 쥔 프로바이더.
 *
 * 모킹이 아니라 **포트의 또 하나의 구현**이다 (게이트 6장이 밖으로 나가는 계통에
 * 허용하는 유일한 대역이고, 데이터베이스는 여기 해당하지 않는다). 거절은 던지지
 * 않고 값으로 답한다 — 한도 초과는 프로그램의 오류가 아니라 정상적인 대답이라는
 * 4.3 을 이 구현도 따라야 두 번째 구현이 들어올 때 계약이 유지된다.
 */
class ScriptedProvider implements PaymentProviderPort {
  readonly name: PaymentProviderName
  readonly calls: ProviderCall[] = []
  /** 다음 승인이 통과하는가. */
  approves = true
  /** 거절했을 때 돌려줄 사유. */
  declineReason = '한도를 넘었어요.'
  /**
   * 첫 환불이 결제사에 머무는 동안 할 일. **F6 이 겹침을 배열하는 자리다.**
   *
   * 결제사 왕복이 즉시 끝나면 두 환불이 차례로 지나갈 수 있고, 그러면 「하나만
   * 통과했다」는 「읽고 나서 쓰는」 깨진 구현에서도 똑같이 초록이다. 한 번만
   * 불리는 이유는 두 번째 환불까지 붙잡으면 아무도 풀어 주지 않기 때문이다.
   */
  refundHold: (() => Promise<void>) | null = null

  constructor(name: PaymentProviderName) {
    this.name = name
  }

  reset(): void {
    this.calls.length = 0
    this.approves = true
    this.refundHold = null
  }

  /** 이 프로바이더가 받은 특정 호출만. */
  callsTo(method: ProviderCall['method']): readonly ProviderCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    this.calls.push({
      method: 'authorize',
      paymentKey: null,
      amount: request.amount,
      reason: null,
    })

    if (!this.approves) {
      return Promise.resolve({ approved: false, paymentKey: null, reason: this.declineReason })
    }

    return Promise.resolve({
      approved: true,
      paymentKey: `${this.name}-${request.paymentId}`,
      reason: null,
    })
  }

  capture(paymentKey: string, amount: number): Promise<void> {
    this.calls.push({ method: 'capture', paymentKey, amount, reason: null })

    return Promise.resolve()
  }

  cancel(paymentKey: string, amount: number, reason: string): Promise<void> {
    this.calls.push({ method: 'cancel', paymentKey, amount, reason })

    return Promise.resolve()
  }

  async refund(paymentKey: string, amount: number, reason: string): Promise<void> {
    this.calls.push({ method: 'refund', paymentKey, amount, reason })

    const hold = this.refundHold

    this.refundHold = null
    if (hold !== null) await hold()
  }

  getStatus(paymentKey: string): Promise<PaymentStatus> {
    this.calls.push({ method: 'getStatus', paymentKey, amount: null, reason: null })

    return Promise.resolve('PAID')
  }
}

const virtualCard = new ScriptedProvider('VIRTUAL_CARD')
const toss = new ScriptedProvider('TOSS')

let buyer: TestCaller
let principal: RequestPrincipal
let addressId: string
let categoryId: number

function payments(): PaymentService {
  return api.resolve<PaymentService>(PaymentService)
}

function registry(): PaymentProviderRegistry {
  return api.resolve<PaymentProviderRegistry>(PaymentProviderRegistry)
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

beforeAll(() => {
  // 앱이 뜬 **뒤**다 — `useApiApp` 의 `beforeAll` 이 먼저 등록되어 있다. 레지스트리는
  // 앱의 것이고 데이터베이스가 아니므로 이 등록은 파일이 끝날 때까지 살아 있다.
  registry().register(virtualCard)
  registry().register(toss)
})

beforeEach(async () => {
  virtualCard.reset()
  toss.reset()

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  principal = { app: 'shop', userId: account.id, roles: ['BUYER'], sellerId: null }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

/** 팔 수 있는 조합 하나. 그 variant id 를 돌려준다. */
async function listing(price = 10_000): Promise<string> {
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
    stock: 10,
    isActive: true,
  })

  return variant.id
}

/** 담고 그 줄의 id 를 돌려준다. */
async function add(variantId: string, caller: TestCaller = buyer): Promise<string> {
  const cart = await client(caller).request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity: 1 },
    schema: cartResponseSchema,
  })

  return cart.groups.flatMap((group) => group.items)[0]?.id ?? ''
}

interface PlacedOrder {
  readonly orderId: string
  readonly paidAmount: number
}

/** 결제를 붙일 수 있는 진짜 주문 하나. 상품 10,000원 + 배송비 3,000원. */
async function placeOrder(caller: TestCaller = buyer): Promise<PlacedOrder> {
  const variantId = await listing()
  const itemId = await add(variantId, caller)
  const address =
    caller === buyer ? addressId : (await createAddress(db, { userId: caller.userId })).id
  const { order } = await client(caller).request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [itemId], addressId: address },
    schema: orderResponseSchema,
  })

  return { orderId: order.id, paidAmount: order.paidAmount }
}

interface StartedPayment {
  readonly paymentId: string
  /** 승인액. 환불의 상한이라 거의 모든 검사가 이 값에서 출발한다. */
  readonly amount: number
}

async function startPayment(
  provider: PaymentProviderName = 'VIRTUAL_CARD',
): Promise<StartedPayment> {
  const { orderId } = await placeOrder()
  const { payment } = await payments().start(principal, orderId, provider)

  return { paymentId: payment.id, amount: payment.authorizedAmount }
}

/** 승인까지 간 결제. */
async function authorized(provider: PaymentProviderName = 'VIRTUAL_CARD'): Promise<StartedPayment> {
  const started = await startPayment(provider)

  await payments().authorize(principal, started.paymentId)

  return started
}

/** 매입까지 간 결제. 환불을 시험하려면 여기서 출발해야 한다. */
async function captured(provider: PaymentProviderName = 'VIRTUAL_CARD'): Promise<StartedPayment> {
  const started = await authorized(provider)

  await payments().capture(principal, started.paymentId)

  return started
}

/** 지금 저장된 결제. 상태와 두 금액을 한 번에 읽는다. */
async function read(paymentId: string): Promise<Payment> {
  const { payment } = await payments().get(principal, paymentId)

  return payment
}

interface RefundRow {
  readonly amount: number
  readonly reason: string
}

/** 표에서 바로 읽은 환불 행. 서비스가 돌려주는 것과 어긋나면 그것이 결함이다. */
function refundRows(paymentId: string): Promise<RefundRow[]> {
  return db.query<RefundRow>(
    `SELECT "amount", "reason" FROM "Refund" WHERE "paymentId" = $1 ORDER BY "refundedAt", "id"`,
    [paymentId],
  )
}

/** 금액순으로. 고정 시계 아래에서 같은 순간에 남은 행들을 비교 가능하게 만든다. */
function byAmount<T extends { readonly amount: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => left.amount - right.amount)
}

interface EventRow {
  readonly kind: string
  readonly fromStatus: string | null
  readonly toStatus: string | null
}

function eventRows(paymentId: string): Promise<EventRow[]> {
  return db.query<EventRow>(
    `SELECT "kind", "fromStatus", "toStatus" FROM "PaymentEvent"
      WHERE "paymentId" = $1 ORDER BY "createdAt", "id"`,
    [paymentId],
  )
}

/**
 * 다른 트랜잭션이 **실제로** 이 결제 행의 잠금을 기다릴 때까지 붙잡는다.
 *
 * `concurrently.ts` 의 `awaitBlocked` 와 같은 장치이고 같은 이유다. 장벽만으로는
 * 둘이 같은 순간에 **출발했다**는 것밖에 못 정한다 — 쓰기 구간이 차례로 지나가면
 * 「하나만 통과했다」는 구현이 깨져 있어도 초록이고, 그 초록은 눈에 띄지 않는다.
 *
 * 여기서는 잠글 행의 pid 를 알 방법이 없으므로(부르는 쪽이 Prisma 풀의 연결을 쓴다)
 * 이 데이터베이스에서 잠금을 기다리는 백엔드가 하나라도 생겼는지를 본다. 이
 * 데이터베이스는 이 워커 전용이고 스펙 파일 안의 검사는 차례로 도니, 그 하나는
 * 두 번째 환불이다.
 *
 * 기다리다 못 보면 **던진다.** 겹치지 않았다면 이 검사는 아무것도 재지 않았고,
 * 그 사실이 초록으로 지나가는 것보다는 빨간 것이 낫다.
 */
async function untilAnotherTransactionWaits(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await db.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`,
    )

    if ((row?.waiting ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('두 번째 환불이 잠금을 기다리지 않았습니다 — 두 호출이 겹치지 않았습니다.')
}

/** 서비스가 던진 거부의 상태와 도메인 코드. */
interface Refusal {
  readonly status: number
  readonly code: string
}

function refusalOf(error: unknown): Refusal {
  if (error === null || typeof error !== 'object' || !('getStatus' in error)) {
    throw new Error(`거부를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const exception = error as { getStatus: () => number; getResponse: () => unknown }
  const payload = exception.getResponse()
  const code =
    typeof payload === 'object' && payload !== null && 'code' in payload ? String(payload.code) : ''

  return { status: exception.getStatus(), code }
}

async function refusal(work: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  return refusalOf(error)
}

/**
 * 이 결제가 여전히 성립하는가.
 *
 * 개별 단언이 무엇을 보든 **끝에는 이것이 참이어야 한다.** 거절 경로의 진짜 위험은
 * 「거절했는데 누계는 올랐다」이고, 그 상태는 상태 이름만 보는 검사를 전부
 * 통과한다.
 */
async function invariantsHold(paymentId: string): Promise<{
  readonly canceledAmount: number
  readonly rowTotal: number
  readonly withinAuthorized: boolean
}> {
  const payment = await read(paymentId)
  const rows = await refundRows(paymentId)

  return {
    canceledAmount: payment.canceledAmount,
    rowTotal: rows.reduce((sum, row) => sum + row.amount, 0),
    withinAuthorized: payment.canceledAmount <= payment.authorizedAmount,
  }
}

describe('결제 시작', () => {
  it('starts at READY, for the amount the order actually charged', async () => {
    const { orderId, paidAmount } = await placeOrder()

    const response = await payments().start(principal, orderId, 'VIRTUAL_CARD')

    // 승인액이 주문의 실결제금액과 다르면 그 차액은 어디에서도 다시 나타나지
    // 않는다 — 카드에는 저쪽 금액이 찍히고 주문서에는 이쪽 금액이 남는다.
    expect(response.payment.authorizedAmount).toBe(paidAmount)
    expect(response.payment).toMatchObject({
      orderId,
      provider: 'VIRTUAL_CARD',
      status: 'READY',
      canceledAmount: 0,
      paymentKey: null,
      approvedAt: null,
      refunds: [],
    })
    // 아직 아무 돈도 움직이지 않았다. 결제사는 부르지 않는다.
    expect(virtualCard.calls).toEqual([])
  })

  it('answers in the shape the contract promises', async () => {
    const { orderId } = await placeOrder()

    const response = await payments().start(principal, orderId, 'VIRTUAL_CARD')

    // HTTP 를 거치지 않으므로 계약(C3)을 지켜 줄 클라이언트가 없다. 서비스가
    // `PaymentResponse` 를 반환한다고 선언한 이상, 그 약속은 여기서 확인한다 —
    // `approvedAt` 을 `Date` 로 흘려보내는 구현은 컨트롤러가 붙는 날에야 들킨다.
    expect(paymentResponseSchema.parse(response)).toEqual(response)
  })

  it('refuses to touch somebody else’s order or payment', async () => {
    const stranger = await createUser(db, {})
    const strangerCaller: TestCaller = { userId: stranger.id, roles: ['BUYER'] }
    const theirOrder = await placeOrder(strangerCaller)
    const mine = await startPayment()

    const strangerPrincipal: RequestPrincipal = {
      app: 'shop',
      userId: stranger.id,
      roles: ['BUYER'],
      sellerId: null,
    }

    // 남의 결제를 읽을 수 있으면 주문 금액과 결제 이력이 통째로 새어 나간다.
    expect((await refusal(payments().get(strangerPrincipal, mine.paymentId))).status).toBe(403)
    // 시작은 「없다」로 답한다 — 남의 주문 번호를 넣어 본 사람에게 그 주문이
    // 있는지 없는지를 알려 줄 이유가 없다 (주문의 `ORDER_ADDRESS_MISSING` 과 같은
    // 판단이다).
    expect(
      (await refusal(payments().start(principal, theirOrder.orderId, 'VIRTUAL_CARD'))).status,
    ).toBe(404)
  })
})

describe('레지스트리 (F1)', () => {
  it('sends the call to the implementation the payment named', async () => {
    const throughToss = await startPayment('TOSS')

    await payments().authorize(principal, throughToss.paymentId)

    expect(toss.callsTo('authorize')).toHaveLength(1)
    // 가상 카드는 한 마디도 듣지 않았다. 여기서 갈리지 않으면 토스 결제가 우리
    // 장부에만 남고 결제사에는 도착하지 않는다 — 「돈이 안 빠졌는데 주문은 됐다」다.
    expect(virtualCard.calls).toEqual([])

    const throughCard = await startPayment('VIRTUAL_CARD')

    await payments().authorize(principal, throughCard.paymentId)

    expect(virtualCard.callsTo('authorize')).toHaveLength(1)
    // 두 번째 결제가 토스로 새지도 않았다.
    expect(toss.callsTo('authorize')).toHaveLength(1)
  })

  it('gives each implementation its own key, so reconciliation can tell them apart', async () => {
    const throughToss = await authorized('TOSS')
    const throughCard = await authorized('VIRTUAL_CARD')

    const first = await read(throughToss.paymentId)
    const second = await read(throughCard.paymentId)

    expect(first.paymentKey).toBe(`TOSS-${throughToss.paymentId}`)
    expect(second.paymentKey).toBe(`VIRTUAL_CARD-${throughCard.paymentId}`)
  })

  it('throws for a provider nobody registered', () => {
    // 앱의 레지스트리에는 이 파일이 가짜 둘을 넣어 두었다. 「없을 때」를 재려면
    // 아무도 넣지 않은 레지스트리가 필요하다.
    const empty = new PaymentProviderRegistry()

    expect(empty.registered()).toEqual([])
    // 조용히 `undefined` 를 돌려주는 것이 최악이다 — 그 다음 줄은 아무것도 하지
    // 않고 성공하고, 주문은 결제된 것으로 남는다 (4.2).
    expect(() => empty.resolve('TOSS')).toThrow()
  })
})

describe('상태 전이 (F2)', () => {
  it('refuses a refund on a payment nobody has paid for', async () => {
    const { paymentId } = await startPayment()

    const refused = await refusal(payments().refund(principal, paymentId, 1_000, '변심'))

    // 현재 상태와 맞지 않는 요청이다 — 입력이 틀린 것이 아니라 세상이 그 상태가
    // 아니다. 예약 품절과 같은 성격이라 같은 409 다.
    expect(refused).toEqual({ status: 409, code: 'PAYMENT_TRANSITION_REFUSED' })
    expect(await read(paymentId)).toMatchObject({ status: 'READY', canceledAmount: 0 })
    expect(await refundRows(paymentId)).toEqual([])
    // **결제사에 나가지 않았다.** 거절할 것을 먼저 보내면 저쪽에는 환불이 남고
    // 우리 장부에는 남지 않는다.
    expect(virtualCard.callsTo('refund')).toEqual([])
    expect(await invariantsHold(paymentId)).toEqual({
      canceledAmount: 0,
      rowTotal: 0,
      withinAuthorized: true,
    })
  })

  it('refuses a capture before the card has approved anything', async () => {
    const { paymentId } = await startPayment()

    expect((await refusal(payments().capture(principal, paymentId))).status).toBe(409)
    expect((await read(paymentId)).status).toBe('READY')
    expect(virtualCard.callsTo('capture')).toEqual([])
  })

  it('captures once however many times the button is pressed', async () => {
    const { paymentId, amount } = await captured()

    const refused = await refusal(payments().capture(principal, paymentId))

    expect(refused.status).toBe(409)
    expect((await read(paymentId)).status).toBe('PAID')
    // 두 번 매입하면 저쪽에서 두 번 청구된다. 우리가 막지 않으면 아무도 안 막는다.
    expect(virtualCard.callsTo('capture').map((call) => call.amount)).toEqual([amount])
  })

  it('refuses a second authorization of the same payment', async () => {
    const { paymentId } = await authorized()

    expect((await refusal(payments().authorize(principal, paymentId))).status).toBe(409)
    expect((await read(paymentId)).status).toBe('AUTHORIZED')
    expect(virtualCard.callsTo('authorize')).toHaveLength(1)
  })

  it('leaves a declined payment finished, and refuses everything after it', async () => {
    virtualCard.approves = false

    const { paymentId } = await startPayment()

    // 거절은 예외가 아니라 값이다 (4.3). 한도 초과는 정상적인 대답이고, 서비스는
    // 그것을 상태로 옮겨 적을 뿐 던지지 않는다.
    const { payment } = await payments().authorize(principal, paymentId)

    expect(payment).toMatchObject({ status: 'FAILED', paymentKey: null, approvedAt: null })
    // `FAILED` 는 끝난 상태다. 여기서 매입이나 환불이 지나가면 승인된 적 없는
    // 결제에서 돈이 나간다.
    expect((await refusal(payments().capture(principal, paymentId))).status).toBe(409)
    expect((await refusal(payments().refund(principal, paymentId, 1_000, '변심'))).status).toBe(409)
    expect((await read(paymentId)).status).toBe('FAILED')
  })
})

describe('부분 환불 누적 (F3)', () => {
  it('records three refunds as three rows and one running total', async () => {
    const { paymentId, amount } = await captured()

    await payments().refund(principal, paymentId, 1_000, '사이즈가 안 맞아요')
    await payments().refund(principal, paymentId, 2_000, '색이 달라요')
    const { payment } = await payments().refund(principal, paymentId, 3_000, '배송이 늦었어요')

    expect(payment.canceledAmount).toBe(6_000)
    expect(payment.authorizedAmount).toBe(amount)
    // 잔액이 남아 있으므로 아직 끝이 아니다 — `PARTIAL_CANCELED` 는 종착지가 아니다.
    expect(payment.status).toBe('PARTIAL_CANCELED')
    // 금액으로 정렬해서 본다. 시험용 시계는 고정이라(`clock-injection.spec.ts`) 세
    // 환불의 `refundedAt` 이 전부 같고, 그때의 행 순서는 Postgres 가 정한다.
    // F3 이 묻는 것은 순서가 아니라 **세 건이 각자의 금액과 사유로 남았는가**다.
    expect(byAmount(await refundRows(paymentId))).toEqual([
      { amount: 1_000, reason: '사이즈가 안 맞아요' },
      { amount: 2_000, reason: '색이 달라요' },
      { amount: 3_000, reason: '배송이 늦었어요' },
    ])
    // 서비스가 돌려준 것과 표가 같은 이야기를 한다. 다르면 화면이 보는 숫자와
    // 대사가 보는 숫자가 갈린다.
    expect(byAmount(payment.refunds).map((refund) => refund.amount)).toEqual([1_000, 2_000, 3_000])
    // 결제사에는 순서까지 그대로 나갔다 — 세 번을 차례로 부른 것이므로 여기에는
    // 동률이 없다.
    expect(virtualCard.callsTo('refund').map((call) => call.amount)).toEqual([1_000, 2_000, 3_000])
  })

  it('closes the payment when the last won goes back', async () => {
    const { paymentId, amount } = await captured()

    await payments().refund(principal, paymentId, amount - 1, '거의 전부')
    const { payment } = await payments().refund(principal, paymentId, 1, '남은 1원')

    // 잔액이 0이 되는 순간에만 `CANCELED` 다. 부분 환불 한 번에 끝난 것으로
    // 바꿔 버리면 남은 금액을 아무도 환불할 수 없다.
    expect(payment.status).toBe('CANCELED')
    expect(payment.canceledAmount).toBe(amount)
    expect(await invariantsHold(paymentId)).toEqual({
      canceledAmount: amount,
      rowTotal: amount,
      withinAuthorized: true,
    })
  })
})

describe('초과 환불 (F4)', () => {
  it('refuses a refund larger than what was approved', async () => {
    const { paymentId, amount } = await captured()

    const refused = await refusal(
      payments().refund(principal, paymentId, amount + 10_000, '전액 이상'),
    )

    // 상태가 막은 거절과 **다른 코드**다. 하나는 「지금은 안 된다」이고 이것은
    // 「이만큼까지는 된다」라, 상담원에게 보여 줄 다음 행동이 다르다.
    expect(refused).toEqual({ status: 409, code: 'PAYMENT_REFUND_EXCEEDS' })
    expect(await invariantsHold(paymentId)).toEqual({
      canceledAmount: 0,
      rowTotal: 0,
      withinAuthorized: true,
    })
    expect(virtualCard.callsTo('refund')).toEqual([])
  })

  it('refuses the one won that does not fit, and lets the exact remainder through', async () => {
    const { paymentId, amount } = await captured()

    await payments().refund(principal, paymentId, amount - 1_000, '대부분')

    // **1원만 넘겨도 거절이다.** `>` 와 `>=` 를 바꿔 쓴 구현은 큰 금액으로만
    // 시험하면 통과한다 — 실제로 새는 것은 언제나 이 한 칸이다.
    const refused = await refusal(payments().refund(principal, paymentId, 1_001, '1원 초과'))

    expect(refused).toEqual({ status: 409, code: 'PAYMENT_REFUND_EXCEEDS' })
    expect((await read(paymentId)).canceledAmount).toBe(amount - 1_000)
    expect(await refundRows(paymentId)).toHaveLength(1)

    // 그리고 정확히 남은 만큼은 지나간다. 이 줄이 없으면 위의 거절이 「1원이
    // 넘어서」인지 「두 번째 환불이 그냥 막혀서」인지 구별되지 않는다.
    const { payment } = await payments().refund(principal, paymentId, 1_000, '남은 전부')

    expect(payment.canceledAmount).toBe(amount)
    expect(payment.status).toBe('CANCELED')
  })

  it('refuses a refund of nothing at all', async () => {
    const { paymentId } = await captured()

    // 0원 환불은 `Refund` 행만 늘리고 아무 돈도 옮기지 않는다. 표에도 같은 규칙이
    // 적혀 있다 (`Refund_amount_check`).
    //
    // 그리고 이것은 **400 이다.** 위의 두 거절과 달리 상태의 문제가 아니라 보낸
    // 값의 문제라, 부르는 쪽이 고쳐야 하는 것이 다르다.
    expect(await refusal(payments().refund(principal, paymentId, 0, '빈 환불'))).toEqual({
      status: 400,
      code: 'PAYMENT_REFUND_INVALID',
    })
    expect(await refundRows(paymentId)).toEqual([])
  })
})

describe('이벤트 기록 (F5)', () => {
  it('leaves one row per state change, and the rows chain together', async () => {
    const { paymentId, amount } = await captured()

    await payments().refund(principal, paymentId, 1_000, '일부')
    await payments().refund(principal, paymentId, amount - 1_000, '나머지')

    const events = await eventRows(paymentId)

    // 요청 · 승인 · 매입 · 부분환불 · 전액환불 = 다섯.
    expect(events).toHaveLength(5)
    expect(events[0]?.kind).toBe('REQUESTED')
    expect(events.slice(1, 3).map((event) => event.kind)).toEqual(['AUTHORIZED', 'CAPTURED'])
    // **앞 행의 도착지가 다음 행의 출발지다.** 이어지지 않는 로그는 분쟁에서
    // 「어디서 왔는지 모르겠다」로 끝나고, 그것이 이 표의 유일한 쓸모를 없앤다.
    expect(events.slice(1).map((event) => event.fromStatus)).toEqual([
      'READY',
      'AUTHORIZED',
      'PAID',
      'PARTIAL_CANCELED',
    ])
    expect(events.slice(1).map((event) => event.toStatus)).toEqual([
      'AUTHORIZED',
      'PAID',
      'PARTIAL_CANCELED',
      'CANCELED',
    ])
    // 전후는 둘 다 있거나 둘 다 없다 (`PaymentEvent_transition_check`).
    expect(events.every((event) => (event.fromStatus === null) === (event.toStatus === null))).toBe(
      true,
    )
  })

  it('records a declined authorization as an event of its own', async () => {
    virtualCard.approves = false

    const { paymentId } = await startPayment()

    await payments().authorize(principal, paymentId)

    const events = await eventRows(paymentId)

    // 거절도 사건이다. 남기지 않으면 「승인을 시도한 적이 있는가」에 답할 수 없고,
    // 재시도가 몇 번째인지도 모른다.
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ kind: 'FAILED', fromStatus: 'READY', toStatus: 'FAILED' })
  })

  it('has room for an event that changed nothing', async () => {
    const { paymentId } = await captured()
    const before = await eventRows(paymentId)

    // 웹훅은 TASK-0056 이라 여기서 부를 길이 없다. 그래도 **로그가 그것을 받을 수
    // 있다는 것**은 지금의 약속이다 (4.5) — 같은 웹훅이 두 번 오면 두 번째는 아무
    // 상태도 바꾸지 않지만, 왔다는 사실은 남아야 한다.
    await db.execute(
      `INSERT INTO "PaymentEvent" ("id", "paymentId", "kind", "payload")
       VALUES (gen_random_uuid(), $1, 'WEBHOOK', $2::jsonb)`,
      [paymentId, JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED' })],
    )

    expect(await eventRows(paymentId)).toHaveLength(before.length + 1)

    // 그리고 반쪽짜리 기록은 표가 거절한다 — 「PAID 에서 왔는데 어디로 갔는지는
    // 모른다」는 행은 읽는 사람에게 아무 말도 하지 않는다.
    await expect(
      db.execute(
        `INSERT INTO "PaymentEvent" ("id", "paymentId", "kind", "fromStatus")
         VALUES (gen_random_uuid(), $1, 'WEBHOOK', 'PAID')`,
        [paymentId],
      ),
    ).rejects.toThrow(/PaymentEvent_transition_check/)
  })
})

describe('동시 환불 (F6 · A7)', () => {
  it('refuses the second of two overlapping refunds that cannot both fit', async () => {
    const { paymentId, amount } = await captured()
    // 각자 혼자서는 되고 **둘이 함께는 안 되는** 금액이다. 전액을 두 번 시도하면
    // 둘째는 「끝난 결제」라서 지고, 그러면 이 검사가 재는 것은 종착 상태의 검사이지
    // 누계의 상한이 아니다 — F6 이 묻는 것은 후자다.
    const most = amount - 1_000

    // **겹침은 배열한 것이지 바란 것이 아니다** (`concurrently.ts` 의 주석). 장벽이
    // 둘을 같은 순간에 출발시키고, 첫 환불은 데이터베이스가 「누가 잠금을 기다리고
    // 있다」고 말해 줄 때까지 결제사에 머문다. 그 확인이 없으면 두 호출이 차례로
    // 지나간 날에도 이 검사는 초록이다.
    virtualCard.refundHold = untilAnotherTransactionWaits

    // 둘인 이유는 시험용 앱의 풀이 5이기 때문이다 (`test/support/app-config.ts`).
    const gate = barrier(2)
    const results = await concurrently(2, async (index) => {
      await gate.arrive()

      return payments().refund(principal, paymentId, most, `동시 환불 ${String(index)}`)
    })

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results)).toHaveLength(1)
    // 진 쪽은 **금액에서** 졌다. 결제는 아직 `PARTIAL_CANCELED` 로 살아 있으므로
    // 상태가 막아 준 것이 아니다 — 둘이 각자 「아직 여유가 있다」를 읽었다면 여기서
    // 통과했을 요청이다.
    expect(refusalOf(rejected(results)[0])).toEqual({
      status: 409,
      code: 'PAYMENT_REFUND_EXCEEDS',
    })

    const payment = await read(paymentId)

    expect(payment).toMatchObject({ status: 'PARTIAL_CANCELED', canceledAmount: most })
    // 넘지 않았다. 이것이 F6 이 실제로 지키는 것이고, 「하나만 통과했다」는 그
    // 결과일 뿐이다.
    expect(payment.canceledAmount).toBeLessThanOrEqual(payment.authorizedAmount)
    expect(await invariantsHold(paymentId)).toEqual({
      canceledAmount: most,
      rowTotal: most,
      withinAuthorized: true,
    })
    expect(await refundRows(paymentId)).toHaveLength(1)
    // 결제사에도 한 번만 나갔다. 두 번 부르면 저쪽에서는 두 번 환불되고 우리
    // 장부에는 한 번만 남는다 — 대사에서 찾을 때는 이미 돈이 나간 뒤다.
    expect(virtualCard.callsTo('refund')).toHaveLength(1)
  })

  it('adds both up when the two of them fit together', async () => {
    const { paymentId, amount } = await captured()
    const each = Math.floor(amount / 3)

    // 같은 배열이다. 둘 다 통과하는 경우에도 겹쳤다는 것이 먼저 참이어야, 「둘 다
    // 들어갔다」가 직렬 실행의 당연한 결과가 아니게 된다.
    virtualCard.refundHold = untilAnotherTransactionWaits

    const gate = barrier(2)
    const results = await concurrently(2, async (index) => {
      await gate.arrive()

      return payments().refund(principal, paymentId, each, `동시 부분 ${String(index)}`)
    })

    // 둘 다 들어갈 자리가 있으므로 둘 다 통과해야 한다. 여기서 하나가 지면 상한이
    // 아니라 **직렬화**를 시험하고 있었던 것이다.
    expect(fulfilled(results)).toHaveLength(2)
    // 그리고 누계는 정확히 둘의 합이다. 각자 「0에서 시작해 each 를 더한」 구현은
    // 행 두 줄과 누계 한 몫을 남긴다 — 그 결제는 영원히 한 몫을 더 환불할 수 있다.
    expect(await invariantsHold(paymentId)).toEqual({
      canceledAmount: each * 2,
      rowTotal: each * 2,
      withinAuthorized: true,
    })
    expect(await refundRows(paymentId)).toHaveLength(2)
    expect((await read(paymentId)).status).toBe('PARTIAL_CANCELED')
  })
})
