import type {
  ApiClient,
  PaymentProviderName,
  PaymentStatus as SharedPaymentStatus,
} from '@shopping/shared'
import {
  cartResponseSchema,
  claimResponseSchema,
  claimTransitionResponseSchema,
  orderResponseSchema,
  returnResponseSchema,
} from '@shopping/shared'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { CLAIM_REFUND_GRACE_MS } from '../../src/claims/refund-retry.js'
import { ClaimRefundRetryService } from '../../src/claims/refund-retry.service.js'
import { ClaimRefundService } from '../../src/claims/refund.service.js'
import type {
  AuthorizeRequest,
  AuthorizeResult,
  PaymentProviderPort,
} from '../../src/payment/payment-provider.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import { PointsService } from '../../src/points/points.service.js'
import { useApiApp } from '../support/api-app.js'
import { fixedClock } from '../support/clock.js'
import { concurrently, fulfilled } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createProduct,
  createCoupon,
  createProductVariant,
  createSeller,
  createUserCoupon,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 환불의 **실행** (TASK-0068), 이 워커의 실제 데이터베이스에 대고.
 *
 * 계산이 옳은지는 `refund-calc.spec.ts` 와 `refund-plan.spec.ts` 가 순수 함수로
 * 잰다. **여기서 재는 것은 그 계산이 실제 행과 실제 결제에 적용되는가**이고, 이
 * TASK 의 완료 기준이 전부 숫자라 단언도 전부 숫자다.
 *
 * | 무엇을 | 왜 그것이 증거인가 |
 * | --- | --- |
 * | 전량 취소의 합계 = 실결제금액 | 쿠폰·적립금이 안분된 주문에서 **1원도 사라지지 않는다** |
 * | 한 항목을 하나씩 나눠 환불한 합계 = 그 항목의 순액 | 누적 계산의 요점. 따로 반올림하면 여기서 1원이 준다 |
 * | 누계가 승인액을 넘지 않는다 | `Payment_canceledAmount_check` 이 마지막 줄이고, 그 앞을 우리가 지킨다 |
 * | 배송비 네 줄 | 특히 **무료배송이었다가 문턱이 무너지는** 경우 |
 * | 실패하면 `REFUNDED` 로 안 간다 · 재시도가 푼다 | 실패한 환불은 아무 오류도 내지 않는다 |
 * | 두 번 불려도 한 번만 | 열쇠는 클레임의 id 다 |
 *
 * **결제사만 대역이다** (QUALITY-GATES 6장). 데이터베이스도 결제 서비스도 클레임
 * 서비스도 실제이고, 바꿔 끼우는 것은 「저쪽이 뭐라고 답하는가」뿐이다 — 환불 실패를
 * 만들 수 있는 유일한 자리이기도 하다.
 */

/**
 * 대본대로 답하는 결제사. `payments.integration.spec.ts` 의 것과 같은 모양이고,
 * **환불을 실패시키는 스위치 하나**가 더 있다.
 */
class ScriptedProvider implements PaymentProviderPort {
  readonly name: PaymentProviderName = 'VIRTUAL_CARD'
  readonly refunds: { readonly paymentKey: string; readonly amount: number }[] = []
  /** 다음 환불이 실패한다. 재시도 경로를 만드는 유일한 길이다. */
  failRefund = false

  reset(): void {
    this.refunds.length = 0
    this.failRefund = false
  }

  authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    return Promise.resolve({ outcome: 'approved', paymentKey: `card-${request.paymentId}` })
  }

  capture(): Promise<void> {
    return Promise.resolve()
  }

  cancel(): Promise<void> {
    return Promise.resolve()
  }

  refund(paymentKey: string, amount: number): Promise<void> {
    if (this.failRefund) return Promise.reject(new Error('결제사가 환불을 거절했습니다'))

    this.refunds.push({ paymentKey, amount })

    return Promise.resolve()
  }

  recover(paymentId: string): Promise<AuthorizeResult> {
    return Promise.resolve({ outcome: 'approved', paymentKey: `card-${paymentId}` })
  }

  getStatus(): Promise<SharedPaymentStatus> {
    return Promise.resolve('PAID')
  }
}

const provider = new ScriptedProvider()

const db = useDatabase()
const clock = fixedClock('2026-09-03T00:00:00.000Z')
const api = useApiApp({ database: db, authenticate: true, clock })

let buyer: TestCaller
let principal: RequestPrincipal
let addressId: string
let categoryId: number

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function payments(): PaymentService {
  return api.resolve<PaymentService>(PaymentService)
}

function refunds(): ClaimRefundService {
  return api.resolve<ClaimRefundService>(ClaimRefundService)
}

function retry(): ClaimRefundRetryService {
  return api.resolve<ClaimRefundRetryService>(ClaimRefundRetryService)
}

beforeAll(() => {
  // 앱이 뜬 **뒤**다. 레지스트리는 앱의 것이라 이 등록은 파일이 끝날 때까지 산다.
  api.resolve<PaymentProviderRegistry>(PaymentProviderRegistry).register(provider)
})

