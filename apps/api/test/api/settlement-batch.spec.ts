import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import { ApiClientError, settlementRunResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { SettlementBatchService } from '../../src/settlement/settlement-batch.service.js'
import { weekBefore } from '../../src/settlement/settlement-calc.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 주간 정산서 배치 (TASK-0080), 실제 데이터베이스에 대고.
 *
 * **이 프로젝트 도메인 설계의 최종 수렴점**이다 (D-032). 쿠폰의 부담 주체, 적립금,
 * 반품 차감, 구매확정이 정산 한 줄로 모인다.
 *
 * 금액의 산술은 `settlement-calc.spec.ts` 가 순수 함수로 잰다. **여기서 재는 것은 그
 * 산술에 무엇이 입력되는가**이고, R1 이 가리키는 위험이 전부 거기 있다 — 판매자에게
 * 덜 주면 그는 몇 주 뒤 정산서의 숫자 하나로만 그것을 알 수 있고, 더 주면 플랫폼이
 * 받아야 할 것을 못 받는데 그쪽은 아무도 신고하지 않는다.
 *
 * 주문을 체크아웃부터 걷지 않는 이유는 `admin-claim.spec.ts` 와 같다 — `CONFIRMED`
 * 하나를 만드는 데 결제사 대역과 시뮬레이터가 필요하고, 그것들은 자기 스펙이 이미
 * 재고 있다. 대신 **정산이 읽는 칸을 그대로 심는다.**
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 회차 안의 한 시점. 배치가 「지난주」로 집는 주에 들어 있다. */
const NOW = '2026-09-09T05:00:00.000Z'
const IN_PERIOD = '2026-09-02T05:00:00.000Z'

/**
 * 다음 회차 안의 한 시점.
 *
 * 차감 줄은 **다음 회차**에 적힌다 — 승인된 정산서에는 아무것도 더할 수 없으므로
 * (더할 수 있으면 승인이라는 행위에 뜻이 없어진다), 반품이 승인 뒤에 오면 그 차이는
 * 다음 회차를 기다린다.
 */
const NEXT_WEEK = '2026-09-16T05:00:00.000Z'

let superAdmin: TestCaller
let operator: TestCaller
let buyerId: string
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)

  superAdmin = { userId: (await createUser(db)).id, roles: ['ADMIN_SUPER'] }
  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  buyerId = (await createUser(db)).id
  store = await createSellableVariant(db, { stock: 100 })
  sequence = 0
})

function batch(): SettlementBatchService {
  return api.resolve<SettlementBatchService>(SettlementBatchService)
}

interface SeedOptions {
  /** 이 항목 하나의 값. 정산이 읽는 칸을 그대로 정한다. */
  readonly unitPrice?: number
  readonly quantity?: number
  readonly commissionRateBp?: number
  /** 이 항목에 안분된 **전체** 쿠폰 몫 — 플랫폼 부담까지 포함한 값이다. */
  readonly couponDiscountAmount?: number
  /** 그중 **판매자가 부담한** 몫. 정산에서 빠지는 것은 이것뿐이다. */
  readonly sellerCouponDiscountAmount?: number
  /** 이 항목에 안분된 적립금. **정산에서 빠지지 않는다** (F5). */
  readonly pointDiscountAmount?: number
  /** 구매확정 시각. 주지 않으면 확정된 적이 없는 몫이다 (F1). */
  readonly confirmedAt?: string
}

interface Seeded {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly orderItemId: string
}

