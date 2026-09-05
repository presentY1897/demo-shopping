import type { ApiClient, ClaimStatus, OrderStatus } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  claimableResponseSchema,
  claimListResponseSchema,
  claimResponseSchema,
  claimTransitionResponseSchema,
  orderResponseSchema,
  sellerOrderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AppConfig } from '../../src/config/app-config.js'
import { APP_CONFIG } from '../../src/config/app-config.js'
import { autoConfirmWindowMs } from '../../src/orders/order-confirm.js'
import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently } from '../support/concurrently.js'
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
import { callers } from '../support/principal.js'

/**
 * 클레임 — 취소 · 반품 (TASK-0065), 이 워커의 실제 데이터베이스에 대고.
 *
 * 규칙 표가 옳은지는 `claim-rules.spec.ts` 가 순수 함수로 잰다. **여기서 재는 것은
 * 그 표가 행에 실제로 적용되는가**이고, 그중 값의 절반이 하나에 몰려 있다:
 * **동시에 들어온 두 신청이 남은 수량을 넘지 못하는가** (R1).
 *
 * 그 검사가 뜻을 가지려면 두 요청이 **각자 「아직 남았다」를 읽는** 상황이 실제로
 * 만들어져야 한다. 두 요청을 동시에 쏘는 것만으로는 그 겹침이 우연이고, 겹치지 않은
 * 실행에서도 단언은 초록이다 — 즉 코드가 깨진 기계에서 통과한다. 그래서 아래
 * 「동시 신청」은 바깥 커넥션이 `OrderItem` 행을 먼저 잠가 **겹침을 배열한다.**
 *
 * 마지막 방어선(제약)은 애플리케이션을 지나지 않고 **날 SQL 로** 위반해 본다
 * (QUALITY-GATES S5). 마이그레이션 파일에 문자열이 있는지 보는 것만으로는 조건이
 * 잘못 적힌 경우를 못 잡는다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 이 스펙이 서는 시각. 반품 기간의 안팎을 여기서부터 잰다. */
const NOW = '2026-09-03T00:00:00.000Z'

/**
 * 반품 기간 — **자동 구매확정과 같은 축에서, 이 앱이 실제로 쓰는 설정으로** (R2).
 *
 * 숫자를 여기 적지 않는 이유가 이 스펙의 한 항목이다. 적으면 배포의 축이 바뀌어도
 * 검사는 초록이고, 그때 증상은 「데모에서 배송은 6분인데 반품은 7일」이다.
 */
function returnWindowMs(): number {
  return autoConfirmWindowMs(api.resolve<AppConfig>(APP_CONFIG).fulfillmentPace)
}

/** 표본 루프 전체의 예산. 실패가 「p95 초과」로 보고돼야지 타임아웃으로 나오면 안 된다. */
const SAMPLING_BUDGET_MS = 60_000

const SAMPLES = 20

/** A1. 로컬 부하 측정 p95. */
const P95_BUDGET_MS = 300

/** 겹침을 배열하는 잠금이 실제로 걸리기를 기다리는 상한. */
const BLOCKED_ATTEMPTS = 200

interface PlacedItem {
  readonly id: string
  readonly quantity: number
}

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly items: readonly PlacedItem[]
  readonly seller: TestCaller
}

let buyer: TestCaller
let addressId: string
let categoryId: number
let placed: Placed

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

/** 팔 수 있는 조합 셋과 그 가게의 주인. 셋이 **한 판매자**여야 한 몫에 들어온다. */
async function storefront(prices: readonly number[]) {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const variants: string[] = []

  for (const price of prices) {
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
      stock: 20,
      isActive: true,
    })

    variants.push(variant.id)
  }

  return {
    variantIds: variants,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id } satisfies TestCaller,
  }
}

/**
 * 진짜 주문 하나 — **항목 3개, 수량 1 · 2 · 3**.
 *
 * 표에 직접 넣지 않는 이유는 이 파일이 재는 것이 실제 주문의 항목이기 때문이다.
 * 수량을 다르게 두는 것이 F1 의 전제다 — 「항목 셋 중 하나, 그 수량 중 일부」가
 * 정상이라는 것을 수량이 전부 1이면 말할 수 없다.
 */
