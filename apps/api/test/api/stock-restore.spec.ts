import { Logger } from '@nestjs/common'
import type { ApiClient, PaymentProviderName, PaymentStatus } from '@shopping/shared'
import {
  cartResponseSchema,
  claimResponseSchema,
  claimTransitionResponseSchema,
  orderResponseSchema,
  returnResponseSchema,
} from '@shopping/shared'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { ClaimRestockService } from '../../src/claims/restock.service.js'
import type {
  AuthorizeRequest,
  AuthorizeResult,
  PaymentProviderPort,
} from '../../src/payment/payment-provider.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import { StockService } from '../../src/stock/stock.service.js'
import { useApiApp } from '../support/api-app.js'
import { fixedClock } from '../support/clock.js'
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
 * 재고 복원 (TASK-0069), 이 워커의 실제 데이터베이스에 대고.
 *
 * 자리 판단이 옳은지는 `src/claims/restock-plan.spec.ts` 가 순수 함수로 잰다.
 * **여기서 재는 것은 그 판단이 실제 행과 실제 원장에 적용되는가**이고, 값이 네 곳에
 * 몰려 있다.
 *
 * | 무엇을 | 왜 그것이 증거인가 |
 * | --- | --- |
 * | 취소 확정 → `CANCEL` 한 줄, 반품 합격 → `RETURN_IN` 한 줄 | 원장 없이 늘어난 재고는 대사가 불가능하다 |
 * | **불합격은 아무 일도 일어나지 않는다** | 물건은 구매자에게 반송된다. 늘어난 재고는 팔린 뒤에야 없는 것으로 드러난다 |
 * | 두 번 불러도 한 번만 — **순차와 동시 둘 다** | 애플리케이션 검사만으로는 동시 호출이 **둘 다** 「아직 없다」를 읽는다 |
 * | 사라진 상품은 건너뛰되 **클레임은 끝난다** | 데모 판매자가 만료된 뒤의 취소가 500 이 되면 안 된다 (TASK-0025) |
 *
 * 그리고 모든 갈래 끝에서 **원장 합계 = 재고**를 SQL 로 다시 센다. 이 TASK 의
 * 요구사항이 그 한 줄이고, 그것이 참이 아니면 위의 단언은 전부 우연이다.
 *
 * **결제사만 대역이다** (QUALITY-GATES 6장). 데이터베이스도 원장 서비스도 클레임도
 * 전부 실제이고, 포트는 **바꿔 끼우지 않는다** — 이 TASK 가 재야 할 것 중 하나가
 * 「모듈이 실제 구현을 바인딩했는가」이기 때문이다. 대역으로 바꾸면 그 배선이
 * 빠져도 초록이다.
 */

/** 언제나 승인하는 결제사. 재는 것이 돈이 아니므로 대본이 필요 없다. */
class ApprovingProvider implements PaymentProviderPort {
  readonly name: PaymentProviderName = 'VIRTUAL_CARD'

  authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    return Promise.resolve({ outcome: 'approved', paymentKey: `card-${request.paymentId}` })
  }

  capture(): Promise<void> {
    return Promise.resolve()
  }

  cancel(): Promise<void> {
    return Promise.resolve()
  }

  refund(): Promise<void> {
    return Promise.resolve()
  }

  recover(paymentId: string): Promise<AuthorizeResult> {
    return Promise.resolve({ outcome: 'approved', paymentKey: `card-${paymentId}` })
  }

  getStatus(): Promise<PaymentStatus> {
    return Promise.resolve('PAID')
  }
}

const db = useDatabase()
const clock = fixedClock('2026-09-03T00:00:00.000Z')
const api = useApiApp({ database: db, authenticate: true, clock })

/** 이 스펙이 서는 시각. 반품 기간의 안쪽을 여기서부터 잰다. */
const NOW = '2026-09-03T00:00:00.000Z'

/** 조합 하나가 문을 열 때 갖고 있던 수량. 원장의 첫 줄이 이것이다. */
const OPENING = 20

interface PlacedItem {
  readonly id: string
  readonly variantId: string
  readonly quantity: number
}

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly seller: TestCaller
  readonly items: readonly PlacedItem[]
}

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

function restocks(): ClaimRestockService {
  return api.resolve<ClaimRestockService>(ClaimRestockService)
}

function stock(): StockService {
  return api.resolve<StockService>(StockService)
}