/** 정산이 읽는 칸을 그대로 심는다. */
async function seed(options: SeedOptions = {}): Promise<Seeded> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const orderItemId = randomUUID()
  const unitPrice = options.unitPrice ?? 10_000
  const quantity = options.quantity ?? 1
  const productAmount = unitPrice * quantity
  const coupon = options.couponDiscountAmount ?? 0
  const point = options.pointDiscountAmount ?? 0

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             $4, $4, now())`,
    [orderId, `20260908-${String(sequence).padStart(8, '0')}`, buyerId, productAmount],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount",
        "couponDiscountAmount", "pointDiscountAmount", "paidAmount", "shippingFee", "updatedAt")
     VALUES ($1, $2, $3, 'CONFIRMED'::"SellerOrderStatus", '가상브랜드', $4, $5, $6, $7, 0, now())`,
    [
      sellerOrderId,
      orderId,
      store.seller.id,
      productAmount,
      coupon,
      point,
      productAmount - coupon - point,
    ],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productSnapshot", "unitPrice", "quantity",
        "productAmount", "couponDiscountAmount", "sellerCouponDiscountAmount",
        "pointDiscountAmount", "discountAmount", "commissionRateBp", "updatedAt")
     VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
    [
      orderItemId,
      sellerOrderId,
      store.variant.id,
      unitPrice,
      quantity,
      productAmount,
      coupon,
      options.sellerCouponDiscountAmount ?? 0,
      point,
      coupon + point,
      options.commissionRateBp ?? 1_000,
    ],
  )

  if (options.confirmedAt !== undefined) {
    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
       VALUES (gen_random_uuid(), $1, 'DELIVERED'::"SellerOrderStatus",
               'CONFIRMED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", $2::timestamptz)`,
      [sellerOrderId, options.confirmedAt],
    )
  }

  return { orderId, sellerOrderId, orderItemId }
}

interface SettlementRow {
  readonly id: string
  readonly status: string
  readonly salesAmount: number
  readonly commissionAmount: number
  readonly sellerCouponAmount: number
  readonly returnAdjustmentAmount: number
  readonly payoutAmount: number
}

function settlements(): Promise<readonly SettlementRow[]> {
  return db.query<SettlementRow>(
    `SELECT "id", "status"::text AS "status", "salesAmount", "commissionAmount",
            "sellerCouponAmount", "returnAdjustmentAmount", "payoutAmount"
       FROM "Settlement" ORDER BY "periodStart"`,
  )
}

function items(): Promise<readonly { type: string; payoutAmount: number; salesAmount: number }[]> {
  return db.query(
    `SELECT "type"::text AS "type", "payoutAmount", "salesAmount"
       FROM "SettlementItem" ORDER BY "createdAt", "type"`,
  )
}

/**
 * 반품 하나를 **환불까지 끝난 상태로** 심는다.
 *
 * 정산이 세는 것은 환불까지 끝난 클레임뿐이다 — 신청·승인만 된 반품은 아직 돈이
 * 움직이지 않았고 검수에서 떨어질 수도 있어서, 미리 빼면 판매자가 받을 돈이 남의
 * 신청 하나로 줄어든다.
 */
async function refundReturn(
  seeded: Seeded,
  options: { readonly quantity: number; readonly refundedAt: string },
): Promise<void> {
  const claimId = randomUUID()
  const paymentId = randomUUID()

  // `ClaimRefund_settled_check` 가 「환불된 시각이 있으면 결제를 가리켜야 한다」를
  // 요구한다 — 돈이 어디서 돌아갔는지 모르는 환불 기록은 근거가 아니다.
  await db.execute(
    `INSERT INTO "Payment"
       ("id", "orderId", "provider", "status", "authorizedAmount", "updatedAt")
     VALUES ($1, $2, 'TOSS'::"PaymentProviderName", 'PAID'::"PaymentStatus", 10000, now())`,
    [paymentId, seeded.orderId],
  )
  await db.execute(
    `INSERT INTO "ClaimRequest"
       ("id", "sellerOrderId", "type", "status", "reason", "fault", "requestedById", "updatedAt")
     VALUES ($1, $2, 'RETURN'::"ClaimType", 'REFUNDED'::"ClaimStatus", '단순 변심',
             'CUSTOMER'::"ClaimFault", $3, now())`,
    [claimId, seeded.sellerOrderId, buyerId],
  )
  await db.execute(
    `INSERT INTO "ClaimItem" ("id", "claimId", "orderItemId", "quantity", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, now())`,
    [claimId, seeded.orderItemId, options.quantity],
  )
  await db.execute(
    `INSERT INTO "ClaimRefund" ("claimId", "paymentId", "refundedAt", "updatedAt")
     VALUES ($1, $2, $3::timestamptz, now())`,
    [claimId, paymentId, options.refundedAt],
  )
}

async function approveAll(): Promise<void> {
  await db.execute(
    `UPDATE "Settlement"
        SET "status" = 'APPROVED'::"SettlementStatus", "approvedAt" = now(), "approvedById" = $1
      WHERE "status" = 'PENDING'`,
    [superAdmin.userId],
  )
}

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