beforeEach(async () => {
  provider.reset()
  clock.set('2026-09-03T00:00:00.000Z')

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  principal = { app: 'shop', userId: account.id, roles: ['BUYER'], sellerId: null }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

interface PlacedItem {
  readonly id: string
  readonly quantity: number
  readonly productAmount: number
}

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly seller: TestCaller
  readonly items: readonly PlacedItem[]
  /** 이 몫에 **실제로 부과된** 배송비. 무료배송 조건을 넘겼으면 0 이다. */
  readonly shippingFee: number
}

interface PlaceOptions {
  readonly lines: readonly { readonly price: number; readonly quantity: number }[]
  readonly shippingFee?: number
  readonly freeShippingThreshold?: number | null
}

/**
 * 판매자 몫 하나. **배송비 정책을 주문 전에 세운다** — 주문이 그것을 읽어 배송비를
 * 정하고, 그 결과가 곧 환불이 되돌려야 할 값이다.
 */
async function place(options: PlaceOptions): Promise<Placed> {
  const owner = await createUser(db, {})
  const store = await createSeller(db, { userId: owner.id })

  await db.query(
    `UPDATE "Seller" SET "shippingFee" = $2, "freeShippingThreshold" = $3 WHERE "id" = $1`,
    [store.id, options.shippingFee ?? 3_000, options.freeShippingThreshold ?? null],
  )

  const itemIds: string[] = []

  for (const line of options.lines) {
    const product = await createProduct(db, {
      sellerId: store.id,
      categoryId,
      status: 'ACTIVE',
      minPrice: line.price,
    })
    const variant = await createProductVariant(db, {
      productId: product.id,
      sellerId: store.id,
      price: line.price,
      stock: 50,
      isActive: true,
    })
    const cart = await client().request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId: variant.id, quantity: line.quantity },
      schema: cartResponseSchema,
    })
    const row = cart.groups.flatMap((group) => group.items).find((i) => i.variantId === variant.id)

    if (row === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

    itemIds.push(row.id)
  }

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId },
    schema: orderResponseSchema,
  })
  const bundle = order.sellerOrders.at(0)

  if (bundle === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  return {
    orderId: order.id,
    sellerOrderId: bundle.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id },
    // 상품금액 오름차순. 어느 줄이 어느 줄인지가 실행 순서에 흔들리지 않게 한다.
    items: await db.query<PlacedItem>(
      `SELECT "id", "quantity", "productAmount" FROM "OrderItem"
        WHERE "sellerOrderId" = $1 ORDER BY "productAmount", "id"`,
      [bundle.id],
    ),
    shippingFee: bundle.shippingFee,
  }
}

/**
 * 쿠폰·적립금을 **항목까지 안분해 둔** 주문으로 만든다.
 *
 * M11 이 오기 전이라 주문 API 에는 쿠폰이 없다. 그래도 안분된 주문으로 재야 하는
 * 이유가 이 TASK 의 요점이다 — 「1원이 사라지지 않는다」는 할인이 나뉘어 있을 때만
 * 증명되는 성질이고, 할인이 0이면 어떤 반올림도 일어나지 않는다.
 *
 * 합계는 항목에서 **다시 만든다.** 손으로 적으면 그 숫자가 안분의 합과 어긋날 수
 * 있고, 그때 이 스펙은 자기가 만든 오류를 재게 된다.
 */
async function allocate(
  placed: Placed,
  lines: readonly { readonly itemId: string; readonly coupon: number; readonly point: number }[],
): Promise<void> {
  for (const line of lines) {
    await db.query(
      `UPDATE "OrderItem"
          SET "couponDiscountAmount" = $2::int, "pointDiscountAmount" = $3::int,
              "discountAmount" = $2::int + $3::int
        WHERE "id" = $1`,
      [line.itemId, line.coupon, line.point],
    )
  }

  await db.query(
    `UPDATE "SellerOrder" so
        SET "couponDiscountAmount" = agg.coupon,
            "pointDiscountAmount" = agg.point,
            "paidAmount" = so."productAmount" + so."shippingFee" - agg.coupon - agg.point
       FROM (SELECT "sellerOrderId",
                    sum("couponDiscountAmount")::int AS coupon,
                    sum("pointDiscountAmount")::int AS point
               FROM "OrderItem" GROUP BY "sellerOrderId") agg
      WHERE so."id" = agg."sellerOrderId" AND so."orderId" = $1`,
    [placed.orderId],
  )
  await db.query(
    `UPDATE "Order" o
        SET "totalCouponDiscountAmount" = agg.coupon,
            "totalPointDiscountAmount" = agg.point,
            "paidAmount" = agg.paid
       FROM (SELECT "orderId",
                    sum("couponDiscountAmount")::int AS coupon,
                    sum("pointDiscountAmount")::int AS point,
                    sum("paidAmount")::int AS paid
               FROM "SellerOrder" GROUP BY "orderId") agg
      WHERE o."id" = agg."orderId" AND o."id" = $1`,
    [placed.orderId],
  )
}

/** 매입까지. 여기서부터가 환불을 시험할 수 있는 자리다. */
async function pay(placed: Placed): Promise<{ paymentId: string; paidAmount: number }> {
  const { payment } = await payments().start(principal, placed.orderId, 'VIRTUAL_CARD')

  await payments().authorize(principal, payment.id)
  await payments().capture(principal, payment.id)

  return { paymentId: payment.id, paidAmount: payment.authorizedAmount }
}

/** 취소를 신청한다. `PAID` 인 몫이라 규칙이 그 자리에서 승인하고 환불이 뒤따른다. */
function cancel(
  placed: Placed,
  lines: readonly { readonly orderItemId: string; readonly quantity: number }[],
) {
  return client().request({
    path: '/claims',
    method: 'POST',
    body: {
      sellerOrderId: placed.sellerOrderId,
      items: lines,
      reason: '주문을 잘못 넣었어요.',
      fault: 'CUSTOMER',
    },
    schema: claimResponseSchema,
  })
}

interface PaymentRow {
  readonly status: string
  readonly authorizedAmount: number
  readonly canceledAmount: number
}

function paymentRow(paymentId: string): Promise<PaymentRow> {
  return db.one<PaymentRow>(
    `SELECT "status"::text AS "status", "authorizedAmount", "canceledAmount"
       FROM "Payment" WHERE "id" = $1`,
    [paymentId],
  )
}

function refundRows(paymentId: string) {
  return db.query<{ amount: number; reason: string }>(
    `SELECT "amount", "reason" FROM "Refund" WHERE "paymentId" = $1
      ORDER BY "refundedAt", "id"`,
    [paymentId],
  )
}

