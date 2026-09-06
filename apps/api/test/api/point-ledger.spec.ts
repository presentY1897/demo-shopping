import { randomUUID } from 'node:crypto'

import type { ApiClient, OrderStatus } from '@shopping/shared'
import {
  calculateOrder,
  cartResponseSchema,
  demoCarrierNames,
  orderResponseSchema,
  pointBalanceSchema,
  pointLedgerResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { PointExpiryService } from '../../src/points/point-expiry.service.js'
import {
  POINT_EXPIRY_LAST_EXPIRED_KEY,
  POINT_EXPIRY_LAST_RUN_KEY,
} from '../../src/points/point-expiry.js'
import { pointDiscount } from '../../src/points/point-ledger.js'
import { PointsService } from '../../src/points/points.service.js'
import type { SellerOrderActor } from '../../src/orders/seller-order-transitions.js'
import { SellerOrderService } from '../../src/orders/seller-order.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { useApiApp } from '../support/api-app.js'
import { DEFAULT_TEST_INSTANT, fixedClock } from '../support/clock.js'
import { concurrently, fulfilled, rejected } from '../support/concurrently.js'
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
 * 적립금 원장 — 이 워커의 실제 데이터베이스에 대고 (TASK-0076).
 *
 * **이 파일이 지키는 것은 「잔액은 원장이 설명하는 값이고, 그 둘이 절대 갈라지지
 * 않는다」이다.** 갈라지는 것은 어떤 요청도 실패시키지 않고 어떤 화면도 깨뜨리지
 * 않는다 — 사람이 세어 볼 때에야 보이고, 그때는 이미 돈이 나간 뒤다. 그래서 여기
 * 거의 모든 갈래가 **끝에서 SQL 로 대사를 확인한다.**
 *
 * 서비스를 애플리케이션에서 꺼내 쓴다. 적립금에는 아직 엔드포인트가 없고
 * (화면은 TASK-0077), 재는 대상이 컨트롤러가 아니라 **서비스와 데이터베이스**이기
 * 때문이다 — QUALITY-GATES Q5 가 「엔드포인트 없이 서비스만 만드는 TASK」를 위해
 * 조건을 서비스 코드의 존재로 바꿔 둔 그 자리다. 응답 모양은 밖으로 나가는 계약
 * (`@shopping/shared` 의 zod 스키마)으로 직접 `parse` 해 드리프트를 막는다.
 *
 * 시각은 전부 **주입된 시계**다. 유효기간을 벽시계로 재면 「아직 안 지났다」가
 * 실행하는 날짜에 따라 뒤집히고, 그것은 빨강이 아니라 **조용히 틀린 초록**이다.
 */

const db = useDatabase()
const clock = fixedClock(DEFAULT_TEST_INSTANT)
const api = useApiApp({ database: db, authenticate: true, clock })

/** 주문 하나의 결제액. 적립률 1% 에서 딱 떨어지는 값으로 골랐다. */
const UNIT_PRICE = 10_000

const TRACKING_CARRIER = 'GA' as const
let issued = 0

function nextTrackingNumber(): string {
  issued += 1

  return `DEMO-${TRACKING_CARRIER}-${String(issued).padStart(12, '0')}`
}

let buyer: TestCaller
let addressId: string
let categoryId: number

beforeEach(async () => {
  clock.set(DEFAULT_TEST_INSTANT)

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function points(): PointsService {
  return api.resolve<PointsService>(PointsService)
}

function transitions(): SellerOrderService {
  return api.resolve<SellerOrderService>(SellerOrderService)
}

function prisma(): PrismaService {
  return api.resolve<PrismaService>(PrismaService)
}

function expiry(): PointExpiryService {
  return api.resolve<PointExpiryService>(PointExpiryService)
}

// ---------------------------------------------------------------- 대사

interface Reconciliation {
  readonly balance: number
  readonly ledgerSum: number
  readonly lotRemaining: number
  readonly chainBreaks: number
  readonly entries: number
  readonly maxSeq: number
}

/**
 * **원장 합계 = 잔액**을, 서비스가 아니라 데이터베이스에 직접 물어본다.
 *
 * `PointsService.reconcile()` 을 부르지 않는 이유는 그것이 **재는 대상**이기
 * 때문이다. 대사가 언제나 빈 목록을 답하도록 잘못 짜여 있어도 그 함수를 쓴 검사는
 * 초록이고, 그때 이 파일 전체가 아무것도 증명하지 않는다.
 */
async function reconciliationOf(userId: string): Promise<Reconciliation> {
  return db.one<Reconciliation>(
    `SELECT a."balance"::int AS "balance",
            COALESCE((SELECT sum(t."amount") FROM "PointTransaction" t
                       WHERE t."accountId" = a."id"), 0)::int AS "ledgerSum",
            COALESCE((SELECT sum(t."remainingAmount") FROM "PointTransaction" t
                       WHERE t."accountId" = a."id"), 0)::int AS "lotRemaining",
            (SELECT count(*) FROM (
                SELECT x."balanceAfter",
                       COALESCE(lag(x."balanceAfter") OVER (ORDER BY x."seq"), 0) + x."amount"
                         AS "expected"
                  FROM "PointTransaction" x
                 WHERE x."accountId" = a."id"
             ) c WHERE c."balanceAfter" <> c."expected")::int AS "chainBreaks",
            (SELECT count(*) FROM "PointTransaction" t
              WHERE t."accountId" = a."id")::int AS "entries",
            COALESCE((SELECT max(t."seq") FROM "PointTransaction" t
                       WHERE t."accountId" = a."id"), 0)::int AS "maxSeq"
       FROM "PointAccount" a
      WHERE a."userId" = $1`,
    [userId],
  )
}

/** 대사가 통과했는가 — 이 파일의 거의 모든 갈래가 끝에서 이것을 부른다. */
async function expectReconciled(userId: string, balance: number): Promise<void> {
  const audit = await reconciliationOf(userId)

  expect(audit.balance).toBe(balance)
  expect(audit.ledgerSum).toBe(balance)
  expect(audit.lotRemaining).toBe(balance)
  expect(audit.chainBreaks).toBe(0)
  // `seq` 가 1..n 이고 빈칸이 없다 — 잠금 없이 쓰인 행이 드러나는 유일한 자리다.
  expect(audit.maxSeq).toBe(audit.entries)

  // 서비스의 대사도 같은 말을 해야 한다. 위의 SQL 이 기준이고 이쪽이 검사 대상이다.
  expect(await points().reconcile()).toEqual([])
}

// ---------------------------------------------------------------- 주문

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
}

async function listing(): Promise<string> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    minPrice: UNIT_PRICE,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: UNIT_PRICE,
    stock: 10,
    isActive: true,
  })

  return variant.id
}