async function place(): Promise<Placed> {
  const store = await storefront([10_000, 20_000, 30_000])
  const itemIds: string[] = []

  for (const [index, variantId] of store.variantIds.entries()) {
    const cart = await client().request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId, quantity: index + 1 },
      schema: cartResponseSchema,
    })
    const line = cart.groups
      .flatMap((group) => group.items)
      .find((item) => item.variantId === variantId)

    if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

    itemIds.push(line.id)
  }

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId },
    schema: orderResponseSchema,
  })
  const sellerOrder = order.sellerOrders.at(0)

  if (sellerOrder === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  return {
    orderId: order.id,
    sellerOrderId: sellerOrder.id,
    // 수량 오름차순이라 `items[0]` 은 1개, `items[1]` 은 2개, `items[2]` 는 3개다.
    items: [...sellerOrder.items]
      .map((item) => ({ id: item.id, quantity: item.quantity }))
      .sort((left, right) => left.quantity - right.quantity),
    seller: store.seller,
  }
}

/**
 * 이 몫을 어느 상태에서 다시 출발시킨다.
 *
 * `deliveredAt` 을 **상태 이력으로** 심는 것이 요점이다. 반품 기간이 그것을 읽고
 * 배송 표는 읽지 않으므로(TASK-0064 4.1), 이력을 심어야 실제 경로를 재게 된다.
 */
async function setOrderStatus(
  status: OrderStatus,
  options: { readonly deliveredAt?: Date } = {},
): Promise<void> {
  await db.query(`UPDATE "SellerOrder" SET "status" = $2::"SellerOrderStatus" WHERE "id" = $1`, [
    placed.sellerOrderId,
    status,
  ])
  await db.query(
    `DELETE FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1 AND "toStatus" = 'DELIVERED'`,
    [placed.sellerOrderId],
  )

  if (options.deliveredAt === undefined) return

  await db.query(
    `INSERT INTO "OrderStatusHistory"
       ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "actorId", "createdAt")
     VALUES (gen_random_uuid(), $1, 'SHIPPED', 'DELIVERED', 'SYSTEM', NULL,
             ($2::timestamptz AT TIME ZONE 'UTC'))`,
    [placed.sellerOrderId, options.deliveredAt],
  )
}

/** 배송완료로 두되 **기간 안**에 있게. */
function justDelivered(): Date {
  return new Date(Date.parse(NOW) - Math.floor(returnWindowMs() / 2))
}

/** 배송완료로 두되 **기간이 지나게**. */
function longDelivered(): Date {
  return new Date(Date.parse(NOW) - returnWindowMs() - 1)
}

interface ClaimLine {
  readonly orderItemId: string
  readonly quantity: number
}

function requestClaim(
  lines: readonly ClaimLine[],
  options: {
    readonly caller?: TestCaller
    readonly fault?: 'CUSTOMER' | 'SELLER'
    /** 겹침을 배열하는 검사에서 쓴다. 기본 5초는 **일부러 막아 둔** 잠금보다 짧다. */
    readonly timeoutMs?: number
  } = {},
) {
  return client(options.caller ?? buyer).request({
    path: '/claims',
    method: 'POST',
    body: {
      sellerOrderId: placed.sellerOrderId,
      items: lines,
      reason: '색상이 화면과 달라요.',
      fault: options.fault ?? 'CUSTOMER',
    },
    schema: claimResponseSchema,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
}

function transitionClaim(claimId: string, to: ClaimStatus, caller: TestCaller) {
  return client(caller).request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body: { to },
    schema: claimTransitionResponseSchema,
  })
}

function claimable(caller: TestCaller = buyer) {
  return client(caller).request({
    path: `/seller-orders/${placed.sellerOrderId}/claimable`,
    method: 'GET',
    schema: claimableResponseSchema,
  })
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly params: Readonly<Record<string, unknown>>
}

/**
 * 실패를 **도메인 코드로** 되읽는다.
 *
 * 예외 클래스로 판단하지 않는 이유는 그것이 검사와 구현을 같은 편으로 만들기
 * 때문이다. 코드는 부르는 쪽이 실제로 보는 것이고, 거절마다 다른 코드가 나가는 것이
 * 이 TASK 가 약속한 바다.
 */