interface ClaimRefundRow {
  readonly itemsAmount: number
  readonly shippingAmount: number
  readonly amount: number
  readonly refundedAt: Date | null
  readonly attempts: number
  readonly lastError: string | null
}

function claimRefundRow(claimId: string): Promise<ClaimRefundRow> {
  return db.one<ClaimRefundRow>(
    `SELECT "itemsAmount", "shippingAmount", "amount", "refundedAt", "attempts", "lastError"
       FROM "ClaimRefund" WHERE "claimId" = $1`,
    [claimId],
  )
}

function claimStatus(claimId: string): Promise<{ status: string }> {
  return db.one<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "ClaimRequest" WHERE "id" = $1`,
    [claimId],
  )
}

/**
 * 이 클레임이 **환불을 기다리기 시작한** 시각.
 *
 * `AT TIME ZONE 'UTC'` 로 꺼내는 이유는 컬럼이 `timestamp without time zone` 이라
 * 그냥 읽으면 드라이버가 로컬 시간대로 해석하기 때문이다. 몇 시간이 밀리면 유예가
 * 지났는지 아닌지가 이 기계의 시간대에 달리게 된다.
 */
async function waitingSince(claimId: string): Promise<Date> {
  const row = await db.one<{ at: Date }>(
    `SELECT ("updatedAt" AT TIME ZONE 'UTC') AS "at" FROM "ClaimRequest" WHERE "id" = $1`,
    [claimId],
  )

  return row.at
}

describe('전량 취소 — 1원도 사라지지 않는다', () => {
  it('refunds exactly what the buyer paid, on an order with coupons and points spread across lines', async () => {
    // 배송비 3,000원이 붙는 가게(무료 조건 없음). 두 줄에 쿠폰과 적립금이 안분돼
    // 있고, 한 줄은 수량이 3이라 나누어떨어지지 않는다.
    const placed = await place({
      lines: [
        { price: 10_000, quantity: 3 },
        { price: 20_000, quantity: 1 },
      ],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [small, large] = placed.items

    if (small === undefined || large === undefined) throw new Error('항목을 찾지 못했습니다.')

    await allocate(placed, [
      { itemId: large.id, coupon: 3_000, point: 2_000 },
      { itemId: small.id, coupon: 2_000, point: 1_000 },
    ])

    const { paymentId, paidAmount } = await pay(placed)

    expect(paidAmount).toBe(50_000 + 3_000 - 5_000 - 3_000)

    const { claim } = await cancel(placed, [
      { orderItemId: small.id, quantity: small.quantity },
      { orderItemId: large.id, quantity: large.quantity },
    ])

    expect(claim.status).toBe('REFUNDED')
    expect(await paymentRow(paymentId)).toEqual({
      status: 'CANCELED',
      authorizedAmount: paidAmount,
      canceledAmount: paidAmount,
    })
    expect(provider.refunds).toEqual([{ paymentKey: `card-${paymentId}`, amount: paidAmount }])
  })

  it('writes the share of each line onto the claim, and they add up to the payment', async () => {
    const placed = await place({
      lines: [
        { price: 10_000, quantity: 3 },
        { price: 20_000, quantity: 1 },
      ],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [small, large] = placed.items

    if (small === undefined || large === undefined) throw new Error('항목을 찾지 못했습니다.')

    await allocate(placed, [
      { itemId: large.id, coupon: 3_000, point: 2_000 },
      { itemId: small.id, coupon: 2_000, point: 1_000 },
    ])
    await pay(placed)

    const { claim } = await cancel(placed, [
      { orderItemId: small.id, quantity: small.quantity },
      { orderItemId: large.id, quantity: large.quantity },
    ])
    const record = await claimRefundRow(claim.id)

    // 항목 몫 42,000 + 배송비 3,000. 두 줄을 나눠 두는 것이 「배송비 3,000원 환불」을
    // 사람이 확인할 수 있게 하는 유일한 방법이다.
    expect(record).toMatchObject({ itemsAmount: 42_000, shippingAmount: 3_000, amount: 45_000 })
    // `ClaimItem.refundAmount` 는 스키마가 「아직 계산하지 않았다」로 남겨 둔 자리였다.
    expect(claim.items.map((item) => item.refundAmount).sort((a, b) => a - b)).toEqual([
      17_000, 25_000,
    ])
  })
})

describe('나눠 환불한 합계', () => {
  it('splits one line three ways and still returns the whole line', async () => {
    // 25,000원짜리 순액을 세 번에 나눈다. 매번 따로 반올림하면 24,999원이 된다.
    const placed = await place({
      lines: [{ price: 10_000, quantity: 3 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    await allocate(placed, [{ itemId: only.id, coupon: 3_000, point: 2_000 }])

    const { paymentId, paidAmount } = await pay(placed)
    const amounts: number[] = []

    for (let unit = 0; unit < 3; unit += 1) {
      const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

      amounts.push((await claimRefundRow(claim.id)).itemsAmount)
    }

    expect(amounts).toEqual([8_333, 8_333, 8_334])
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(25_000)
    // 마지막 환불이 배송비까지 데려간다. 합계는 실결제금액과 정확히 같다.
    expect((await paymentRow(paymentId)).canceledAmount).toBe(paidAmount)
    expect((await refundRows(paymentId)).map((row) => row.amount)).toEqual([8_333, 8_333, 11_334])
  })

  it('refuses a refund that would push the total past what was authorized', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 0,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId, paidAmount } = await pay(placed)

    await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    expect((await paymentRow(paymentId)).canceledAmount).toBe(paidAmount)
    // 마지막 줄은 `Payment_canceledAmount_check` 이지만, 그 앞에서 판단이 먼저 막는다.
    await expect(payments().refund(principal, paymentId, 1, '한 번 더')).rejects.toThrow()
  })
})

describe('배송비 네 줄', () => {
  it('gives the whole shipping fee back when the seller order empties out', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    expect(await claimRefundRow(claim.id)).toMatchObject({ shippingAmount: 3_000 })
  })

  it('adjusts nothing while what remains still clears the free-shipping threshold', async () => {
    const placed = await place({
      lines: [
        { price: 10_000, quantity: 1 },
        { price: 30_000, quantity: 1 },
      ],
      shippingFee: 3_000,
      freeShippingThreshold: 25_000,
    })
    const [small] = placed.items

    if (small === undefined) throw new Error('항목을 찾지 못했습니다.')
    // 40,000원어치라 무료배송이었다.
    expect(placed.shippingFee).toBe(0)

    await pay(placed)

    const { claim } = await cancel(placed, [{ orderItemId: small.id, quantity: 1 }])

    expect(await claimRefundRow(claim.id)).toMatchObject({ shippingAmount: 0, amount: 10_000 })
  })

  it('rebills the waived shipping once, and gives it back when the order empties', async () => {
    // **이 파일에서 가장 중요한 검사다.** 무료배송으로 산 3개를 하나씩 취소한다.
    // ① 첫 취소가 문턱을 무너뜨려 3,000원을 재부과하고 ② 두 번째는 이미 무너진
    // 문턱을 다시 무너뜨릴 수 없으며 ③ 마지막은 전량이 되면서 ①을 되돌린다.
    // 차분이 없으면 ③이 0이 되고, 전량 취소한 사람의 장부에서 3,000원이 사라진다.
    const placed = await place({
      lines: [{ price: 10_000, quantity: 3 }],
      shippingFee: 3_000,
      freeShippingThreshold: 25_000,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')
    expect(placed.shippingFee).toBe(0)

    const { paymentId, paidAmount } = await pay(placed)
    const adjustments: number[] = []

    for (let unit = 0; unit < 3; unit += 1) {
      const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

      adjustments.push((await claimRefundRow(claim.id)).shippingAmount)
    }

    expect(adjustments).toEqual([-3_000, 0, 3_000])
    expect((await paymentRow(paymentId)).canceledAmount).toBe(paidAmount)
  })

  it('never rebills shipping to someone who already paid it', async () => {
    // 재부과액은 「기본 배송비 − 이미 낸 배송비」다. 문턱에 못 미쳐 3,000원을 낸
    // 사람에게 또 3,000원을 물리면 배송비를 두 번 받는다.
    const placed = await place({
      lines: [
        { price: 10_000, quantity: 1 },
        { price: 11_000, quantity: 1 },
      ],
      shippingFee: 3_000,
      freeShippingThreshold: 25_000,
    })
    const [small] = placed.items

    if (small === undefined) throw new Error('항목을 찾지 못했습니다.')
    expect(placed.shippingFee).toBe(3_000)

    await pay(placed)

    const { claim } = await cancel(placed, [{ orderItemId: small.id, quantity: 1 }])

    expect(await claimRefundRow(claim.id)).toMatchObject({ shippingAmount: 0 })
  })
})

describe('멱등 — 두 번 불려도 한 번', () => {
  it('sends the money once when the same claim is settled twice', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId, paidAmount } = await pay(placed)
    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    // 열쇠는 클레임의 id 다. 두 번째 호출은 잠금 아래에서 `REFUNDED` 를 보고 물러난다.
    expect(await refunds().settle(claim.id)).toBe('settled')
    expect(await refunds().settle(claim.id)).toBe('settled')

    expect(provider.refunds).toHaveLength(1)
    expect(await refundRows(paymentId)).toHaveLength(1)
    expect((await paymentRow(paymentId)).canceledAmount).toBe(paidAmount)
    expect((await claimRefundRow(claim.id)).attempts).toBe(1)
  })

  it('sends the money once when two callers settle the same claim at the same time (A7)', async () => {
    // 겹친 두 인스턴스가 같은 클레임을 집어 오는 경우 — 재시도 배치의 어드바이저리
    // 락이 그것을 줄이지만, **막는 것은 락이 아니라 클레임 행 잠금**이다. 늦게 온
    // 쪽은 잠금을 기다렸다가 `REFUNDED` 를 보고 물러난다.
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId, paidAmount } = await pay(placed)

    // 인라인 환불을 한 번 실패시켜 「승인됐지만 아직 안 나간」 자리를 만든다.
    provider.failRefund = true

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    provider.failRefund = false

    const outcomes = fulfilled(await concurrently(2, () => refunds().settle(claim.id)))

    expect([...outcomes].sort()).toEqual(['refunded', 'settled'])
    expect(provider.refunds).toHaveLength(1)
    expect(await refundRows(paymentId)).toHaveLength(1)
    expect((await paymentRow(paymentId)).canceledAmount).toBe(paidAmount)
  })

  it('leaves a claim that cannot reach REFUNDED alone', async () => {
    // 승인 대기 중인 클레임이다. 배치가 유예를 지나 집어 온 뒤 사람이 거절하는 것도
    // 같은 자리에 온다 — 손댈 것이 없다는 답이 옳고, 실패로 세면 안 된다.
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 0,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    await db.query(
      `UPDATE "SellerOrder" SET "status" = 'PREPARING'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    expect(claim.status).toBe('CANCEL_REQUESTED')
    expect(await refunds().settle(claim.id)).toBe('ignored')
    expect(provider.refunds).toHaveLength(0)
  })
})