/** 진짜 주문 하나. 장바구니 → 주문. */
async function place(): Promise<Placed> {
  const variantId = await listing()
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity: 1 },
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

  return { orderId: order.id, sellerOrderId }
}

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

/**
 * 전이 하나를 **문을 지나서** 부른다.
 *
 * 상태를 SQL 로 찍지 않는 이유는 이 스펙이 재는 것이 「구매확정이 적립을 부른다」
 * 이기 때문이다. 상태만 손으로 바꾸면 포트가 아예 호출되지 않고, 그때 이 파일은
 * 「적립되지 않았다」를 초록으로 통과시킨다.
 */
async function step(
  sellerOrderId: string,
  to: OrderStatus,
  actor: SellerOrderActor,
): Promise<void> {
  const event = await prisma().$transaction((tx) =>
    transitions().applyWithin(tx, sellerOrderId, to, { actor, actorId: null }),
  )

  await transitions().publish(event === null ? [] : [event])
}

/** 이 몫을 배송완료까지 데려간다 — 확정은 하지 않는다. */
async function deliver(sellerOrderId: string): Promise<void> {
  await attachTracking(sellerOrderId)
  await step(sellerOrderId, 'PAID', 'SYSTEM')
  await step(sellerOrderId, 'PREPARING', 'SYSTEM')
  await step(sellerOrderId, 'SHIPPED', 'SELLER')
  await step(sellerOrderId, 'DELIVERED', 'SYSTEM')
}

// ---------------------------------------------------------------- 검사

