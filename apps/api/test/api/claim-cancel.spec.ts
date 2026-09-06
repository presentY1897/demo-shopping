import type { ApiClient, OrderStatus } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  claimResponseSchema,
  claimTransitionResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type {
  CancelApproved,
  CancelRefundEvents,
  CancelRestockEvents,
} from '../../src/claims/cancel-events.js'
import { CANCEL_REFUND_EVENTS, CANCEL_RESTOCK_EVENTS } from '../../src/claims/cancel-events.js'
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

/**
 * 취소의 **결론** (TASK-0066), 이 워커의 실제 데이터베이스에 대고.
 *
 * 신청 자체가 옳은지는 `claim.spec.ts` 가 재고, 전체·부분의 규칙이 옳은지는
 * `cancel-rules.spec.ts` 가 순수 함수로 잰다. **여기서 재는 것은 그 규칙이 행에
 * 실제로 적용되는가**이고, 값의 대부분이 두 가지에 몰려 있다.
 *
 * ① **자동 승인과 승인 대기가 갈리는가.** `PAID` 는 신청과 같은 트랜잭션에서
 *    `CANCEL_APPROVED` 가 되고 그 이력의 주체가 `SYSTEM` 이며, `PREPARING` 은
 *    `CANCEL_REQUESTED` 로 남는다. 갈리지 않으면 증상은 「구매자가 아무도 볼 일
 *    없는 승인을 기다린다」이고, 아무것도 실패하지 않는다.
 * ② **「전체」의 경계.** 세 개를 하나씩 세 번 취소하면 마지막 한 개가 판매자 몫을
 *    닫아야 한다. 이 경계를 놓치면 보낼 물건이 하나도 없는 주문이 「상품 준비중」
 *    으로 남고, 그것 역시 아무것도 실패시키지 않는다.
 *
 * 환불(TASK-0068)과 재고 복원(TASK-0069)은 이 TASK 가 하지 않는다. 그래서 재는
 * 것은 「무엇이 일어났는가」가 아니라 **「불렸는가, 그리고 무엇을 들고 불렸는가」**
 * 이고, 그것을 위해 두 포트를 기록하는 대역으로 바꿔 끼운다 — 데이터베이스는
 * 그대로 실제다 (QUALITY-GATES 6장, A6).
 */

/** 부른 것을 그대로 쌓아 두는 대역. 실제 구현이 붙는 날 이 클래스만 사라진다. */
class RecordingEvents implements CancelRefundEvents, CancelRestockEvents {
  refunded: CancelApproved[] = []
  restocked: CancelApproved[] = []

  refund(events: readonly CancelApproved[]): Promise<void> {
    this.refunded.push(...events)

    return Promise.resolve()
  }

  restock(events: readonly CancelApproved[]): Promise<void> {
    this.restocked.push(...events)

    return Promise.resolve()
  }
}

const events = new RecordingEvents()

const db = useDatabase()
const api = useApiApp({
  database: db,
  authenticate: true,
  overrides: [
    { token: CANCEL_REFUND_EVENTS, value: events },
    { token: CANCEL_RESTOCK_EVENTS, value: events },
  ],
})

const NOW = '2026-09-03T00:00:00.000Z'

interface PlacedItem {
  readonly id: string
  readonly quantity: number
}

let buyer: TestCaller
let seller: TestCaller
let addressId: string
let categoryId: number
let sellerOrderId: string
let items: readonly PlacedItem[]

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

/**
 * 한 판매자의 몫 하나 — **항목 둘, 수량 1 과 3**.
 *
 * 수량을 다르게 두는 것이 이 파일의 전제다. 「마지막 한 개」를 재려면 여러 개짜리
 * 줄이 있어야 하고, 「부분 취소는 상태를 옮기지 않는다」를 재려면 손대지 않은 줄이
 * 하나 있어야 한다.
 */
async function place(): Promise<void> {
  const owner = await createUser(db, {})
  const store = await createSeller(db, { userId: owner.id })

  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }

  const itemIds: string[] = []

  for (const [index, price] of [10_000, 20_000].entries()) {
    const product = await createProduct(db, {
      sellerId: store.id,
      categoryId,
      status: 'ACTIVE',
      minPrice: price,
    })
    const variant = await createProductVariant(db, {
      productId: product.id,
      sellerId: store.id,
      price,
      stock: 20,
      isActive: true,
    })
    const cart = await client().request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId: variant.id, quantity: index === 0 ? 1 : 3 },
      schema: cartResponseSchema,
    })
    const line = cart.groups
      .flatMap((group) => group.items)
      .find((item) => item.variantId === variant.id)

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

  sellerOrderId = bundle.id
  items = [...bundle.items]
    .map((item) => ({ id: item.id, quantity: item.quantity }))
    .sort((left, right) => left.quantity - right.quantity)
}