describe('무엇이 집계되는가 (F1)', () => {
  it('구매확정된 몫만 집계된다', async () => {
    await seed({ confirmedAt: IN_PERIOD })
    await seed()

    const tally = await batch().run()

    expect(tally.settled).toBe(1)
    expect(await items()).toHaveLength(1)
  })

  /**
   * **기간의 시작으로 거르지 않는다.** 배치가 한 주 멈춰 있었다면 그 주의 확정분은
   * 어느 회차에도 속하지 않게 되는데, 시작으로 거르면 그 돈이 영영 지급되지 않는다.
   */
  it('지난 회차에 놓친 확정분도 이번 회차에 집힌다', async () => {
    await seed({ confirmedAt: '2026-07-01T00:00:00.000Z' })

    expect((await batch().run()).settled).toBe(1)
  })

  /** 아직 끝나지 않은 주의 확정은 다음 회차의 몫이다 (R2). */
  it('이번 주에 확정된 것은 아직 집계하지 않는다', async () => {
    await seed({ confirmedAt: '2026-09-08T00:00:00.000Z' })

    expect((await batch().run()).settled).toBe(0)
    expect(await settlements()).toHaveLength(0)
  })

  it('만든 정산서의 기간이 지난주다', async () => {
    await seed({ confirmedAt: IN_PERIOD })
    await batch().run()

    // `TIMESTAMP` 컬럼을 드라이버가 프로세스의 시간대로 읽어 오므로 문자열로 받는다 —
    // 저장된 값 자체가 UTC 이고, 그 사실을 시간대 설정에 기대지 않고 확인한다.
    const [row] = await db.query<{ periodStart: string; periodEnd: string }>(
      `SELECT to_char("periodStart", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "periodStart",
              to_char("periodEnd", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')   AS "periodEnd"
         FROM "Settlement"`,
    )
    const period = weekBefore(new Date(NOW))

    expect(row?.periodStart).toBe(period.start.toISOString())
    expect(row?.periodEnd).toBe(period.end.toISOString())
  })
})

describe('금액 (F2 · F3 · F4 · F5)', () => {
  it('판매액에서 수수료를 뺀다 (F2)', async () => {
    await seed({ unitPrice: 10_000, commissionRateBp: 1_000, confirmedAt: IN_PERIOD })
    await batch().run()

    expect(await settlements()).toMatchObject([
      { salesAmount: 10_000, commissionAmount: 1_000, payoutAmount: 9_000 },
    ])
  })

  it('주문 시점의 요율을 쓴다 — 지금 요율 표를 보지 않는다', async () => {
    await seed({ commissionRateBp: 300, confirmedAt: IN_PERIOD })
    await batch().run()

    expect((await settlements())[0]?.commissionAmount).toBe(300)
  })

  it('판매자 부담 쿠폰이 빠진다 (F3)', async () => {
    await seed({
      couponDiscountAmount: 3_000,
      sellerCouponDiscountAmount: 3_000,
      confirmedAt: IN_PERIOD,
    })
    await batch().run()

    expect(await settlements()).toMatchObject([
      { salesAmount: 10_000, sellerCouponAmount: 3_000, payoutAmount: 6_000 },
    ])
  })

  /**
   * **여기가 이 마일스톤의 핵심이다** (D-029).
   *
   * 플랫폼 쿠폰 3,000원이 붙은 주문에서 판매자는 **정가 10,000원 기준으로**
   * 정산받는다. 구매자는 7,000원을 냈지만 그 차액은 플랫폼이 진 비용이고, 판매자의
   * 정산에서 빼면 그것은 **남의 돈으로 한 할인의 청구서를 그에게 보내는** 일이다.
   */
  it('플랫폼 부담 쿠폰은 차감되지 않는다 (F4)', async () => {
    await seed({
      couponDiscountAmount: 3_000,
      sellerCouponDiscountAmount: 0,
      confirmedAt: IN_PERIOD,
    })
    await batch().run()

    expect(await settlements()).toMatchObject([
      { salesAmount: 10_000, sellerCouponAmount: 0, payoutAmount: 9_000 },
    ])
  })

  it('적립금은 차감되지 않는다 (F5)', async () => {
    await seed({ pointDiscountAmount: 4_000, confirmedAt: IN_PERIOD })
    await batch().run()

    expect(await settlements()).toMatchObject([{ salesAmount: 10_000, payoutAmount: 9_000 }])
  })

  /** 섞였을 때가 부담 주체를 나눠 저장하는 이유다. 합쳐진 숫자로는 갈라낼 수 없다. */
  it('섞이면 판매자 몫만 빠진다', async () => {
    await seed({
      couponDiscountAmount: 3_000,
      sellerCouponDiscountAmount: 1_000,
      pointDiscountAmount: 2_000,
      confirmedAt: IN_PERIOD,
    })
    await batch().run()

    expect(await settlements()).toMatchObject([
      { salesAmount: 10_000, sellerCouponAmount: 1_000, payoutAmount: 8_000 },
    ])
  })
})