describe('적립은 구매확정에서만 일어난다', () => {
  it('구매확정이 실결제금액 × 적립률을 지급한다 (F1)', async () => {
    const placed = await place()

    await deliver(placed.sellerOrderId)
    await step(placed.sellerOrderId, 'CONFIRMED', 'BUYER')

    const balance = pointBalanceSchema.parse(await points().balanceOf(buyer.userId))
    const { earnRateBp } = await points().policy()
    // **그 판매자 몫의 실결제금액**이 근거다 (`pricing.md` 4장). 배송비가 들어간
    // 값이고, 그것이 「실결제금액」의 뜻이다 — 스펙이 상품금액을 다시 계산해
    // 단언하면 무료배송 조건이 바뀌는 날 이 검사만 조용히 다른 것을 재게 된다.
    const paidAmount = await paidAmountOf(placed.sellerOrderId)

    expect(balance.balance).toBe(Math.floor((paidAmount * earnRateBp) / 10_000))
    expect(balance.balance).toBeGreaterThan(0)
    await expectReconciled(buyer.userId, balance.balance)
  })

  it('**배송완료만으로는 지급되지 않는다** (F2)', async () => {
    const placed = await place()

    await deliver(placed.sellerOrderId)

    // 이 단언이 이 파일에서 가장 값진 것이다. 확정에서 지급하는 이유가
    // `state-machines.md` 1장에 있다 — 배송완료 직후 정산하면 반품 시 회수할
    // 방법이 없고, 확정이 「문제없음」의 표시다. 배송완료에서 지급하는 구현도
    // F1 을 똑같이 통과한다.
    expect((await points().balanceOf(buyer.userId)).balance).toBe(0)

    const rows = await db.query(`SELECT count(*)::int AS n FROM "PointTransaction"`)

    expect(rows[0]?.n).toBe(0)
  })

  it('적립 시점의 적립률을 원장에 함께 적는다 (R2)', async () => {
    const placed = await place()

    await deliver(placed.sellerOrderId)
    await step(placed.sellerOrderId, 'CONFIRMED', 'BUYER')

    // 적립률을 바꾼 뒤에도 지난 적립은 자기가 받은 이유를 그대로 말한다 — 정책
    // 행을 읽어 되짚는 구현이면 여기서 200 이 나온다.
    await db.query(`UPDATE "PointPolicy" SET "earnRateBp" = 200 WHERE "id" = 1`)

    const ledger = pointLedgerResponseSchema.parse(await points().ledger(buyer.userId))
    const earn = ledger.entries.at(0)

    expect(earn?.type).toBe('EARN')
    expect(earn?.earnRateBp).toBe(100)
    expect(earn?.remainingAmount).toBe(ledger.account.balance)
    expect(earn?.expiresAt).not.toBeNull()
  })

  it('같은 확정이 두 번 도착해도 한 번만 적립한다 (F6)', async () => {
    const placed = await place()

    await deliver(placed.sellerOrderId)
    await step(placed.sellerOrderId, 'CONFIRMED', 'BUYER')

    // 포트를 직접 두 번 더 부른다 — 전이는 멱등이라 두 번째 확정이 아무 사건도
    // 내지 않으므로, 그 길로는 「이벤트가 두 번 도착했다」를 만들 수 없다.
    const confirmedAt = clock.now()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await transitions().publish([
        {
          sellerOrderId: placed.sellerOrderId,
          from: 'DELIVERED',
          to: 'CONFIRMED',
          actor: 'SYSTEM',
          occurredAt: confirmedAt,
        },
      ])
    }

    const rows = await db.query(
      `SELECT count(*)::int AS n FROM "PointTransaction" WHERE "type" = 'EARN'`,
    )

    expect(rows[0]?.n).toBe(1)
    await expectReconciled(buyer.userId, (await points().balanceOf(buyer.userId)).balance)
  })
})