describe('실패와 재시도', () => {
  it('does not move the claim to REFUNDED when the provider refuses', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId } = await pay(placed)

    provider.failRefund = true

    // 승인 자체는 던지지 않는다 — 환불에 실패한 것이 승인을 되돌릴 이유는 아니다.
    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    expect(claim.status).toBe('CANCEL_APPROVED')
    // 트랜잭션째 롤백됐으므로 결제도 환불 행도 그대로다.
    expect(await paymentRow(paymentId)).toMatchObject({ status: 'PAID', canceledAmount: 0 })
    expect(await refundRows(paymentId)).toHaveLength(0)

    // **실패는 남는다.** 없으면 이 클레임은 「승인됐는데 안 움직인 행」으로만 보인다.
    expect(await claimRefundRow(claim.id)).toMatchObject({
      refundedAt: null,
      attempts: 1,
      lastError: '결제사가 환불을 거절했습니다',
    })
  })

  it('leaves a claim inside the grace to the request that just approved it', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 0,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    provider.failRefund = true

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    clock.set(new Date((await waitingSince(claim.id)).getTime() + 1_000))

    expect(await retry().sweep()).toMatchObject({ refunded: 0, failed: 0, skipped: false })
  })

  it('retries once the grace has passed, and the money goes out exactly once', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId, paidAmount } = await pay(placed)

    provider.failRefund = true

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    provider.failRefund = false
    clock.set(new Date((await waitingSince(claim.id)).getTime() + CLAIM_REFUND_GRACE_MS + 1_000))

    expect(await retry().sweep()).toMatchObject({ refunded: 1, failed: 0 })
    expect(await claimStatus(claim.id)).toEqual({ status: 'REFUNDED' })
    expect((await paymentRow(paymentId)).canceledAmount).toBe(paidAmount)
    expect(provider.refunds).toEqual([{ paymentKey: `card-${paymentId}`, amount: paidAmount }])
    // 두 번째 시도가 성공했다는 사실이 남는다. 사유는 지워진다 — 성공한 행에 오류가
    // 적혀 있으면 읽는 사람이 무엇을 믿어야 할지 모른다.
    expect(await claimRefundRow(claim.id)).toMatchObject({ attempts: 2, lastError: null })

    // 다음 주기는 아무것도 찾지 못한다.
    expect(await retry().sweep()).toMatchObject({ refunded: 0, settled: 0 })
    expect(provider.refunds).toHaveLength(1)
  })

  it('records how long it has been failing so a person can find it', async () => {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 0,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    provider.failRefund = true

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    clock.set(new Date((await waitingSince(claim.id)).getTime() + CLAIM_REFUND_GRACE_MS + 1_000))

    expect(await retry().sweep()).toMatchObject({ failed: 1, refunded: 0 })
    expect(await claimRefundRow(claim.id)).toMatchObject({ attempts: 2, refundedAt: null })
    // 배치가 돈 사실은 남는다. 「멈췄는가」를 묻는 유일한 자리다.
    expect(await retry().lastRunAt()).not.toBeNull()
    expect(await retry().lastFixed()).toBe(0)
  })
})