/** 수량 1 짜리 줄. */
function single(): PlacedItem {
  const item = items.at(0)

  if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

  return item
}

/** 수량 3 짜리 줄. 「마지막 한 개」가 여기서 나온다. */
function triple(): PlacedItem {
  const item = items.at(1)

  if (item === undefined) throw new Error('항목을 찾지 못했습니다.')

  return item
}

async function setOrderStatus(status: OrderStatus): Promise<void> {
  await db.query(`UPDATE "SellerOrder" SET "status" = $2::"SellerOrderStatus" WHERE "id" = $1`, [
    sellerOrderId,
    status,
  ])
}

/**
 * 취소를 신청한다.
 *
 * **`fault` 만 싣는다.** 계약이 「귀책이거나 반품 사유이거나, 둘 중 하나」를
 * 요구하고(`createClaimRequestSchema`), 이 파일의 주문은 전부 취소 경로에 서 있다 —
 * 반품의 부속을 함께 실으면 서버가 경로 어긋남으로 거절한다. 그 거절을 재는 것은
 * `claim.spec.ts` 의 일이고, 여기서 재는 것은 **승인된 취소의 결론**이다.
 */
function requestCancel(
  lines: readonly { readonly orderItemId: string; readonly quantity: number }[],
) {
  return client().request({
    path: '/claims',
    method: 'POST',
    body: {
      sellerOrderId,
      items: lines,
      reason: '주문을 잘못 넣었어요.',
      fault: 'CUSTOMER',
    },
    schema: claimResponseSchema,
  })
}

function approve(claimId: string) {
  return client(seller).request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body: { to: 'CANCEL_APPROVED' },
    schema: claimTransitionResponseSchema,
  })
}

function reject(claimId: string) {
  return client(seller).request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body: { to: 'CANCEL_REJECTED', reason: '이미 포장했어요.' },
    schema: claimTransitionResponseSchema,
  })
}