describe('사용', () => {
  /** 이 사람에게 적립금을 만들어 준다. 구매확정을 실제로 지나서. */
  async function grant(): Promise<number> {
    const placed = await place()

    await deliver(placed.sellerOrderId)
    await step(placed.sellerOrderId, 'CONFIRMED', 'BUYER')

    return (await points().balanceOf(buyer.userId)).balance
  }

  it('잔액을 깎고 원장에 사용을 남긴다 (F3)', async () => {
    const balance = await grant()
    const entry = await points().use({
      userId: buyer.userId,
      amount: 40,
      refType: 'ORDER',
      refId: randomUUID(),
    })

    expect(entry.type).toBe('USE')
    expect(entry.amount).toBe(-40)
    expect(entry.balanceAfter).toBe(balance - 40)
    await expectReconciled(buyer.userId, balance - 40)
  })

  it('**잔액보다 많이 쓸 수 없다** — 순차 (F4)', async () => {
    const balance = await grant()
    const refusal = await points()
      .use({ userId: buyer.userId, amount: balance + 1, refType: 'ORDER', refId: randomUUID() })
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(refusal).not.toBeNull()
    expect(failureOf(refusal).code).toBe('POINT_INSUFFICIENT')
    // 거절이 **그 순간** 쓸 수 있는 금액을 든다. 화면이 자기가 마지막으로 읽은
    // 잔액을 적으면 방금 다른 탭에서 쓴 금액을 모른 채 거짓을 말한다.
    expect(failureOf(refusal).params).toEqual({ available: balance })
    await expectReconciled(buyer.userId, balance)
  })

  it('**동시에 들어와도** 잔액을 넘지 못한다 (F7 · A7)', async () => {
    const balance = await grant()
    // 잔액의 60% 씩 셋. 하나만 성공해야 하고 둘이 성공하면 120% 가 나간다.
    const each = Math.ceil(balance * 0.6)
    const results = await concurrently(3, () =>
      points().use({
        userId: buyer.userId,
        amount: each,
        refType: 'ORDER',
        refId: randomUUID(),
      }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results).map((error) => failureOf(error).code)).toEqual([
      'POINT_INSUFFICIENT',
      'POINT_INSUFFICIENT',
    ])
    await expectReconciled(buyer.userId, balance - each)
  })

  it('여러 통을 **먼저 사라질 것부터** 비운다', async () => {
    const first = await grant()
    // 두 번째 적립은 하루 뒤라 더 늦게 사라진다.
    clock.set(new Date(Date.parse(DEFAULT_TEST_INSTANT) + 24 * 60 * 60 * 1000))

    const second = (await grant()) - first

    await points().use({
      userId: buyer.userId,
      amount: first + 1,
      refType: 'ORDER',
      refId: randomUUID(),
    })

    const lots = await db.query<{ remainingAmount: number }>(
      `SELECT t."remainingAmount"::int AS "remainingAmount"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1 AND t."type" = 'EARN'
        ORDER BY t."expiresAt" ASC`,
      [buyer.userId],
    )

    expect(lots.map((lot) => lot.remainingAmount)).toEqual([0, second - 1])
    await expectReconciled(buyer.userId, first + second - (first + 1))
  })

  it('원 단위 양수가 아닌 요청을 거절한다', async () => {
    const balance = await grant()

    for (const amount of [0, -100, 1.5]) {
      const refusal = await points()
        .use({ userId: buyer.userId, amount, refType: 'ORDER', refId: randomUUID() })
        .then(
          () => null,
          (error: unknown) => error,
        )

      expect(statusOf(refusal)).toBe(400)
    }

    // 음수 요청이 통을 **늘리지** 않았다. 계획이 그것을 먼저 막지 않으면
    // `Math.min(remaining, -100)` 이 -100 이 되어 통이 커진다.
    await expectReconciled(buyer.userId, balance)
  })

  it('같은 주문에 두 번 쓸 수 없다', async () => {
    const balance = await grant()
    const refId = randomUUID()

    await points().use({ userId: buyer.userId, amount: 10, refType: 'ORDER', refId })

    const refusal = await points()
      .use({ userId: buyer.userId, amount: 10, refType: 'ORDER', refId })
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(failureOf(refusal).code).toBe('POINT_ALREADY_RECORDED')
    await expectReconciled(buyer.userId, balance - 10)
  })
})