describe('제약이 실제로 강제되는가 (S5)', () => {
  /** 환불을 기다리는 클레임 하나. 아래 세 검사가 그 위에 잘못된 행을 써 본다. */
  async function pending(): Promise<{ claimId: string; paymentId: string }> {
    const placed = await place({
      lines: [{ price: 10_000, quantity: 1 }],
      shippingFee: 0,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId } = await pay(placed)

    provider.failRefund = true

    const { claim } = await cancel(placed, [{ orderItemId: only.id, quantity: 1 }])

    // 실패 기록이 이미 한 줄 있다. 그 행을 고치려는 시도가 아래 검사들이다.
    await db.query(`DELETE FROM "ClaimRefund" WHERE "claimId" = $1`, [claim.id])

    return { claimId: claim.id, paymentId }
  }

  it('refuses a second refund record for one claim', async () => {
    // 기본키가 `claimId` 그 자체인 것이 멱등의 마지막 겹이다. 애플리케이션이
    // 실수해도 두 번째 환불 **기록**은 존재할 수 없다.
    const { claimId, paymentId } = await pending()
    const write = (): Promise<unknown> =>
      db.query(
        `INSERT INTO "ClaimRefund" ("claimId", "paymentId", "amount", "updatedAt")
         VALUES ($1, $2, 0, now())`,
        [claimId, paymentId],
      )

    await write()
    await expect(write()).rejects.toThrow()
  })

  it('refuses a total that does not follow from the two parts', async () => {
    // `max(0, 항목 몫 + 배송비 조정)` 이 `refundBreakdown` 의 결론이다. 세 숫자가
    // 어긋난 행은 「얼마를 왜 돌려줬나」에 답하지 못한다.
    const { claimId, paymentId } = await pending()

    await expect(
      db.query(
        `INSERT INTO "ClaimRefund"
           ("claimId", "paymentId", "itemsAmount", "shippingAmount", "amount", "updatedAt")
         VALUES ($1, $2, 10000, -3000, 10000, now())`,
        [claimId, paymentId],
      ),
    ).rejects.toThrow()
  })

  it('refuses a settled refund that names no payment', async () => {
    // 돈이 나갔는데 어느 결제인지 모르는 행은 대사할 수 없다.
    const { claimId } = await pending()

    await expect(
      db.query(
        `INSERT INTO "ClaimRefund" ("claimId", "amount", "refundedAt", "updatedAt")
         VALUES ($1, 0, now(), now())`,
        [claimId],
      ),
    ).rejects.toThrow()
  })
})

describe('반품', () => {
  /** 배송완료로 두고 반품 기간 안에 세운다. `deliveredAt` 은 상태 이력이 답한다. */
  async function deliver(placed: Placed): Promise<void> {
    await db.query(
      `UPDATE "SellerOrder" SET "status" = 'DELIVERED'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )
    await db.query(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "actorId", "createdAt")
       VALUES (gen_random_uuid(), $1, 'SHIPPED', 'DELIVERED', 'SYSTEM', NULL,
               ($2::timestamptz AT TIME ZONE 'UTC'))`,
      [placed.sellerOrderId, clock.now()],
    )
  }

  /** 신청 → 승인 → 수거 → 입고 → 검수 합격. 합격이 곧 환불의 계기다. */
  async function returned(
    placed: Placed,
    item: PlacedItem,
    returnReason: 'DEFECTIVE' | 'CHANGE_OF_MIND',
  ): Promise<string> {
    const { claim } = await client().request({
      path: '/returns',
      method: 'POST',
      body: {
        sellerOrderId: placed.sellerOrderId,
        items: [{ orderItemId: item.id, quantity: item.quantity }],
        reason: '받아 보니 박음질이 터져 있어요.',
        return: {
          returnReason,
          photoKeys:
            returnReason === 'CHANGE_OF_MIND'
              ? []
              : [`returns/${buyer.userId}/00000001-0000-4000-8000-000000000000.jpg`],
        },
      },
      schema: returnResponseSchema,
    })

    for (const to of ['RETURN_APPROVED'] as const) {
      await client(placed.seller).request({
        path: `/claims/${claim.id}/transitions`,
        method: 'POST',
        body: { to },
        schema: claimTransitionResponseSchema,
      })
    }

    await client(placed.seller).request({
      path: `/returns/${claim.id}/pickup`,
      method: 'POST',
      body: {},
      schema: returnResponseSchema,
    })
    await client(placed.seller).request({
      path: `/claims/${claim.id}/transitions`,
      method: 'POST',
      body: { to: 'INSPECTING' },
      schema: claimTransitionResponseSchema,
    })
    await client(placed.seller).request({
      path: `/returns/${claim.id}/inspection`,
      method: 'POST',
      body: { passed: true, note: null },
      schema: returnResponseSchema,
    })

    return claim.id
  }

  it('gives the original shipping back when the seller is at fault', async () => {
    const placed = await place({
      lines: [{ price: 20_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId } = await pay(placed)

    await deliver(placed)

    const claimId = await returned(placed, only, 'DEFECTIVE')

    expect(await claimStatus(claimId)).toEqual({ status: 'REFUNDED' })
    // 「배송비·반품비 모두 판매자 부담, 구매자에게 전액 환불」이 `pricing.md` 의 문장이다.
    expect(await claimRefundRow(claimId)).toMatchObject({
      itemsAmount: 20_000,
      shippingAmount: 3_000,
      amount: 23_000,
    })
    expect((await paymentRow(paymentId)).canceledAmount).toBe(23_000)
  })

  it('deducts the return shipping from a change of mind', async () => {
    const placed = await place({
      lines: [{ price: 20_000, quantity: 1 }],
      shippingFee: 3_000,
      freeShippingThreshold: null,
    })
    const [only] = placed.items

    if (only === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { paymentId } = await pay(placed)

    await deliver(placed)

    const claimId = await returned(placed, only, 'CHANGE_OF_MIND')

    // 원 배송비는 돌려주지 않고(물건은 실제로 배송됐다) 회수 운송비를 뺀다.
    expect(await claimRefundRow(claimId)).toMatchObject({
      itemsAmount: 20_000,
      shippingAmount: -3_000,
      amount: 17_000,
    })
    expect((await paymentRow(paymentId)).canceledAmount).toBe(17_000)
  })

  /**
   * **구매확정으로 나간 적립금을 되가져온다** (TASK-0078 F5).
   *
   * 지급이 있었는지는 상태가 아니라 **원장이 답한다** — 확정이 적립을 남겼다면 그
   * 몫을 가리키는 `EARN` 행이 있고, 상태는 그 사이에 이미 옮겨졌을 수 있다.
   */
  it('구매확정으로 지급된 적립금을 반품에서 회수한다 (F5)', async () => {
    const placed = await place({ lines: [{ price: 100_000, quantity: 1 }], shippingFee: 0 })
    const only = placed.items[0]

    if (only === undefined) throw new Error('항목이 없습니다.')

    await pay(placed)
    await deliver(placed)

    // 확정이 하는 일 그대로. 이 몫을 가리키는 `EARN` 한 줄이 남는다.
    const earned = await api.resolve<PointsService>(PointsService).earn({
      userId: buyer.userId,
      paidAmount: 100_000,
      refType: 'SELLER_ORDER',
      refId: placed.sellerOrderId,
    })

    expect(earned?.amount).toBeGreaterThan(0)

    await returned(placed, only, 'DEFECTIVE')

    const rows = await db.query<{ type: string; amount: number; reason: string | null }>(
      `SELECT t."type"::text AS "type", t."amount", t."reason"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1 ORDER BY t."seq" DESC`,
      [buyer.userId],
    )

    // 양방향인 유일한 종류라 이유를 말해야 한다.
    expect(rows[0]?.type).toBe('ADJUST')
    expect(rows[0]?.amount).toBe(-(earned?.amount ?? 0))
    expect(rows[0]?.reason).toContain('회수')

    const balance = await db.one<{ balance: number }>(
      `SELECT "balance" FROM "PointAccount" WHERE "userId" = $1`,
      [buyer.userId],
    )

    expect(balance.balance).toBe(0)
  })

  /**
   * **음수 잔액을 만들지 않는다** (F6).
   *
   * 이미 써 버린 적립금은 되가져올 수 없다. 잔액을 마이너스로 두면 그 사람은 다음에
   * 적립받는 만큼을 잃는데, 그 사실을 아무 화면도 설명하지 못한다 — 못 가져온 몫은
   * 이유에 적혀 남고, 그것이 관리자가 볼 자리다.
   */
  it('적립금을 이미 썼으면 있는 만큼만 가져가고 음수가 되지 않는다 (F6)', async () => {
    const placed = await place({ lines: [{ price: 100_000, quantity: 1 }], shippingFee: 0 })
    const only = placed.items[0]

    if (only === undefined) throw new Error('항목이 없습니다.')

    await pay(placed)
    await deliver(placed)

    const points = api.resolve<PointsService>(PointsService)
    const earned = await points.earn({
      userId: buyer.userId,
      paidAmount: 100_000,
      refType: 'SELLER_ORDER',
      refId: placed.sellerOrderId,
    })
    const given = earned?.amount ?? 0

    // 받은 것의 대부분을 다른 주문에 써 버린다.
    await points.use({
      userId: buyer.userId,
      amount: given - 1,
      refType: 'ORDER',
      refId: placed.orderId,
    })

    await returned(placed, only, 'DEFECTIVE')

    const balance = await db.one<{ balance: number }>(
      `SELECT "balance" FROM "PointAccount" WHERE "userId" = $1`,
      [buyer.userId],
    )
    const rows = await db.query<{ type: string; amount: number; reason: string | null }>(
      `SELECT t."type"::text AS "type", t."amount", t."reason"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1 AND t."type" = 'ADJUST' ORDER BY t."seq" DESC`,
      [buyer.userId],
    )

    expect(balance.balance).toBe(0)
    expect(rows[0]?.amount).toBe(-1)
    expect(rows[0]?.reason).toContain('잔액 부족')

    // **그리고 숫자로도 선다.** 이유는 문장이라 「회수 실패 목록」을 만들 수 없다.
    const record = await db.one<{ pointClawbackShortfall: number }>(
      `SELECT r."pointClawbackShortfall"
         FROM "ClaimRefund" r
         JOIN "ClaimRequest" c ON c."id" = r."claimId"
        WHERE c."sellerOrderId" = $1`,
      [placed.sellerOrderId],
    )

    expect(record.pointClawbackShortfall).toBe(given - 1)
  })

  /**
   * **하나도 못 가져간 경우가 원장에 남지 않는 자리다.** 움직인 돈이 0원이라 쓸 수
   * 있는 행이 없고(0원짜리 사건은 사건이 아니다), 그래서 이 칸이 있다.
   */
  it('하나도 회수하지 못해도 그 사실이 숫자로 남는다 (F6)', async () => {
    const placed = await place({ lines: [{ price: 100_000, quantity: 1 }], shippingFee: 0 })
    const only = placed.items[0]

    if (only === undefined) throw new Error('항목이 없습니다.')

    await pay(placed)
    await deliver(placed)

    const points = api.resolve<PointsService>(PointsService)
    const earned = await points.earn({
      userId: buyer.userId,
      paidAmount: 100_000,
      refType: 'SELLER_ORDER',
      refId: placed.sellerOrderId,
    })
    const given = earned?.amount ?? 0

    await points.use({
      userId: buyer.userId,
      amount: given,
      refType: 'ORDER',
      refId: placed.orderId,
    })

    await returned(placed, only, 'DEFECTIVE')

    const adjustments = await db.query(
      `SELECT t."id" FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1 AND t."type" = 'ADJUST'`,
      [buyer.userId],
    )
    const record = await db.one<{ pointClawbackShortfall: number }>(
      `SELECT r."pointClawbackShortfall"
         FROM "ClaimRefund" r
         JOIN "ClaimRequest" c ON c."id" = r."claimId"
        WHERE c."sellerOrderId" = $1`,
      [placed.sellerOrderId],
    )

    // 원장에는 한 줄도 없다 — 움직인 돈이 없기 때문이다.
    expect(adjustments).toEqual([])
    expect(record.pointClawbackShortfall).toBe(given)
  })
})

/**
 * 할인의 복구 (TASK-0078).
 *
 * 환불이 돈만 돌려주고 끝나면 **쓴 적립금이 사라진다.** 그 손해는 조용하다 — 환불은
 * 성공하고 금액도 맞으며, 다만 잔액이 돌아오지 않는다. 반대로 너무 많이 돌려주면
 * 그것은 없는 돈을 만든 것이고, 그쪽은 정산일까지 아무 데도 나타나지 않는다.
 *
 * 위의 픽스처를 그대로 쓴다. 「1원이 사라지지 않는다」는 할인이 나뉘어 있을 때만
 * 증명되는 성질이라, 안분해 둔 주문이 이미 여기 있는 것이 중요하다.
 */
describe('할인 복구 (TASK-0078)', () => {
  /** 이 사람의 적립금 원장, 최신순. */
  function ledgerRows(userId: string) {
    return db.query<{ type: string; amount: number; reason: string | null }>(
      `SELECT t."type"::text AS "type", t."amount", t."reason"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1
        ORDER BY t."seq" DESC`,
      [userId],
    )
  }

  function balanceOf(userId: string) {
    return db.query<{ balance: number }>(
      `SELECT "balance" FROM "PointAccount" WHERE "userId" = $1`,
      [userId],
    )
  }

  /** 이 주문에 쿠폰 한 장을 쓴 것으로 만든다. */
  async function spendCoupon(placed: Placed, discountAmount: number): Promise<string> {
    const coupon = await createCoupon(db, { discountValue: discountAmount })
    const row = await createUserCoupon(db, {
      couponId: coupon.id,
      userId: buyer.userId,
      status: 'USED',
      usedAt: '2026-09-03T00:00:00.000Z',
      orderId: placed.orderId,
      discountAmount,
    })

    return row.id
  }

  function couponRow(id: string) {
    return db.one<{ status: string; orderId: string | null; discountAmount: number | null }>(
      `SELECT "status"::text AS "status", "orderId", "discountAmount"
         FROM "UserCoupon" WHERE "id" = $1`,
      [id],
    )
  }

  it('전량 취소하면 쓴 적립금이 전부 돌아온다 (F1)', async () => {
    const placed = await place({ lines: [{ price: 20_000, quantity: 1 }] })
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목이 없습니다.')

    await allocate(placed, [{ itemId: item.id, coupon: 0, point: 5_000 }])
    await pay(placed)
    await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])

    const [entry] = await ledgerRows(buyer.userId)

    expect(entry?.type).toBe('RESTORE')
    expect(entry?.amount).toBe(5_000)
    expect((await balanceOf(buyer.userId))[0]?.balance).toBe(5_000)
  })

  it('한 개만 취소하면 그 항목의 안분액만 돌아온다 (F2)', async () => {
    const placed = await place({ lines: [{ price: 10_000, quantity: 3 }] })
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목이 없습니다.')

    await allocate(placed, [{ itemId: item.id, coupon: 0, point: 3_000 }])
    await pay(placed)
    await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])

    expect((await balanceOf(buyer.userId))[0]?.balance).toBe(1_000)
  })

  it('적립금을 쓰지 않았으면 원장에 아무것도 남지 않는다', async () => {
    const placed = await place({ lines: [{ price: 20_000, quantity: 1 }] })
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목이 없습니다.')

    await pay(placed)
    await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])

    // 0원짜리 사건은 사건이 아니다 — 「왜 줄지도 늘지도 않은 줄이 있나」를 만들지 않는다.
    expect(await ledgerRows(buyer.userId)).toEqual([])
  })

  it('전량 취소하면 쿠폰이 다시 쓸 수 있게 돌아온다 (F3)', async () => {
    const placed = await place({ lines: [{ price: 20_000, quantity: 1 }] })
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목이 없습니다.')

    await allocate(placed, [{ itemId: item.id, coupon: 3_000, point: 0 }])

    const userCouponId = await spendCoupon(placed, 3_000)

    await pay(placed)
    await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])

    // **넷을 함께 비운다.** 금액만 남기면 되돌아온 쿠폰이 여전히 정산에서 차감된다.
    expect(await couponRow(userCouponId)).toEqual({
      status: 'ISSUED',
      orderId: null,
      discountAmount: null,
    })
  })

  /**
   * **부분 취소면 되돌리지 않는다.** 최소 주문금액 5만원 쿠폰을 쓰고 일부만 남기면,
   * 돌아온 쿠폰으로 그 조건을 우회해 다시 쓸 수 있다.
   */
  it('부분 취소면 쿠폰이 돌아오지 않는다 (F4)', async () => {
    const placed = await place({ lines: [{ price: 10_000, quantity: 3 }] })
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목이 없습니다.')

    await allocate(placed, [{ itemId: item.id, coupon: 3_000, point: 0 }])

    const userCouponId = await spendCoupon(placed, 3_000)

    await pay(placed)
    await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])

    expect((await couponRow(userCouponId)).status).toBe('USED')
  })

  /**
   * **두 번째 환불이 복구를 두 번 하지 않는다** (F8).
   *
   * 첫 겹은 클레임의 상태다 — 이미 `REFUNDED` 면 아무것도 하지 않는다. 그 아래에
   * 원장의 `PointTransaction_ref_key` 가 한 겹 더 있다.
   */
  it('환불을 다시 시도해도 복구가 두 번 일어나지 않는다 (F8)', async () => {
    const placed = await place({ lines: [{ price: 20_000, quantity: 1 }] })
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목이 없습니다.')

    await allocate(placed, [{ itemId: item.id, coupon: 1_000, point: 5_000 }])

    const userCouponId = await spendCoupon(placed, 1_000)

    await pay(placed)

    const { claim } = await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])

    await refunds().settle(claim.id)
    await refunds().settle(claim.id)

    expect(await ledgerRows(buyer.userId)).toHaveLength(1)
    expect((await balanceOf(buyer.userId))[0]?.balance).toBe(5_000)
    expect((await couponRow(userCouponId)).status).toBe('ISSUED')
  })

  /**
   * **합계 검증** (F7): 현금 + 적립금 복구 = 사는 사람이 낸 것 전부.
   *
   * 환불액이 「상품금액 − 쿠폰안분 − 적립금안분」이라, 빠진 적립금안분이 적립금으로
   * 돌아와야 둘의 합이 원래 낸 값이 된다. 쿠폰안분은 돌아오지 않는다 — 그것은 사는
   * 사람이 낸 것이 아니라 깎인 값이고, 대신 쿠폰 자체가 돌아온다.
   */
  it('현금과 적립금 복구의 합이 낸 것과 같다 (F7)', async () => {
    const placed = await place({
      lines: [
        { price: 30_000, quantity: 1 },
        { price: 20_000, quantity: 1 },
      ],
      shippingFee: 0,
    })
    const [cheap, dear] = placed.items

    if (cheap === undefined || dear === undefined) throw new Error('항목이 없습니다.')

    await allocate(placed, [
      { itemId: cheap.id, coupon: 2_000, point: 3_000 },
      { itemId: dear.id, coupon: 3_000, point: 4_500 },
    ])

    const { paidAmount } = await pay(placed)

    await cancel(placed, [
      { orderItemId: cheap.id, quantity: 1 },
      { orderItemId: dear.id, quantity: 1 },
    ])

    const refunded = (await refundRows(await paymentIdOf(placed.orderId))).reduce(
      (sum, row) => sum + row.amount,
      0,
    )
    const restored = (await balanceOf(buyer.userId))[0]?.balance ?? 0

    expect(refunded + restored).toBe(paidAmount + 7_500)
  })
})

/** 이 주문의 결제 id. 합계 검증이 환불 행을 찾을 때 쓴다. */
async function paymentIdOf(orderId: string): Promise<string> {
  const row = await db.one<{ id: string }>(`SELECT "id" FROM "Payment" WHERE "orderId" = $1`, [
    orderId,
  ])

  return row.id
}