beforeAll(() => {
  // 앱이 뜬 **뒤**다. 레지스트리는 앱의 것이라 이 등록은 파일이 끝날 때까지 산다.
  api.resolve<PaymentProviderRegistry>(PaymentProviderRegistry).register(new ApprovingProvider())
})

beforeEach(async () => {
  clock.set(NOW)

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  principal = { app: 'shop', userId: account.id, roles: ['BUYER'], sellerId: null }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
})

/**
 * 팔 수 있는 조합 하나 — **개시 입고를 원장에 남긴 채로**.
 *
 * 팩토리는 행만 넣는다(`createProductVariant`). 그 상태로 두면 원장 합계(0)와
 * 재고(20)가 어긋난 조합이 되어, 이 파일이 마지막에 세는 「합계 = 재고」가 이 TASK
 * 와 무관한 이유로 빨개진다. 실제 상품 등록은 `StockService.open` 이 이 줄을 남기고
 * (TASK-0036), 여기서는 같은 사실을 SQL 한 문장으로 심는다.
 */
async function sellableVariant(sellerId: string, price: number): Promise<string> {
  const product = await createProduct(db, {
    sellerId,
    categoryId,
    status: 'ACTIVE',
    minPrice: price,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId,
    price,
    stock: OPENING,
    isActive: true,
  })

  await db.query(
    `INSERT INTO "StockLedger"
       ("variantId", "seq", "type", "quantity", "balanceAfter", "reason")
     VALUES ($1, 1, 'INBOUND', $2, $2, '테스트 초기 재고')`,
    [variant.id, OPENING],
  )

  return variant.id
}

/** 한 판매자의 몫 하나. 줄의 수량은 호출자가 정한다. */
async function place(quantities: readonly number[]): Promise<Placed> {
  const owner = await createUser(db, {})
  const store = await createSeller(db, { userId: owner.id })
  const itemIds: string[] = []

  for (const [index, quantity] of quantities.entries()) {
    const variantId = await sellableVariant(store.id, 10_000 * (index + 1))
    const cart = await client().request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId, quantity },
      schema: cartResponseSchema,
    })
    const line = cart.groups.flatMap((group) => group.items).find((i) => i.variantId === variantId)

    if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

    itemIds.push(line.id)
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
    // 수량 오름차순. 어느 줄이 어느 줄인지가 실행 순서에 흔들리지 않게 한다.
    items: await db.query<PlacedItem>(
      `SELECT "id", "variantId", "quantity" FROM "OrderItem"
        WHERE "sellerOrderId" = $1 ORDER BY "quantity", "id"`,
      [bundle.id],
    ),
  }
}

/**
 * 매입까지. **여기서 처음으로 재고가 줄어든다** — 그전까지 주문은 재고를 잡고만
 * 있었다 (`OrderService.markPaid`). 되돌릴 것이 생기는 자리가 여기다.
 */
async function pay(placed: Placed): Promise<void> {
  const { payment } = await payments().start(principal, placed.orderId, 'VIRTUAL_CARD')

  await payments().authorize(principal, payment.id)
  await payments().capture(principal, payment.id)
}