describe('계산 엔진에 꽂힌다 (D-036)', () => {
  it('적립금이 실결제금액을 줄인다 — 엔진을 다시 만들지 않는다', () => {
    const priced = calculateOrder({
      items: [{ itemId: 'i1', sellerId: 's1', unitPrice: UNIT_PRICE, quantity: 1 }],
      discounts: [pointDiscount(3_000)],
      shippingPolicies: [{ sellerId: 's1', fee: 0, freeThreshold: null }],
    })

    expect(priced.totalPointDiscountAmount).toBe(3_000)
    expect(priced.paidAmount).toBe(UNIT_PRICE - 3_000)
    expect(priced.items.at(0)?.pointDiscountAmount).toBe(3_000)
  })

  it('낼 돈보다 많이 깎지 않는다 — 상한은 엔진이 이미 안다', () => {
    // `pricing.md` 1장 ⑤ 「①−③+④ 범위 내에서 차감」이 이 저장소가 가진 **유일한**
    // 사용 상한이다. 주문금액 대비 비율이나 최소 결제금액 같은 규칙은 문서에 없고,
    // 그래서 여기에도 없다.
    const priced = calculateOrder({
      items: [{ itemId: 'i1', sellerId: 's1', unitPrice: 1_000, quantity: 1 }],
      discounts: [pointDiscount(5_000)],
      shippingPolicies: [{ sellerId: 's1', fee: 0, freeThreshold: null }],
    })

    expect(priced.totalPointDiscountAmount).toBe(1_000)
    expect(priced.paidAmount).toBe(0)
  })
})

describe('만료', () => {
  async function grantAndAge(): Promise<number> {
    const placed = await place()

    await deliver(placed.sellerOrderId)
    await step(placed.sellerOrderId, 'CONFIRMED', 'BUYER')

    const balance = (await points().balanceOf(buyer.userId)).balance
    const { validityDays } = await points().policy()

    clock.set(new Date(Date.parse(DEFAULT_TEST_INSTANT) + (validityDays + 1) * 86_400_000))

    return balance
  }

  it('기한이 지난 통이 **상태와 잔액을 함께** 옮긴다 (F8)', async () => {
    const balance = await grantAndAge()
    const result = await expiry().expire()

    expect(result.lots).toBe(1)
    expect(result.amount).toBe(balance)

    const lots = await db.query<{ remainingAmount: number }>(
      `SELECT t."remainingAmount"::int AS "remainingAmount"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1 AND t."type" = 'EARN'`,
      [buyer.userId],
    )
    const expired = await db.query<{ amount: number; refId: string | null }>(
      `SELECT t."amount"::int AS "amount", t."refId"::text AS "refId"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1 AND t."type" = 'EXPIRE'`,
      [buyer.userId],
    )

    // 통이 비었고(상태), 잔액이 내려갔고, 원장에 그 사실이 자기가 닫은 통을
    // 가리키며 남았다. 셋 중 하나만 일어나면 대사가 깨진다.
    expect(lots.map((lot) => lot.remainingAmount)).toEqual([0])
    expect(expired.at(0)?.amount).toBe(-balance)
    expect(expired.at(0)?.refId).not.toBeNull()
    await expectReconciled(buyer.userId, 0)
  })

  it('기한이 지난 적립금은 쓸 수 없다 — 배치가 아직 안 돌았어도', async () => {
    const balance = await grantAndAge()
    const refusal = await points()
      .use({ userId: buyer.userId, amount: balance, refType: 'ORDER', refId: randomUUID() })
      .then(
        () => null,
        (error: unknown) => error,
      )

    // 여기서 통과시키면 배치가 도는 순간 같은 금액을 두 번 없애야 한다.
    expect(failureOf(refusal).code).toBe('POINT_INSUFFICIENT')
    expect(failureOf(refusal).params).toEqual({ available: 0 })
  })

  it('두 번째 주기는 아무 일도 하지 않는다', async () => {
    await grantAndAge()
    await expiry().expire()

    const again = await expiry().expire()

    expect(again.lots).toBe(0)
    await expectReconciled(buyer.userId, 0)
  })

  it('돈 사실을 남긴다 — 밖에서 배치가 살아 있는지 보이는 유일한 자리', async () => {
    const balance = await grantAndAge()

    await expiry().expire()

    const rows = await db.query<{ key: string; value: string }>(
      `SELECT "key", "value" FROM "AppMeta" WHERE "key" = ANY($1::text[]) ORDER BY "key"`,
      [[POINT_EXPIRY_LAST_EXPIRED_KEY, POINT_EXPIRY_LAST_RUN_KEY]],
    )

    expect(rows.map((row) => row.key)).toEqual([
      POINT_EXPIRY_LAST_EXPIRED_KEY,
      POINT_EXPIRY_LAST_RUN_KEY,
    ])
    expect(await expiry().lastExpired()).toBe(balance)
    expect((await expiry().lastRunAt())?.toISOString()).toBe(clock.now().toISOString())
  })
})