describe('중복 방지 (F6)', () => {
  it('두 번 돌려도 한 번만 집계된다', async () => {
    await seed({ confirmedAt: IN_PERIOD })

    const first = await batch().run()
    const second = await batch().run()

    expect(first.settled).toBe(1)
    expect(second.settled).toBe(0)
    expect(await items()).toHaveLength(1)
  })

  /** **마지막 방어선은 DB** — 조회와 저장 사이에 남이 끼어들어도 두 줄이 되지 않는다. */
  it('같은 몫의 판매 줄을 손으로 하나 더 넣을 수 없다', async () => {
    const seeded = await seed({ confirmedAt: IN_PERIOD })

    await batch().run()

    const [settlement] = await settlements()

    await expect(
      db.execute(
        `INSERT INTO "SettlementItem"
           ("id", "settlementId", "type", "sellerOrderId", "salesAmount", "commissionAmount",
            "sellerCouponAmount", "payoutAmount")
         VALUES (gen_random_uuid(), $1, 'SALE'::"SettlementItemType", $2, 0, 0, 0, 0)`,
        [settlement?.id, seeded.sellerOrderId],
      ),
    ).rejects.toThrow(/SettlementItem_sale_key/u)
  })
})

describe('반품 (F7)', () => {
  it('정산 전에 확정된 반품은 애초에 빠진 채로 집계된다', async () => {
    const seeded = await seed({ quantity: 2, confirmedAt: IN_PERIOD })

    await refundReturn(seeded, { quantity: 1, refundedAt: IN_PERIOD })
    await batch().run()

    expect(await settlements()).toMatchObject([{ salesAmount: 10_000, payoutAmount: 9_000 }])
  })

  /**
   * 승인 전이면 **그 줄을 다시 만든다.** 차감 줄을 만들지 않는 이유는 아직 아무도
   * 그 금액을 약속하지 않았기 때문이다 — 고쳐 쓰면 정산서가 처음부터 옳다.
   */
  it('승인 전이면 판매 줄을 고쳐 쓴다 (재생성)', async () => {
    const seeded = await seed({ quantity: 2, confirmedAt: IN_PERIOD })

    await batch().run()
    await refundReturn(seeded, { quantity: 1, refundedAt: NOW })

    const tally = await batch().run()

    expect(tally.amended).toBe(1)
    expect(await items()).toHaveLength(1)
    expect(await settlements()).toMatchObject([{ salesAmount: 10_000, payoutAmount: 9_000 }])
  })

  /**
   * **승인된 금액은 뒤에서 바뀌지 않는다.** 바뀌면 승인이라는 행위에 뜻이 없어진다.
   * 그래서 차이는 이번 회차의 차감 줄로 간다.
   */
  it('승인된 회차 뒤의 반품은 다음 회차에서 차감된다', async () => {
    const seeded = await seed({ quantity: 2, confirmedAt: IN_PERIOD })

    await batch().run()
    await approveAll()
    await refundReturn(seeded, { quantity: 1, refundedAt: NOW })
    api.clock.set(NEXT_WEEK)

    const tally = await batch().run()
    const rows = await settlements()

    expect(tally.adjusted).toBe(1)
    // 앞 회차는 승인된 그대로다.
    expect(rows[0]).toMatchObject({ status: 'APPROVED', salesAmount: 20_000, payoutAmount: 18_000 })
    // 이번 회차는 판매 없이 차감만 있다.
    expect(rows[1]).toMatchObject({
      salesAmount: 0,
      returnAdjustmentAmount: -9_000,
      payoutAmount: -9_000,
    })
  })

  /** 차감을 두 번 적으면 판매자가 물건도 잃고 돈도 두 번 잃는다. */
  it('차감은 몇 번을 돌려도 한 번만 적힌다', async () => {
    const seeded = await seed({ quantity: 2, confirmedAt: IN_PERIOD })

    await batch().run()
    await approveAll()
    await refundReturn(seeded, { quantity: 1, refundedAt: NOW })
    api.clock.set(NEXT_WEEK)
    await batch().run()
    await batch().run()

    const rows = await settlements()

    expect(rows[1]?.returnAdjustmentAmount).toBe(-9_000)
    expect((await items()).filter((row) => row.type === 'RETURN_ADJUSTMENT')).toHaveLength(1)
  })

  /**
   * **나눠 반품한 사람의 합이 한 번에 반품한 사람과 같아야 한다.** 같은 회차 안에서
   * 두 번째 반품이 오면 차감 줄을 다시 계산하는데, 자기 자신을 포함해 세면 뺀 것을
   * 또 뺀다.
   */
  it('같은 회차에 반품이 또 오면 차감이 겹쳐 세어지지 않는다', async () => {
    const seeded = await seed({ quantity: 3, confirmedAt: IN_PERIOD })

    await batch().run()
    await approveAll()
    await refundReturn(seeded, { quantity: 1, refundedAt: NOW })
    api.clock.set(NEXT_WEEK)
    await batch().run()
    await refundReturn(seeded, { quantity: 1, refundedAt: NEXT_WEEK })
    await batch().run()

    const rows = await settlements()

    // 3개 중 2개가 반품됐다 — 남은 것은 하나이고, 앞 회차는 셋을 정산했다.
    expect(rows[0]?.payoutAmount).toBe(27_000)
    expect(rows[1]?.payoutAmount).toBe(-18_000)
  })

  it('전량 반품이면 지급액이 0이 된다', async () => {
    const seeded = await seed({ quantity: 2, confirmedAt: IN_PERIOD })

    await batch().run()
    await approveAll()
    await refundReturn(seeded, { quantity: 2, refundedAt: NOW })
    api.clock.set(NEXT_WEEK)
    await batch().run()

    const rows = await settlements()

    expect(rows[0]!.payoutAmount + rows[1]!.payoutAmount).toBe(0)
  })
})