function failureOf(error: unknown): HttpFailure {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const detail = error.body?.error.details?.at(0)
  const params =
    typeof detail === 'object' && detail !== null && 'params' in detail
      ? ((detail.params ?? {}) as Record<string, unknown>)
      : {}

  return { status: error.status ?? 0, code: error.body?.error.code ?? '', params }
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  return failureOf(
    await work.then(
      () => null,
      (reason: unknown) => reason,
    ),
  )
}

/** 이 항목이 지금 잡혀 있는 수량. 캐시를 직접 본다. */
function heldOf(orderItemId: string): Promise<{ claimedQuantity: number; live: number }> {
  return db.one(
    `SELECT oi."claimedQuantity",
            COALESCE((SELECT sum(ci."quantity")::int
                        FROM "ClaimItem" ci
                        JOIN "ClaimRequest" c ON c."id" = ci."claimId"
                       WHERE ci."orderItemId" = oi."id"
                         AND c."status" NOT IN ('CANCEL_REJECTED', 'RETURN_REJECTED')), 0) AS "live"
       FROM "OrderItem" oi WHERE oi."id" = $1`,
    [orderItemId],
  )
}

function historyOf(claimId: string) {
  return db.query<{
    fromStatus: string | null
    toStatus: string
    actor: string
    actorId: string | null
  }>(
    `SELECT "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
            "actor"::text AS "actor", "actorId"
       FROM "ClaimStatusHistory" WHERE "claimId" = $1 ORDER BY "id"`,
    [claimId],
  )
}

/** 잠금을 기다리는 백엔드가 `count` 개가 될 때까지. 「겹쳤다」를 희망이 아니라 사실로. */
async function awaitWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < BLOCKED_ATTEMPTS; attempt += 1) {
    const row = await db.one<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    )

    if (row.waiting >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('기다릴 것으로 기대한 요청이 잠금 대기 상태가 되지 않았습니다.')
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

beforeEach(async () => {
  api.clock.set(NOW)

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  placed = await place()
  await setOrderStatus('PAID')
})

describe('F1 · F8 — 부분 신청과 잔여 수량', () => {
  it('takes one of three items, one of its two units, and reports the rest', async () => {
    const target = placed.items[1] // 수량 2개짜리

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    expect(claim.type).toBe('CANCEL')
    expect(claim.status).toBe('CANCEL_REQUESTED')
    expect(claim.items).toHaveLength(1)
    expect(claim.items[0]?.quantity).toBe(1)
    // 환불액은 이 TASK 가 계산하지 않는다 (TASK-0068). 0 은 「아직 계산하지 않았다」다.
    expect(claim.items[0]?.refundAmount).toBe(0)

    const view = await claimable()
    const rest = new Map(view.items.map((item) => [item.orderItemId, item]))

    expect(rest.get(target.id)?.remainingQuantity).toBe(1)
    expect(rest.get(target.id)?.claimedQuantity).toBe(1)
    // **나머지 둘은 손대지 않았다.** 부분 신청이 주문 전체를 잠그면 부분이 아니다.
    for (const item of placed.items.filter((line) => line.id !== target.id)) {
      expect(rest.get(item.id)?.remainingQuantity).toBe(item.quantity)
    }
  })

  it('answers the whole order — route, window and every item', async () => {
    const view = await claimable()

    expect(view.type).toBe('CANCEL')
    expect(view.refusal).toBeNull()
    // 취소에는 기간이 없다. 물건이 아직 떠나지 않아 기다릴 것이 없다.
    expect(view.returnWindowEndsAt).toBeNull()
    expect(view.items).toHaveLength(3)
    expect(view.items.map((item) => item.remainingQuantity).sort()).toEqual([1, 2, 3])
  })
})

describe('F2 — 이미 신청한 수량만큼은 다시 신청할 수 없다', () => {
  it('refuses the second request with its own code and the number left', async () => {
    const target = placed.items[1]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await requestClaim([{ orderItemId: target.id, quantity: 2 }])

    const refused = await failure(requestClaim([{ orderItemId: target.id, quantity: 1 }]))

    expect(refused.code).toBe('CLAIM_EXCEEDS_REMAINING')
    // 숫자를 함께 주는 것이 이 거절의 절반이다 — 「신청할 수 없습니다」로 끝나는
    // 화면은 다음에 무엇을 하면 되는지 말하지 않는다.
    expect(refused.params.remaining).toBe(0)
  })

  it('leaves nothing behind when it refuses', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await failure(requestClaim([{ orderItemId: target.id, quantity: 2 }]))

    const held = await heldOf(target.id)

    expect(held.claimedQuantity).toBe(0)
    expect(
      await db.one<{ count: number }>(`SELECT count(*)::int AS count FROM "ClaimRequest"`),
    ).toEqual({ count: 0 })
  })
})