describe('마지막 방어선은 데이터베이스다', () => {
  /** 서비스를 지나지 않는 날 SQL. 제약이 실제로 강제되는지만 본다 (게이트 S5). */
  async function refusedByDatabase(statement: string, values: readonly unknown[]): Promise<string> {
    const error: unknown = await db.query(statement, values).then(
      () => null,
      (reason: unknown) => reason,
    )

    if (error === null) throw new Error('데이터베이스가 거절할 것으로 기대했습니다.')

    return String((error as { constraint?: string }).constraint ?? '')
  }

  async function accountId(): Promise<string> {
    await points().earn({
      userId: buyer.userId,
      paidAmount: 100_000,
      refType: 'SELLER_ORDER',
      refId: randomUUID(),
    })

    const row = await db.one<{ id: string }>(
      `SELECT "id"::text AS "id" FROM "PointAccount" WHERE "userId" = $1`,
      [buyer.userId],
    )

    return row.id
  }

  it('**음수 잔액을 거절한다**', async () => {
    const id = await accountId()

    expect(
      await refusedByDatabase(`UPDATE "PointAccount" SET "balance" = -1 WHERE "id" = $1`, [id]),
    ).toBe('PointAccount_balance_check')
  })

  it('부호가 뒤집힌 사건을 거절한다', async () => {
    const id = await accountId()

    expect(
      await refusedByDatabase(
        `INSERT INTO "PointTransaction"
           ("id", "accountId", "seq", "type", "amount", "balanceAfter")
         VALUES (gen_random_uuid(), $1, 99, 'USE', 500, 0)`,
        [id],
      ),
    ).toBe('PointTransaction_direction_check')
  })

  it('0원짜리 사건을 거절한다', async () => {
    const id = await accountId()

    expect(
      await refusedByDatabase(
        `INSERT INTO "PointTransaction"
           ("id", "accountId", "seq", "type", "amount", "balanceAfter", "reason")
         VALUES (gen_random_uuid(), $1, 99, 'ADJUST', 0, 0, '정정')`,
        [id],
      ),
    ).toBe('PointTransaction_amount_check')
  })

  it('통의 세 칸이 EARN 이 아닌 행에 붙는 것을 거절한다', async () => {
    const id = await accountId()

    expect(
      await refusedByDatabase(
        `INSERT INTO "PointTransaction"
           ("id", "accountId", "seq", "type", "amount", "balanceAfter", "remainingAmount")
         VALUES (gen_random_uuid(), $1, 99, 'USE', -100, 0, 100)`,
        [id],
      ),
    ).toBe('PointTransaction_lot_check')
  })

  it('한 참조에 두 번째 사건을 거절한다 — 멱등이 여기서 만들어진다', async () => {
    const id = await accountId()
    const refId = randomUUID()

    await db.query(
      `INSERT INTO "PointTransaction"
         ("id", "accountId", "seq", "type", "amount", "balanceAfter", "refType", "refId",
          "expiresAt", "remainingAmount", "earnRateBp")
       VALUES (gen_random_uuid(), $1, 90, 'EARN', 10, 1010, 'SELLER_ORDER', $2, now(), 10, 100)`,
      [id, refId],
    )

    const error: unknown = await db
      .query(
        `INSERT INTO "PointTransaction"
           ("id", "accountId", "seq", "type", "amount", "balanceAfter", "refType", "refId",
            "expiresAt", "remainingAmount", "earnRateBp")
         VALUES (gen_random_uuid(), $1, 91, 'EARN', 10, 1020, 'SELLER_ORDER', $2, now(), 10, 100)`,
        [id, refId],
      )
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect(String((error as { constraint?: string })?.constraint)).toBe('PointTransaction_ref_key')
  })

  it('원장 행의 삭제와 수정을 거절한다 — 남은 금액이 줄어드는 것만 빼고', async () => {
    const id = await accountId()
    const lot = await db.one<{ id: string }>(
      `SELECT "id"::text AS "id" FROM "PointTransaction" WHERE "accountId" = $1`,
      [id],
    )

    expect(
      await refusedByDatabase(`DELETE FROM "PointTransaction" WHERE "id" = $1`, [lot.id]),
    ).toBe('PointTransaction_append_only')
    expect(
      await refusedByDatabase(`UPDATE "PointTransaction" SET "amount" = 1 WHERE "id" = $1`, [
        lot.id,
      ]),
    ).toBe('PointTransaction_append_only')
    // 늘리는 것도 수정이다. 통이 커지면 잔액과 갈라진다(P5).
    expect(
      await refusedByDatabase(
        `UPDATE "PointTransaction" SET "remainingAmount" = "remainingAmount" + 1 WHERE "id" = $1`,
        [lot.id],
      ),
    ).toBe('PointTransaction_append_only')

    // 줄어드는 것은 통이 비어 가는 일이고, 사용이 하는 일이다.
    expect(
      await db.execute(
        `UPDATE "PointTransaction" SET "remainingAmount" = "remainingAmount" - 1 WHERE "id" = $1`,
        [lot.id],
      ),
    ).toBe(1)
  })

  it('정책은 두 번째 행을 가질 수 없고, 범위를 벗어난 적립률을 받지 않는다', async () => {
    await points().policy()

    expect(
      await refusedByDatabase(
        `INSERT INTO "PointPolicy" ("id", "earnRateBp", "validityDays", "updatedAt")
         VALUES (2, 100, 365, now())`,
        [],
      ),
    ).toBe('PointPolicy_singleton_check')
    expect(
      await refusedByDatabase(`UPDATE "PointPolicy" SET "earnRateBp" = 10001 WHERE "id" = 1`, []),
    ).toBe('PointPolicy_earnRateBp_check')
    expect(
      await refusedByDatabase(`UPDATE "PointPolicy" SET "earnRateBp" = -1 WHERE "id" = 1`, []),
    ).toBe('PointPolicy_earnRateBp_check')
  })
})