describe('합계 (F8)', () => {
  it('정산서 총액이 항목 합계와 정확히 같다', async () => {
    await seed({ unitPrice: 3_333, quantity: 3, commissionRateBp: 750, confirmedAt: IN_PERIOD })
    await seed({
      unitPrice: 7_777,
      commissionRateBp: 1_250,
      couponDiscountAmount: 1_111,
      sellerCouponDiscountAmount: 777,
      confirmedAt: IN_PERIOD,
    })
    await batch().run()

    const [settlement] = await settlements()
    const lines = await items()
    const sum = lines.reduce((total, line) => total + line.payoutAmount, 0)

    expect(settlement?.payoutAmount).toBe(sum)
  })

  it('지급액이 세 항의 결과와 어긋나는 줄은 저장되지 않는다', async () => {
    await seed({ confirmedAt: IN_PERIOD })
    await batch().run()

    const [settlement] = await settlements()

    await expect(
      db.execute(
        `INSERT INTO "SettlementItem"
           ("id", "settlementId", "type", "sellerOrderId", "salesAmount", "commissionAmount",
            "sellerCouponAmount", "payoutAmount")
         VALUES (gen_random_uuid(), $1, 'RETURN_ADJUSTMENT'::"SettlementItemType", $2, 0, 0, 0, -1)`,
        [settlement?.id, (await seed({ confirmedAt: IN_PERIOD })).sellerOrderId],
      ),
    ).rejects.toThrow(/SettlementItem_payout_check/u)
  })
})

describe('수동 실행', () => {
  it('최고 관리자는 배치를 손으로 돌린다', async () => {
    await seed({ confirmedAt: IN_PERIOD })

    const tally = await client(superAdmin).request({
      path: '/settlements/batch',
      method: 'POST',
      schema: settlementRunResponseSchema,
    })

    expect(tally).toEqual({ settled: 1, amended: 0, adjusted: 0, settlements: 1 })
  })

  it('운영자는 돌리지 못한다', async () => {
    await expect(
      client(operator).request({
        path: '/settlements/batch',
        method: 'POST',
        schema: settlementRunResponseSchema,
      }),
    ).rejects.toBeInstanceOf(ApiClientError)
  })
})