describe('F3 — 경로는 주문 상태가 정한다', () => {
  it('opens cancel before dispatch and return after delivery', async () => {
    const target = placed.items[2]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const cancel = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    expect(cancel.claim.type).toBe('CANCEL')
    expect(cancel.claim.status).toBe('CANCEL_REQUESTED')

    await setOrderStatus('DELIVERED', { deliveredAt: justDelivered() })

    const ret = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    expect(ret.claim.type).toBe('RETURN')
    expect(ret.claim.status).toBe('RETURN_REQUESTED')
  })

  it('never lets the request choose the route', async () => {
    // 유형을 보내도 계약이 그것을 읽지 않는다. 보낸 대로 만들어지면 배송된 물건이
    // 취소로 들어와 재고가 두 번 늘어난다.
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await setOrderStatus('DELIVERED', { deliveredAt: justDelivered() })

    const created = await client().request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: placed.sellerOrderId,
        items: [{ orderItemId: target.id, quantity: 1 }],
        reason: '단순 변심',
        fault: 'CUSTOMER',
        type: 'CANCEL',
      },
      schema: claimResponseSchema,
    })

    expect(created.claim.type).toBe('RETURN')
  })
})

describe('F4 · F5 · F6 — 상태와 기간이 닫는 문', () => {
  it('refuses while the parcel is in transit', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await setOrderStatus('SHIPPED')

    expect((await failure(requestClaim([{ orderItemId: target.id, quantity: 1 }]))).code).toBe(
      'CLAIM_IN_TRANSIT',
    )
    expect((await claimable()).refusal).toBe('in_transit')
  })

  it('refuses after the buyer confirmed, and does not blame the window', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    // 확정한 주문은 **기간도 지났다.** 그런데 답은 기간이 아니어야 한다 —
    // 「기다렸으면 됐다」는 뜻으로 읽히기 때문이다.
    await setOrderStatus('CONFIRMED', { deliveredAt: longDelivered() })

    expect((await failure(requestClaim([{ orderItemId: target.id, quantity: 1 }]))).code).toBe(
      'CLAIM_ORDER_CONFIRMED',
    )
  })

  it('refuses once the return window has closed', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await setOrderStatus('DELIVERED', { deliveredAt: longDelivered() })

    expect((await failure(requestClaim([{ orderItemId: target.id, quantity: 1 }]))).code).toBe(
      'CLAIM_WINDOW_CLOSED',
    )
  })

  it('refuses a state that has no claim at all', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await setOrderStatus('PAYMENT_PENDING')

    expect((await failure(requestClaim([{ orderItemId: target.id, quantity: 1 }]))).code).toBe(
      'CLAIM_NOT_CLAIMABLE',
    )
  })
})

describe('R2 — 반품 기간은 구매확정과 같은 축이다', () => {
  it('ends the return window exactly when the order would auto-confirm', async () => {
    const deliveredAt = justDelivered()

    await setOrderStatus('DELIVERED', { deliveredAt })

    const view = await claimable()
    // 이 라우트는 **판매자가 읽는 자기 몫**이다. 같은 사실을 두 화면이 읽되 보는
    // 사람이 다르고, 여기서 확인하려는 것은 두 값이 같다는 것 하나다.
    const { sellerOrder } = await client(placed.seller).request({
      path: `/seller-orders/${placed.sellerOrderId}`,
      method: 'GET',
      schema: sellerOrderResponseSchema,
    })

    expect(view.type).toBe('RETURN')
    expect(view.returnWindowEndsAt).toBe(
      new Date(deliveredAt.getTime() + returnWindowMs()).toISOString(),
    )
    // **두 값이 같아야 한다.** 다르면 확정을 기다리는 동안 아무것도 못 하는 구간이
    // 생기거나, 확정된 주문에 반품을 받아야 하는 모순이 생긴다.
    expect(view.returnWindowEndsAt).toBe(sellerOrder.autoConfirmAt)
  })

  it('reads the delivery moment from the status history, not from the shipment row', async () => {
    // 배송 표는 없고 이력만 있는 몫 — 판매자가 전이 라우트로 배송완료를 찍은 모양이다
    // (TASK-0064 4.1). 배송 표를 기준으로 삼은 구현은 여기서 「기간이 지났다」고 답한다.
    await setOrderStatus('DELIVERED', { deliveredAt: justDelivered() })

    expect(
      await db.one<{ count: number }>(
        `SELECT count(*)::int AS count FROM "Shipment" WHERE "sellerOrderId" = $1`,
        [placed.sellerOrderId],
      ),
    ).toEqual({ count: 0 })
    expect((await claimable()).type).toBe('RETURN')
  })
})