/** 지금 이 몫의 상태. 답이 아니라 **행**을 읽는다. */
async function orderStatus(): Promise<string> {
  const row = await db.one<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "SellerOrder" WHERE "id" = $1`,
    [sellerOrderId],
  )

  return row.status
}

/** 이 몫의 주문 상태 이력, 마지막 줄부터. */
function orderHistory() {
  return db.query<{
    toStatus: string
    actor: string
    actorId: string | null
    reason: string | null
  }>(
    `SELECT "toStatus"::text AS "toStatus", "actor"::text AS "actor", "actorId", "reason"
       FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1 ORDER BY "id"`,
    [sellerOrderId],
  )
}

function claimHistory(claimId: string) {
  return db.query<{ toStatus: string; actor: string; actorId: string | null }>(
    `SELECT "toStatus"::text AS "toStatus", "actor"::text AS "actor", "actorId"
       FROM "ClaimStatusHistory" WHERE "claimId" = $1 ORDER BY "id"`,
    [claimId],
  )
}

/** 잠금을 기다리는 백엔드가 `count` 개가 될 때까지. 「겹쳤다」를 희망이 아니라 사실로. */
async function awaitWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = await db.one<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    )

    if (row.waiting >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('기다릴 것으로 기대한 요청이 잠금 대기 상태가 되지 않았습니다.')
}

beforeEach(async () => {
  api.clock.set(NOW)
  events.refunded = []
  events.restocked = []

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  await place()
  await setOrderStatus('PAID')
})

describe('자동 승인과 승인 대기', () => {
  it('approves a cancel on a paid order by itself, with nobody as the actor', async () => {
    const { claim } = await requestCancel([{ orderItemId: single().id, quantity: 1 }])

    expect(claim.status).toBe('CANCEL_APPROVED')
    // 두 줄이다 — 신청(구매자)과 승인(규칙). 승인 줄에 사람이 없는 것이 요점이고,
    // 그것이 「관리자가 승인했다」는 거짓을 남기지 않는 방법이다.
    expect(await claimHistory(claim.id)).toEqual([
      { toStatus: 'CANCEL_REQUESTED', actor: 'BUYER', actorId: buyer.userId },
      { toStatus: 'CANCEL_APPROVED', actor: 'SYSTEM', actorId: null },
    ])
  })

  it('leaves a cancel on a preparing order waiting for the seller', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([{ orderItemId: single().id, quantity: 1 }])

    expect(claim.status).toBe('CANCEL_REQUESTED')
    expect(await claimHistory(claim.id)).toEqual([
      { toStatus: 'CANCEL_REQUESTED', actor: 'BUYER', actorId: buyer.userId },
    ])
    // 승인되지 않았으므로 뒤따르는 것도 없다. 여기서 환불이 나가면 판매자가
    // 거절할 수 있는 신청에 돈이 먼저 나간 것이 된다.
    expect(events.refunded).toEqual([])
  })

  it('approves the waiting one when the seller says so, and names the seller', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([{ orderItemId: single().id, quantity: 1 }])
    const answer = await approve(claim.id)

    expect(answer.claim.status).toBe('CANCEL_APPROVED')
    expect((await claimHistory(claim.id)).at(-1)).toEqual({
      toStatus: 'CANCEL_APPROVED',
      actor: 'SELLER',
      actorId: seller.userId,
    })
  })
})

describe('전체 취소와 부분 취소', () => {
  it('closes the seller order when nothing is left', async () => {
    await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    expect(await orderStatus()).toBe('CANCELED')
  })

  it('leaves the seller order alone when a line is still going', async () => {
    await requestCancel([{ orderItemId: single().id, quantity: 1 }])

    expect(await orderStatus()).toBe('PAID')
  })

  it('leaves it alone when only some units of one line are canceled', async () => {
    await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 2 },
    ])

    expect(await orderStatus()).toBe('PAID')
  })

  /**
   * **경계다.** 하나씩 네 번 나눠 취소하면 앞의 셋은 주문을 그대로 두고 마지막
   * 하나가 닫는다. 「전체」를 이번 신청의 크기로 정의했다면 넷 다 부분이고, 보낼
   * 물건이 없는 주문이 결제완료로 남는다.
   */
  it('turns the order canceled exactly at the last unit', async () => {
    const steps = [
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 1 },
    ]
    const seen: string[] = []

    for (const step of steps) {
      await requestCancel([step])
      seen.push(await orderStatus())
    }

    expect(seen).toEqual(['PAID', 'PAID', 'PAID', 'CANCELED'])
  })

  /**
   * 승인되지 않은 신청은 세지 않는다.
   *
   * 세면 판매자가 거절할 신청 하나가 주문을 닫고, 전이표에 `CANCELED` 를 떠나는
   * 화살표가 없어 되돌릴 방법이 없다.
   */
  it('does not close the order on a claim the seller has not approved', async () => {
    await setOrderStatus('PREPARING')
    await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    expect(await orderStatus()).toBe('PREPARING')
  })

  it('closes it once that claim is approved', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    await approve(claim.id)

    expect(await orderStatus()).toBe('CANCELED')
  })

  /** 거절된 신청은 수량을 돌려주고, 돌려준 수량은 다시 「남은 것」이 된다. */
  it('never closes the order for a rejected claim', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    await reject(claim.id)

    expect(await orderStatus()).toBe('PREPARING')
  })

  /**
   * 주문 쪽 이력에 무엇이 적히나 (`orderActorForCancel`).
   *
   * 자동 승인이라 사람이 없다. 전이표가 이 화살표에 `SYSTEM` 을 열어 두지 않아
   * 종류는 `SELLER` 로 적히지만 **`actorId` 는 비어 있고**, 같은 순간의 클레임
   * 이력이 `SYSTEM` 을 말한다 — 두 줄이 나란히 읽혀야 거짓이 남지 않는다.
   */
  it('records the closing without inventing a person', async () => {
    await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    // **자동 승인은 `SYSTEM` 으로 남는다.** 전이표가 그 주체를 열기 전에는 이 자리에
    // `SELLER` 가 적혔고, 그것은 「판매자가 취소했다」는 거짓이었다 — 결제완료
    // 상태에서는 판매자가 아직 아무것도 하지 않았고 거절할 근거가 없어서 자동으로
    // 승인된 것이다 (TASK-0066).
    expect((await orderHistory()).at(-1)).toEqual({
      toStatus: 'CANCELED',
      actor: 'SYSTEM',
      actorId: null,
      reason: null,
    })
  })

  /** R1 — 이미 떠난 물건은 취소로 닫지 않는다. 발송이 먼저면 승인이 진다. */
  it('refuses to close an order that was dispatched first', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    await setOrderStatus('SHIPPED')

    const failure = await approve(claim.id).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(failure).toBeInstanceOf(ApiClientError)
    expect((failure as ApiClientError).body?.error.code).toBe('ORDER_TRANSITION_UNDEFINED')
    // 트랜잭션 하나라 승인도 함께 되돌아간다. 「취소는 승인됐는데 주문은 배송중」이
    // 남으면 그것을 고칠 방법이 손밖에 없다.
    expect((await claimHistory(claim.id)).at(-1)?.toStatus).toBe('CANCEL_REQUESTED')
  })
})

/**
 * A7 — 동시에 승인된 두 부분 취소 (QUALITY-GATES 3장).
 *
 * **「전체인가」는 세고 나서 옮기는 판단이라 그 사이가 비면 안 된다.** 두 승인이
 * 겹치면 각자 상대의 갱신을 못 보고(상대는 아직 커밋 전이다) 둘 다 「아직 남았다」로
 * 읽는다 — 마지막 한 개까지 취소됐는데 판매자 몫은 준비중으로 남고, 그 상태에서
 * **실패하는 것은 아무것도 없다.**
 *
 * 그래서 세기 **전에** 판매자 몫의 행을 잠근다. 아래 검사는 그 겹침을 희망이 아니라
 * 배열로 만든다 — 바깥 커넥션이 그 행을 먼저 쥐고 있으면 두 승인이 나란히 거기서
 * 멈추고, 놓아 주면 하나씩 지나간다.
 */
describe('A7 — 동시에 승인된 두 부분 취소', () => {
  it('closes the order exactly once when the last unit is canceled in a race', async () => {
    await setOrderStatus('PREPARING')

    const first = await requestCancel([{ orderItemId: single().id, quantity: 1 }])
    const second = await requestCancel([{ orderItemId: triple().id, quantity: 3 }])
    const gate = barrier(2)
    const claimIds = [first.claim.id, second.claim.id]
    const results = await db.withConnection(async (held) => {
      await held.query('BEGIN')
      await held.query('SELECT "id" FROM "SellerOrder" WHERE "id" = $1 FOR UPDATE', [sellerOrderId])

      const running = concurrently(2, async (index) => {
        await gate.arrive()

        return approve(claimIds[index] ?? '')
      })

      await awaitWaiters(2)
      await held.query('ROLLBACK')

      return running
    })

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
    expect(await orderStatus()).toBe('CANCELED')
    // 이력이 한 줄이다. 두 줄이면 같은 전이가 두 번 반영된 것이고, 그것은 사람이
    // 보기 전까지 아무 경보도 울리지 않는다.
    expect((await orderHistory()).filter((row) => row.toStatus === 'CANCELED')).toHaveLength(1)
  })
})

describe('트리거 — 환불과 재고 복원 (TASK-0068 · 0069)', () => {
  it('calls both ports once, with what they need to undo', async () => {
    const { claim } = await requestCancel([{ orderItemId: triple().id, quantity: 2 }])
    const [refunded] = events.refunded

    expect(events.refunded).toHaveLength(1)
    expect(events.restocked).toEqual(events.refunded)
    expect(refunded).toMatchObject({
      claimId: claim.id,
      sellerOrderId,
      // 남은 한 개가 계속 배송된다. 환불이 배송비를 어떻게 다룰지가 여기서 갈린다.
      scope: 'PARTIAL',
      actor: 'SYSTEM',
      idempotencyKey: claim.id,
      lines: [{ orderItemId: triple().id, quantity: 2 }],
    })
    expect(refunded?.lines.at(0)?.variantId).toEqual(expect.any(String))
  })

  it('says the cancel was whole when the order closed with it', async () => {
    await requestCancel([
      { orderItemId: single().id, quantity: 1 },
      { orderItemId: triple().id, quantity: 3 },
    ])

    expect(events.refunded.at(0)?.scope).toBe('FULL')
  })

  it('stays quiet while a claim is only requested', async () => {
    await setOrderStatus('PREPARING')
    await requestCancel([{ orderItemId: single().id, quantity: 1 }])

    expect({ refunded: events.refunded, restocked: events.restocked }).toEqual({
      refunded: [],
      restocked: [],
    })
  })

  /**
   * **두 번 승인해도 한 번만 나간다.** 문이 멱등이라 두 번째 요청은 상태를 옮기지
   * 않고, 옮기지 않은 전이는 아무것도 발행하지 않는다 — 이중 환불을 막는 첫 번째
   * 장치가 그것이고, `idempotencyKey` 가 두 번째다.
   */
  it('does not fire twice when the same approval arrives twice', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([{ orderItemId: single().id, quantity: 1 }])

    await approve(claim.id)

    const again = await approve(claim.id)

    expect(again.changed).toBe(false)
    expect(events.refunded).toHaveLength(1)
  })

  it('never fires for a rejected claim', async () => {
    await setOrderStatus('PREPARING')

    const { claim } = await requestCancel([{ orderItemId: single().id, quantity: 1 }])

    await reject(claim.id)

    expect(events.refunded).toEqual([])
  })
})