describe('대사는 어긋난 계정을 실제로 찾아낸다', () => {
  it('원장 밖에서 잔액을 고치면 잡는다 — 음성 대조', async () => {
    await points().earn({
      userId: buyer.userId,
      paidAmount: 100_000,
      refType: 'SELLER_ORDER',
      refId: randomUUID(),
    })

    expect(await points().reconcile()).toEqual([])

    // 「대사가 언제나 빈 목록을 답한다」와 「원장이 건강하다」는 다른 말이다.
    // 이 한 줄이 없으면 이 파일의 모든 `expectReconciled` 가 장식이다.
    await db.query(`UPDATE "PointAccount" SET "balance" = "balance" + 7 WHERE "userId" = $1`, [
      buyer.userId,
    ])

    const faults = await points().reconcile()

    expect(faults).toHaveLength(1)
    expect(faults.at(0)?.userId).toBe(buyer.userId)
    expect(faults.at(0)?.faults).toEqual(['sum_mismatch', 'endpoint_mismatch', 'lot_mismatch'])
  })
})

// ---------------------------------------------------------------- 도우미

interface Failure {
  readonly code: string
  readonly params: Readonly<Record<string, unknown>> | undefined
}

/** 도메인 실패의 코드와 값. 문장이 아니라 코드를 단언한다 (`error-contract.md`). */
function failureOf(error: unknown): Failure {
  const payload = (error as { getResponse?: () => unknown }).getResponse?.()
  const body = payload as
    { code?: string; details?: readonly { params?: Record<string, unknown> }[] } | undefined

  return { code: body?.code ?? '', params: body?.details?.at(0)?.params }
}

/** 그 몫의 실결제금액. 적립의 근거를 스펙이 다시 계산하지 않는다. */
async function paidAmountOf(sellerOrderId: string): Promise<number> {
  const row = await db.one<{ paidAmount: number }>(
    `SELECT "paidAmount"::int AS "paidAmount" FROM "SellerOrder" WHERE "id" = $1`,
    [sellerOrderId],
  )

  return row.paidAmount
}

function statusOf(error: unknown): number {
  return (error as { getStatus?: () => number }).getStatus?.() ?? 0
}