describe('거절 여섯의 순서', () => {
  it('answers the state before it answers the quantity', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await setOrderStatus('SHIPPED')

    // 수량이 0 이고 남은 것보다도 많다. 그래도 답은 배송 중이어야 한다 — 수량을
    // 고쳐 다시 시도하게 만들면 그 사람은 또 거절당한다.
    expect((await failure(requestClaim([{ orderItemId: target.id, quantity: 0 }]))).code).toBe(
      'CLAIM_IN_TRANSIT',
    )
    expect((await failure(requestClaim([{ orderItemId: target.id, quantity: 9 }]))).code).toBe(
      'CLAIM_IN_TRANSIT',
    )
  })

  it('answers zero before it answers "too many"', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const refused = await failure(requestClaim([{ orderItemId: target.id, quantity: 0 }]))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('CLAIM_INVALID_QUANTITY')
  })

  it('refuses an item that belongs to another order', async () => {
    const foreign = await place()
    const stranger = foreign.items[0]

    if (stranger === undefined) throw new Error('항목을 찾지 못했습니다.')

    const refused = await failure(requestClaim([{ orderItemId: stranger.id, quantity: 1 }]))

    expect(refused.code).toBe('CLAIM_ITEM_MISSING')
  })
})

describe('R1 — 동시 신청이 잔여를 넘지 않는다 (A7)', () => {
  it('lets exactly one of two simultaneous requests take the last unit', async () => {
    const target = placed.items[0] // 수량 1개짜리

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const gate = barrier(2)
    // **겹침을 배열한다.** 바깥 커넥션이 그 행을 먼저 잠그면 두 요청은 각자 「아직
    // 남았다」를 읽은 뒤(그 읽기는 일반 SELECT 라 막히지 않는다) 조건부 갱신에서
    // 나란히 멈춘다. 잠금을 풀면 하나만 통과한다 — 겹치지 않은 실행이 없다.
    const results = await db.withConnection(async (held) => {
      await held.query('BEGIN')
      await held.query('SELECT "id" FROM "OrderItem" WHERE "id" = $1 FOR UPDATE', [target.id])

      const running = concurrently(2, async () => {
        await gate.arrive()

        return requestClaim([{ orderItemId: target.id, quantity: 1 }], { timeoutMs: 20_000 })
      })

      await awaitWaiters(2)
      await held.query('ROLLBACK')

      return running
    })

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const held = await heldOf(target.id)

    expect(held.claimedQuantity).toBe(1)
    // 캐시와 살아 있는 신청의 합이 같다. 어긋나면 잔여 수량이 거짓말을 시작한다.
    expect(held.live).toBe(1)
    expect(
      await db.one<{ count: number }>(`SELECT count(*)::int AS count FROM "ClaimRequest"`),
    ).toEqual({ count: 1 })
  })

  it('tells the loser how many are actually left', async () => {
    const target = placed.items[1] // 수량 2개짜리

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const gate = barrier(2)
    const results = await db.withConnection(async (held) => {
      await held.query('BEGIN')
      await held.query('SELECT "id" FROM "OrderItem" WHERE "id" = $1 FOR UPDATE', [target.id])

      const running = concurrently(2, async () => {
        await gate.arrive()

        return requestClaim([{ orderItemId: target.id, quantity: 2 }], { timeoutMs: 20_000 })
      })

      await awaitWaiters(2)
      await held.query('ROLLBACK')

      return running
    })
    const loser = results.find((result) => result.status === 'rejected')

    if (loser?.status !== 'rejected') throw new Error('진 쪽이 없습니다.')

    const refused = failureOf(loser.reason)

    expect(refused.code).toBe('CLAIM_EXCEEDS_REMAINING')
    // **진 쪽이 받는 숫자는 지금의 잔여다.** 자기가 읽었던 2가 아니라 0이어야 한다.
    expect(refused.params.remaining).toBe(0)
  })
})