/** 결제된 몫의 취소 신청. `PAID` 라 규칙이 그 자리에서 승인하고 후속이 뒤따른다. */
async function cancel(
  placed: Placed,
  lines: readonly { readonly orderItemId: string; readonly quantity: number }[],
): Promise<string> {
  const { claim } = await client().request({
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

  return claim.id
}

/** 배송완료로 두고 **반품 기간 안**에 세운다 (`return-flow.spec.ts` 와 같은 장치). */
async function deliver(placed: Placed): Promise<void> {
  await db.query(
    `UPDATE "SellerOrder" SET "status" = 'DELIVERED'::"SellerOrderStatus" WHERE "id" = $1`,
    [placed.sellerOrderId],
  )
  await db.query(
    `INSERT INTO "OrderStatusHistory"
       ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "actorId", "createdAt")
     VALUES (gen_random_uuid(), $1, 'SHIPPED', 'DELIVERED', 'SYSTEM', NULL, now())`,
    [placed.sellerOrderId],
  )
}

/** 반품 신청 → 승인 → 수거 → 입고. 검수 앞에 세우는 것이 전부다. */
async function upToInspecting(placed: Placed, item: PlacedItem, quantity: number): Promise<string> {
  const { claim } = await client().request({
    path: '/returns',
    method: 'POST',
    body: {
      sellerOrderId: placed.sellerOrderId,
      items: [{ orderItemId: item.id, quantity }],
      reason: '받아 보니 박음질이 터져 있어요.',
      return: {
        returnReason: 'DEFECTIVE',
        photoKeys: [`returns/${buyer.userId}/00000001-0000-4000-8000-000000000000.jpg`],
      },
    },
    schema: returnResponseSchema,
  })

  await client(placed.seller).request({
    path: `/claims/${claim.id}/transitions`,
    method: 'POST',
    body: { to: 'RETURN_APPROVED' },
    schema: claimTransitionResponseSchema,
  })
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

  return claim.id
}

/** 검수 결과를 찍는다. 합격만 재입고를 부른다. */
function inspect(placed: Placed, claimId: string, passed: boolean) {
  return client(placed.seller).request({
    path: `/returns/${claimId}/inspection`,
    method: 'POST',
    body: { passed, note: passed ? null : '사용감이 뚜렷해요.' },
    schema: returnResponseSchema,
  })
}

// --------------------------------------------------------------------- reads

async function stockOf(variantId: string): Promise<number> {
  const row = await db.one<{ stock: number }>(
    'SELECT "stock" FROM "ProductVariant" WHERE "id" = $1',
    [variantId],
  )

  return row.stock
}

interface LedgerRow {
  readonly seq: number
  readonly type: string
  readonly quantity: number
  readonly balanceAfter: number
  readonly refType: string | null
  readonly refId: string | null
  readonly actorId: string | null
}

function ledgerOf(variantId: string): Promise<LedgerRow[]> {
  return db.query<LedgerRow>(
    `SELECT "seq", "type"::text AS "type", "quantity", "balanceAfter",
            "refType"::text AS "refType", "refId", "actorId"
       FROM "StockLedger" WHERE "variantId" = $1 ORDER BY "seq"`,
    [variantId],
  )
}

/** 이 클레임의 항목 id 들. 멱등 열쇠가 무엇인지를 단언하는 데 쓴다. */
function claimItemIds(claimId: string): Promise<{ id: string }[]> {
  return db.query<{ id: string }>(
    'SELECT "id" FROM "ClaimItem" WHERE "claimId" = $1 ORDER BY "id"',
    [claimId],
  )
}

function claimStatusOf(claimId: string): Promise<{ status: string }> {
  return db.one<{ status: string }>(
    'SELECT "status"::text AS "status" FROM "ClaimRequest" WHERE "id" = $1',
    [claimId],
  )
}

/**
 * **원장 합계 = 재고.** 이 TASK 의 요구사항 한 줄을 SQL 로 다시 센다.
 *
 * 애플리케이션을 지나지 않는 것이 요점이다 — `StockService.reconcile` 도 아래에서
 * 함께 부르지만, 그 함수가 틀렸을 때 그것만으로는 알 수 없다. 여기서 세는 것은
 * 데이터베이스가 들고 있는 두 수뿐이다.
 */
async function unexplainedVariants(): Promise<{ variantId: string }[]> {
  return db.query<{ variantId: string }>(
    `SELECT pv."id" AS "variantId"
       FROM "ProductVariant" pv
       LEFT JOIN LATERAL (SELECT COALESCE(sum(l."quantity"), 0) AS moved
                            FROM "StockLedger" l WHERE l."variantId" = pv."id") m ON TRUE
      WHERE pv."stock" <> m.moved`,
  )
}

/** 두 층이 같은 답을 낸다 — 날 SQL 과 `reconcile` 이 둘 다 「어긋난 것이 없다」. */
async function expectLedgerExplainsStock(): Promise<void> {
  expect(await unexplainedVariants()).toEqual([])
  expect(await stock().reconcile()).toEqual([])
}

describe('F1 — 취소 확정은 그만큼 되돌린다', () => {
  it('adds the canceled quantity back and records exactly one CANCEL entry', async () => {
    const placed = await place([3])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    expect(await stockOf(item.variantId)).toBe(OPENING - 3)

    const claimId = await cancel(placed, [{ orderItemId: item.id, quantity: 2 }])

    expect(await stockOf(item.variantId)).toBe(OPENING - 3 + 2)

    const [claimItem] = await claimItemIds(claimId)
    const entries = await ledgerOf(item.variantId)

    // 개시 입고 · 판매 확정 · 복원. 복원 줄이 **하나**인 것이 F1 이다.
    expect(entries.map((entry) => entry.type)).toEqual(['INBOUND', 'RESERVE_CONFIRM', 'CANCEL'])
    expect(entries.at(-1)).toMatchObject({
      type: 'CANCEL',
      quantity: 2,
      balanceAfter: OPENING - 1,
      refType: 'CLAIM_ITEM',
      // **열쇠는 클레임 항목의 id 다.** 클레임의 id 가 아닌 이유는
      // `restock.service.ts` 가 적어 두었다 — 한 클레임이 같은 조합을 두 줄로 들고
      // 있을 수 있고, 그때 클레임 id 로 잡으면 둘째 줄이 조용히 삼켜진다.
      refId: claimItem?.id,
      // 사람이 없는 변동이다. 승인한 판매자를 적으면 「그가 입고했다」는 거짓이 남는다.
      actorId: null,
    })
    await expectLedgerExplainsStock()
  })

  /** 환불이 먼저 불려 클레임은 이미 `REFUNDED` 다. 그 자리에서도 복원은 일어난다. */
  it('restores even though the refund has already moved the claim to REFUNDED', async () => {
    const placed = await place([2])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)

    const claimId = await cancel(placed, [{ orderItemId: item.id, quantity: 2 }])

    expect(await claimStatusOf(claimId)).toEqual({ status: 'REFUNDED' })
    expect(await stockOf(item.variantId)).toBe(OPENING)
    await expectLedgerExplainsStock()
  })
})

describe('F2 · F3 — 반품은 검수 결과로 갈린다', () => {
  it('records a RETURN_IN once the inspection passes', async () => {
    const placed = await place([2])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    await deliver(placed)

    const claimId = await upToInspecting(placed, item, 1)

    expect(await stockOf(item.variantId)).toBe(OPENING - 2)

    await inspect(placed, claimId, true)

    expect(await stockOf(item.variantId)).toBe(OPENING - 1)

    const entries = await ledgerOf(item.variantId)

    expect(entries.map((entry) => entry.type)).toEqual([
      'INBOUND',
      'RESERVE_CONFIRM',
      // 취소가 아니다. 둘을 한 유형으로 접으면 「반품이 얼마나 들어오나」에 답할
      // 방법이 사라진다 (`restock-plan.ts`).
      'RETURN_IN',
    ])
    expect(entries.at(-1)).toMatchObject({ type: 'RETURN_IN', quantity: 1 })
    await expectLedgerExplainsStock()
  })

  /**
   * **불합격은 아무 일도 일어나지 않는다** (F3).
   *
   * 물건은 판매자에게 있지만 그것은 구매자의 것이고, 같은 걸음에서 반송장이 난다.
   * 여기서 재고가 늘면 팔 수 없는 물건이 팔린다.
   */
  it('leaves the stock and the ledger untouched when the inspection fails', async () => {
    const placed = await place([2])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    await deliver(placed)

    const claimId = await upToInspecting(placed, item, 1)

    await inspect(placed, claimId, false)

    expect(await claimStatusOf(claimId)).toEqual({ status: 'RETURN_REJECTED' })
    expect(await stockOf(item.variantId)).toBe(OPENING - 2)
    expect((await ledgerOf(item.variantId)).map((entry) => entry.type)).toEqual([
      'INBOUND',
      'RESERVE_CONFIRM',
    ])

    // 불합격한 반품을 실행기에 **직접** 물어도 답이 같다. 부르는 쪽이 갈라 주는
    // 것과 실행기가 스스로 아는 것은 다른 겹이고, 이 TASK 는 둘 다 갖는다.
    expect(await restocks().restore(claimId)).toMatchObject({ outcome: 'not_due', restored: 0 })
    expect(await stockOf(item.variantId)).toBe(OPENING - 2)
    await expectLedgerExplainsStock()
  })
})

describe('F4 · F7 — 두 번 되돌리지 않는다', () => {
  it('does nothing the second time it is called in sequence', async () => {
    const placed = await place([3])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)

    const claimId = await cancel(placed, [{ orderItemId: item.id, quantity: 2 }])

    expect(await restocks().restore(claimId)).toEqual({
      outcome: 'skipped',
      restored: 0,
      alreadyRecorded: 1,
      dropped: 0,
    })
    expect(await stockOf(item.variantId)).toBe(OPENING - 1)
    expect(
      (await ledgerOf(item.variantId)).filter((entry) => entry.type === 'CANCEL'),
    ).toHaveLength(1)
    await expectLedgerExplainsStock()
  })

  /**
   * **동시 호출도 한 번만 늘린다** (F7 · QUALITY-GATES A7).
   *
   * 순차 검사는 이 성질을 증명하지 못한다 — 애플리케이션 검사만으로도 통과하고,
   * 그 구현에서 동시 호출은 **둘 다** 「아직 없다」를 읽는다. 그래서 아직 복원되지
   * 않은 클레임을 만들어 넷을 한꺼번에 던진다.
   *
   * 자리를 만드는 방법이 SQL 한 문장인 것은, 승인이 **후속을 곧바로 부르기**
   * 때문이다(`publishCancel`). 승인 API 를 지나면 그 순간 이미 복원돼 있어 경합할
   * 것이 남지 않는다. 여기서 재현하는 것은 「승인은 커밋됐는데 복원을 부르기 전에
   * 죽은 프로세스」이고, 그것이 재시도가 실제로 도착하는 자리다.
   */
  it('increases the stock once when four callers arrive together', async () => {
    const placed = await place([4])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    // `PREPARING` 이라 규칙이 스스로 승인하지 않는다 — 신청만 서고 후속은 없다.
    await db.query(
      `UPDATE "SellerOrder" SET "status" = 'PREPARING'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )

    const claimId = await cancel(placed, [{ orderItemId: item.id, quantity: 3 }])

    expect(await claimStatusOf(claimId)).toEqual({ status: 'CANCEL_REQUESTED' })
    await db.query(
      `UPDATE "ClaimRequest" SET "status" = 'CANCEL_APPROVED'::"ClaimStatus" WHERE "id" = $1`,
      [claimId],
    )

    const results = await concurrently(4, () => restocks().restore(claimId))
    const reports = fulfilled(results)

    expect(reports.filter((report) => report.restored === 1)).toHaveLength(1)
    // **아무도 실패하지 않는다.** 인덱스가 마지막 방어선이라면 진 쪽은 유니크
    // 위반으로 끝날 텐데, 클레임 행 잠금이 그 앞에 서므로 뒤에 온 셋은 앞사람이
    // 커밋한 원장을 보고 조용히 건너뛴다.
    expect(reports.filter((report) => report.outcome === 'failed')).toHaveLength(0)
    expect(reports.filter((report) => report.alreadyRecorded === 1)).toHaveLength(3)

    expect(await stockOf(item.variantId)).toBe(OPENING - 4 + 3)
    expect(
      (await ledgerOf(item.variantId)).filter((entry) => entry.type === 'CANCEL'),
    ).toHaveLength(1)
    await expectLedgerExplainsStock()
  })

  /**
   * 마지막 방어선이 **데이터베이스에 있다** (QUALITY-GATES S5 · TASK-0065 4.1).
   *
   * 위의 잠금이 답이라도 제약이 없으면 그 잠금을 안 쓰는 코드가 하나 생기는 날
   * 조용히 넘친다. 그래서 애플리케이션을 지나지 않고 **날 SQL 로** 같은 열쇠의
   * 원장 행을 한 번 더 넣어 본다.
   */
  it('refuses a second ledger row for the same claim item, in the database itself', async () => {
    const placed = await place([3])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)

    const claimId = await cancel(placed, [{ orderItemId: item.id, quantity: 2 }])
    const [claimItem] = await claimItemIds(claimId)

    await expect(
      db.query(
        `INSERT INTO "StockLedger"
           ("variantId", "seq", "type", "quantity", "balanceAfter", "refType", "refId")
         VALUES ($1, 99, 'CANCEL', 2, 99, 'CLAIM_ITEM', $2)`,
        [item.variantId, claimItem?.id],
      ),
    ).rejects.toThrow(/StockLedger_ref_key/)
  })
})

describe('F5 — 사라진 상품은 건너뛰되 클레임은 끝난다', () => {
  it('finishes the claim, restores nothing, and says so in the log', async () => {
    const placed = await place([2])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    // 데모 판매자가 만료된 뒤의 모양. **소프트 삭제다** — 팔린 조합은
    // `OrderItem.variantId` 와 `StockLedger.variantId` 가 `RESTRICT` 로 잡고 있어
    // 하드 삭제될 수 없고, 상품 삭제도 데모 정리도 `deletedAt` 을 찍는다.
    await db.query(
      `UPDATE "ProductVariant" SET "deletedAt" = now(), "isActive" = false WHERE "id" = $1`,
      [item.variantId],
    )

    const warned = vi.spyOn(Logger.prototype, 'warn')

    try {
      const claimId = await cancel(placed, [{ orderItemId: item.id, quantity: 2 }])

      // 클레임은 끝까지 간다. 여기서 던지면 데모 판매자가 만료된 뒤의 취소가 전부
      // 500 이 된다.
      expect(await claimStatusOf(claimId)).toEqual({ status: 'REFUNDED' })
      expect(await stockOf(item.variantId)).toBe(OPENING - 2)
      expect((await ledgerOf(item.variantId)).map((entry) => entry.type)).toEqual([
        'INBOUND',
        'RESERVE_CONFIRM',
      ])

      // 원장에 아무것도 남지 않으므로 **로그가 유일한 흔적**이다.
      const said = warned.mock.calls
        .flat()
        .some((arg) => typeof arg === 'string' && arg.includes(item.variantId))

      expect(said).toBe(true)
    } finally {
      warned.mockRestore()
    }

    await expectLedgerExplainsStock()
  })

  /**
   * **`isActive` 는 「사라졌다」가 아니다.**
   *
   * 판매자가 「지금은 이 조합을 안 판다」고 말한 것뿐이라 되살아날 수 있고, 그때
   * 되돌려 두지 않은 재고는 되돌릴 방법이 없다 (`restock-plan.ts`).
   */
  it('still restores a combination the seller has merely switched off', async () => {
    const placed = await place([2])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    await db.query('UPDATE "ProductVariant" SET "isActive" = false WHERE "id" = $1', [
      item.variantId,
    ])

    await cancel(placed, [{ orderItemId: item.id, quantity: 2 }])

    expect(await stockOf(item.variantId)).toBe(OPENING)
    await expectLedgerExplainsStock()
  })
})

/**
 * **실패가 클레임을 되돌리지 않는다.**
 *
 * 후속은 커밋 뒤에 불리므로 여기서 던지면 승인·검수는 이미 끝난 채 예외만 위로
 * 올라간다 — 취소 API 가 500 으로 답하는데 취소는 되어 있는 모양이다. 그래서
 * 실행기는 **무슨 일이 있어도 값으로 답한다** (`refund.service.ts` 와 같은 성질).
 */
describe('실행기는 던지지 않는다', () => {
  it('answers with a failure instead of throwing when the claim is not there', async () => {
    expect(await restocks().restore('00000000-0000-7000-8000-0000000000ff')).toEqual({
      outcome: 'failed',
      restored: 0,
      alreadyRecorded: 0,
      dropped: 0,
    })
  })
})

describe('F6 — 부분 취소를 여러 번 해도 합계가 맞는다', () => {
  it('gives back exactly the ordered quantity across three partial cancels', async () => {
    const placed = await place([3])
    const item = placed.items[0]

    if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)

    for (let round = 0; round < 3; round += 1) {
      await cancel(placed, [{ orderItemId: item.id, quantity: 1 }])
    }

    const restored = (await ledgerOf(item.variantId)).filter((entry) => entry.type === 'CANCEL')

    // 세 줄이고 합이 주문 수량이다 — 한 줄로 접히지도, 한 줄이 새지도 않았다.
    expect(restored).toHaveLength(3)
    expect(restored.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(3)
    expect(await stockOf(item.variantId)).toBe(OPENING)
    await expectLedgerExplainsStock()
  })

  /**
   * 한 몫에 **줄이 둘**일 때 둘 다 돌아온다.
   *
   * 열쇠가 클레임 항목이므로 한 클레임의 두 줄이 서로를 가리지 않는다. 클레임 id 로
   * 잡았다면 여기서 둘째 줄이 조용히 사라진다.
   */
  it('restores every line of one claim, not just the first', async () => {
    const placed = await place([2, 3])
    const [first, second] = placed.items

    if (first === undefined || second === undefined) throw new Error('항목을 찾지 못했습니다.')

    await pay(placed)
    await cancel(placed, [
      { orderItemId: first.id, quantity: 2 },
      { orderItemId: second.id, quantity: 3 },
    ])

    expect(await stockOf(first.variantId)).toBe(OPENING)
    expect(await stockOf(second.variantId)).toBe(OPENING)
    await expectLedgerExplainsStock()
  })
})