describe('S5 — 마지막 방어선은 데이터베이스에 있다', () => {
  it('refuses a held quantity above the ordered one', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await expect(
      db.query(`UPDATE "OrderItem" SET "claimedQuantity" = "quantity" + 1 WHERE "id" = $1`, [
        target.id,
      ]),
    ).rejects.toThrow(/OrderItem_claimedQuantity_check/u)
  })

  it('refuses a negative held quantity', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await expect(
      db.query(`UPDATE "OrderItem" SET "claimedQuantity" = -1 WHERE "id" = $1`, [target.id]),
    ).rejects.toThrow(/OrderItem_claimedQuantity_check/u)
  })

  it('refuses a claim whose status belongs to the other route', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    await expect(
      db.query(`UPDATE "ClaimRequest" SET "status" = 'INSPECTING' WHERE "id" = $1`, [claim.id]),
    ).rejects.toThrow(/ClaimRequest_type_status_check/u)
  })

  it('refuses a claimed line of zero and an empty reason', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    await expect(
      db.query(`UPDATE "ClaimItem" SET "quantity" = 0 WHERE "claimId" = $1`, [claim.id]),
    ).rejects.toThrow(/ClaimItem_quantity_check/u)
    await expect(
      db.query(`UPDATE "ClaimRequest" SET "reason" = '   ' WHERE "id" = $1`, [claim.id]),
    ).rejects.toThrow(/ClaimRequest_reason_check/u)
  })
})

describe('F7 — 전이', () => {
  it('walks the cancel path and records who moved it', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    const moved = await transitionClaim(claim.id, 'CANCEL_APPROVED', placed.seller)

    expect(moved.changed).toBe(true)
    expect(moved.claim.status).toBe('CANCEL_APPROVED')

    const history = await historyOf(claim.id)

    // 생성 줄과 전이 줄. **주체에 기본값이 없다** — 신청은 구매자가, 승인은
    // 판매자가 했다는 것이 각각 사실로 남는다 (TASK-0059 4.2).
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'CANCEL_REQUESTED',
      actor: 'BUYER',
    })
    expect(history[0]?.actorId).toBe(buyer.userId)
    expect(history[1]).toMatchObject({
      fromStatus: 'CANCEL_REQUESTED',
      toStatus: 'CANCEL_APPROVED',
      actor: 'SELLER',
    })
    expect(history[1]?.actorId).toBe(placed.seller.userId)
  })

  it('refuses a transition the table does not define', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    const refused = await failure(transitionClaim(claim.id, 'INSPECTING', placed.seller))

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CLAIM_TRANSITION_UNDEFINED')
    expect(await historyOf(claim.id)).toHaveLength(1)
  })

  it('refuses the requester approving their own claim', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    // **`claim.handle` 을 가진 사람이 구매자로 읽히는 자리다.** 다른 가게의 주인이
    // 여기서는 산 사람이므로, 퍼미션 가드는 지나고 전이표가 막는다 — 어느 화살표에도
    // `BUYER` 가 없다는 사실이 밖으로 나오는 유일한 길이다.
    const buyerWhoAlsoSells: TestCaller = {
      userId: buyer.userId,
      roles: ['SELLER_OWNER'],
      sellerId: (await storefront([10_000])).seller.sellerId,
    }
    const refused = await failure(transitionClaim(claim.id, 'CANCEL_APPROVED', buyerWhoAlsoSells))

    expect(refused.status).toBe(403)
    expect(refused.code).toBe('CLAIM_TRANSITION_FORBIDDEN')
    expect(await historyOf(claim.id)).toHaveLength(1)
  })

  it('is idempotent — the same move twice changes nothing', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    await transitionClaim(claim.id, 'CANCEL_APPROVED', placed.seller)

    const again = await transitionClaim(claim.id, 'CANCEL_APPROVED', placed.seller)

    expect(again.changed).toBe(false)
    expect(again.claim.status).toBe('CANCEL_APPROVED')
    expect(await historyOf(claim.id)).toHaveLength(2)
  })

  it('gives the quantity back when the claim is rejected, and takes it again', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    expect((await heldOf(target.id)).claimedQuantity).toBe(1)

    await transitionClaim(claim.id, 'CANCEL_REJECTED', placed.seller)

    // 거절된 것은 다시 신청할 수 있어야 한다. 영영 잠기면 사람이 할 일이 없어진다.
    const released = await heldOf(target.id)

    expect(released.claimedQuantity).toBe(0)
    expect(released.live).toBe(0)
    expect(
      (await claimable()).items.find((item) => item.orderItemId === target.id)?.remainingQuantity,
    ).toBe(1)

    const retried = await requestClaim([{ orderItemId: target.id, quantity: 1 }])

    expect(retried.claim.status).toBe('CANCEL_REQUESTED')
  })
})

describe('권한 (A3 · A4)', () => {
  it('answers 401 without a caller', async () => {
    const refused = await failure(
      api.client.request({
        path: `/seller-orders/${placed.sellerOrderId}/claimable`,
        method: 'GET',
        schema: claimableResponseSchema,
      }),
    )

    expect(refused.status).toBe(401)
  })

  it('keeps a stranger away from somebody else’s claim', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    const other = await createUser(db, {})
    const stranger: TestCaller = { userId: other.id, roles: ['BUYER'] }

    expect(
      (
        await failure(
          client(stranger).request({
            path: `/claims/${claim.id}`,
            method: 'GET',
            schema: claimResponseSchema,
          }),
        )
      ).status,
    ).toBe(403)
  })

  it('refuses a buyer who has no claim.handle at all', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    // 퍼미션 가드가 먼저 막는다. 「신청자가 자기 클레임을 승인하지 못한다」의 첫
    // 방어선이 이것이고, 전이표가 두 번째다.
    expect((await failure(transitionClaim(claim.id, 'CANCEL_APPROVED', buyer))).status).toBe(403)
  })
})

describe('목록', () => {
  it('shows a buyer their own claims and a seller the ones on their store', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    const mine = await client().request({
      path: '/claims',
      method: 'GET',
      schema: claimListResponseSchema,
    })

    expect(mine.claims.map((row) => row.id)).toEqual([claim.id])
    expect(mine.claims[0]).toMatchObject({ type: 'CANCEL', itemCount: 1, totalQuantity: 1 })

    const theirs = await client(placed.seller).request({
      path: '/claims',
      method: 'GET',
      schema: claimListResponseSchema,
    })

    expect(theirs.claims.map((row) => row.id)).toEqual([claim.id])

    const other = await createUser(db, {})
    const stranger = await client({ userId: other.id, roles: ['BUYER'] }).request({
      path: '/claims',
      method: 'GET',
      schema: claimListResponseSchema,
    })

    // 남의 클레임은 목록에서 **보이지 않는다.** 상세만 막으면 목록이 존재를 흘린다.
    expect(stranger.claims).toEqual([])

    const everything = await client(callers.superAdmin).request({
      path: '/claims',
      method: 'GET',
      schema: claimListResponseSchema,
    })

    expect(everything.claims.map((row) => row.id)).toEqual([claim.id])
  })

  it('filters by order, status and type', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await requestClaim([{ orderItemId: target.id, quantity: 1 }])
    const byStatus = await client().request({
      path: `/claims?sellerOrderId=${placed.sellerOrderId}&status=CANCEL_REQUESTED&type=CANCEL`,
      method: 'GET',
      schema: claimListResponseSchema,
    })

    expect(byStatus.claims.map((row) => row.id)).toEqual([claim.id])

    const miss = await client().request({
      path: '/claims?status=RETURN_REQUESTED',
      method: 'GET',
      schema: claimListResponseSchema,
    })

    expect(miss.claims).toEqual([])
  })
})

describe('A1 — 응답 시간', () => {
  it(
    'answers the two read paths within the p95 budget',
    async () => {
      const durations: number[] = []

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        const started = performance.now()

        await claimable()
        durations.push(performance.now() - started)
      }

      expect(p95Of(durations)).toBeLessThanOrEqual(P95_BUDGET_MS)
    },
    SAMPLING_BUDGET_MS,
  )
})
