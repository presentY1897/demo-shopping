import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  bulkApproveSettlementsResponseSchema,
  settlementDetailResponseSchema,
  settlementListResponseSchema,
  settlementResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 관리자의 정산 검토 (TASK-0081), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 전이표가 옳은지는 `settlement-transitions.spec.ts` 가 순수 함수로 잰다. **여기서
 * 재는 것은 그 표를 우회하는 길이 없는가**이고, 값이 셋에 몰려 있다.
 *
 * - **지급완료된 정산서가 다시 움직이지 않는가** (F5). 움직이면 돈이 두 번 나간다.
 * - **사유 없는 보류가 불가능한가** (F4). 사유가 없으면 판매자가 「왜 제 정산이
 *   멈췄죠」라고 물었을 때 답할 것이 없다.
 * - **일괄 승인이 실패를 숨기지 않는가** (F6). 숨기면 남은 건은 아무도 다시 보지
 *   않고, 그 건들이야말로 사람이 봐야 하는 것들이다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-09T05:00:00.000Z'

let superAdmin: TestCaller
let operator: TestCaller
let demoAdmin: TestCaller
let seller: TestCaller
let sellerId: string
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  superAdmin = { userId: (await createUser(db)).id, roles: ['ADMIN_SUPER'] }
  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  demoAdmin = { userId: (await createUser(db)).id, roles: ['DEMO_ADMIN'] }

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  sellerId = store.id
  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

/** 정산서 한 장. 배치를 거치지 않는 이유는 이 스펙이 재는 것이 그 앞이 아니어서다. */
async function settlement(
  options: { readonly status?: 'PENDING' | 'PAID'; readonly payoutAmount?: number } = {},
): Promise<string> {
  sequence += 1

  const id = randomUUID()
  const paid = options.status === 'PAID'
  const payoutAmount = options.payoutAmount ?? 9_000

  await db.execute(
    `INSERT INTO "Settlement"
       ("id", "sellerId", "periodStart", "periodEnd", "status", "salesAmount",
        "commissionAmount", "sellerCouponAmount", "returnAdjustmentAmount", "payoutAmount",
        "approvedAt", "approvedById", "paidAt", "paidById", "updatedAt")
     VALUES ($1, $2, ($3::timestamptz - make_interval(weeks => $4::int)),
             ($5::timestamptz - make_interval(weeks => $4::int)),
             $6::"SettlementStatus", $7, 0, 0, 0, $7,
             CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN $9::uuid END,
             CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN $9::uuid END, now())`,
    [
      id,
      sellerId,
      '2026-08-31T00:00:00.000Z',
      sequence,
      '2026-09-07T00:00:00.000Z',
      paid ? 'PAID' : 'PENDING',
      payoutAmount,
      paid,
      superAdmin.userId,
    ],
  )

  return id
}

/** 정산서에 판매 줄 하나 — 상세가 근거로 펼칠 것 (F1 · F2). */
async function line(settlementId: string): Promise<string> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const orderNumber = `20260908-${String(sequence).padStart(8, '0')}`
  const buyer = await createUser(db)

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             10000, 10000, now())`,
    [orderId, orderNumber, buyer.id],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "updatedAt")
     VALUES ($1, $2, $3, 'CONFIRMED'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0, now())`,
    [sellerOrderId, orderId, sellerId],
  )
  await db.execute(
    `INSERT INTO "SettlementItem"
       ("id", "settlementId", "type", "sellerOrderId", "salesAmount", "commissionAmount",
        "sellerCouponAmount", "payoutAmount")
     VALUES (gen_random_uuid(), $1, 'SALE'::"SettlementItemType", $2, 10000, 1000, 0, 9000)`,
    [settlementId, sellerOrderId],
  )

  return orderNumber
}

function list(caller: TestCaller, query = ''): Promise<unknown> {
  return client(caller).request({
    path: `/settlements${query}`,
    schema: settlementListResponseSchema,
  })
}

function detail(caller: TestCaller, id: string): Promise<unknown> {
  return client(caller).request({
    path: `/settlements/${id}`,
    schema: settlementDetailResponseSchema,
  })
}

function act(
  caller: TestCaller,
  id: string,
  action: 'approval' | 'hold' | 'payment',
  body?: unknown,
): Promise<{ settlement: { status: string; holdReason: string | null } }> {
  return client(caller).request({
    path: `/settlements/${id}/${action}`,
    method: 'POST',
    ...(body === undefined ? {} : { body }),
    schema: settlementResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await work
  } catch (error) {
    if (error instanceof ApiClientError) {
      return { status: error.status ?? 0, code: error.code ?? '' }
    }

    throw error
  }

  throw new Error('실패했어야 하는 요청이 성공했습니다.')
}

describe('계산 근거 (F1 · F2)', () => {
  it('정산서의 세 항과 지급액을 함께 답한다', async () => {
    const id = await settlement()

    await line(id)

    const answer = await detail(superAdmin, id)

    expect(answer).toMatchObject({
      settlement: { salesAmount: 9_000, payoutAmount: 9_000, status: 'PENDING' },
    })
  })

  /** **주문 번호가 있어야 그 주문으로 내려갈 수 있다** — 그것이 F2 다. */
  it('항목마다 주문 번호가 실린다', async () => {
    const id = await settlement()
    const orderNumber = await line(id)

    const answer = (await detail(superAdmin, id)) as {
      items: readonly { orderNumber: string; sellerOrderId: string }[]
    }

    expect(answer.items).toHaveLength(1)
    expect(answer.items[0]?.orderNumber).toBe(orderNumber)
    expect(answer.items[0]?.sellerOrderId).toBeTruthy()
  })
})

describe('목록', () => {
  /**
   * **페이지가 아니라 필터의 합이다.** 페이지 합으로 답하면 다음 장을 넘길 때마다
   * 총액이 달라지고, 그 숫자를 보고 지급을 결정하는 사람에게 그것은 답이 아니다.
   */
  it('합계가 페이지가 아니라 필터 전체의 것이다', async () => {
    for (let index = 0; index < 3; index += 1) await settlement({ payoutAmount: 1_000 })

    const answer = (await list(superAdmin, '?limit=1')) as {
      settlements: readonly unknown[]
      totals: { count: number; payoutAmount: number }
      nextCursor: string | null
    }

    expect(answer.settlements).toHaveLength(1)
    expect(answer.totals).toEqual({ count: 3, payoutAmount: 3_000 })
    expect(answer.nextCursor).not.toBeNull()
  })

  it('상태로 거른다', async () => {
    await settlement()
    await settlement({ status: 'PAID' })

    const answer = (await list(superAdmin, '?status=PAID')) as { totals: { count: number } }

    expect(answer.totals.count).toBe(1)
  })

  /** 남의 스토어를 지정하지 않은 조회는 플랫폼 전체를 보는 일이라 `any` 가 필요하다. */
  it('판매자는 스토어를 지정해야 목록을 볼 수 있다', async () => {
    await settlement()

    expect((await failure(list(seller))).status).toBe(403)
    expect(await list(seller, `?sellerId=${sellerId}`)).toBeTruthy()
  })

  it('운영자는 플랫폼 전체를 읽는다', async () => {
    await settlement()

    expect(await list(operator)).toBeTruthy()
  })
})

describe('승인 (F3)', () => {
  it('승인하면 상태가 바뀌고 누가 했는지 남는다', async () => {
    const id = await settlement()

    expect((await act(superAdmin, id, 'approval')).settlement.status).toBe('APPROVED')

    const [row] = await db.query<{ approvedById: string; approvedAt: Date | null }>(
      `SELECT "approvedById", "approvedAt" FROM "Settlement" WHERE "id" = $1`,
      [id],
    )

    expect(row?.approvedById).toBe(superAdmin.userId)
    expect(row?.approvedAt).not.toBeNull()
  })

  it('운영자는 승인하지 못한다', async () => {
    const id = await settlement()

    expect((await failure(act(operator, id, 'approval'))).status).toBe(403)
  })
})

describe('보류 (F4)', () => {
  it('사유와 함께 보류한다', async () => {
    const id = await settlement()
    const answer = await act(superAdmin, id, 'hold', { reason: '반품 분쟁 확인 중' })

    expect(answer.settlement).toMatchObject({ status: 'HOLD', holdReason: '반품 분쟁 확인 중' })
  })

  /** 사유 없는 보류는 판매자의 물음에 답할 것이 없는 상태다. */
  it('사유 없이 보류할 수 없다', async () => {
    const id = await settlement()

    expect((await failure(act(superAdmin, id, 'hold', { reason: '   ' }))).status).toBe(400)
    expect((await failure(act(superAdmin, id, 'hold', {}))).status).toBe(400)
  })

  it('보류에서 승인으로 갈 수 있고, 사유는 남는다', async () => {
    const id = await settlement()

    await act(superAdmin, id, 'hold', { reason: '반품 분쟁 확인 중' })

    const answer = await act(superAdmin, id, 'approval')

    expect(answer.settlement).toMatchObject({
      status: 'APPROVED',
      holdReason: '반품 분쟁 확인 중',
    })
  })

  /** 승인된 것을 보류로 되돌리는 화살표가 전이표에 없다. */
  it('승인된 정산서를 보류할 수 없다', async () => {
    const id = await settlement()

    await act(superAdmin, id, 'approval')

    expect((await failure(act(superAdmin, id, 'hold', { reason: '재검토' }))).code).toBe(
      'SETTLEMENT_WRONG_STATUS',
    )
  })
})

describe('지급 (F5 · F7)', () => {
  it('승인한 뒤에 지급할 수 있다', async () => {
    const id = await settlement()

    await act(superAdmin, id, 'approval')

    expect((await act(superAdmin, id, 'payment')).settlement.status).toBe('PAID')
  })

  it('승인 없이 바로 지급할 수 없다', async () => {
    const id = await settlement()

    expect((await failure(act(superAdmin, id, 'payment'))).code).toBe('SETTLEMENT_WRONG_STATUS')
  })

  /** **돈이 나간 것으로 간주한다.** 여기서 나가는 화살표가 없는 것이 F5 의 전부다. */
  it.each(['approval', 'hold', 'payment'] as const)(
    '지급완료된 정산서는 %s 로 움직이지 않는다',
    async (action) => {
      const id = await settlement({ status: 'PAID' })
      const body = action === 'hold' ? { reason: '재검토' } : undefined

      expect((await failure(act(superAdmin, id, action, body))).code).toBe(
        'SETTLEMENT_WRONG_STATUS',
      )
    },
  )

  /** 데모 관리자는 운영자에서 파생되고, 운영자에게 `settlement.pay` 가 없다. */
  it.each([
    ['운영자', () => operator],
    ['데모 관리자', () => demoAdmin],
  ])('%s 는 지급 확정을 하지 못한다', async (_label, caller) => {
    const id = await settlement()

    expect((await failure(act(caller(), id, 'payment'))).status).toBe(403)
  })
})

describe('일괄 승인 (F6)', () => {
  function approveMany(caller: TestCaller, ids: readonly string[]): Promise<unknown> {
    return client(caller).request({
      path: '/settlements/approvals',
      method: 'POST',
      body: { ids },
      schema: bulkApproveSettlementsResponseSchema,
    })
  }

  it('고른 것을 전부 승인한다', async () => {
    const ids = [await settlement(), await settlement(), await settlement()]

    const answer = (await approveMany(superAdmin, ids)) as { approved: readonly string[] }

    expect(answer.approved).toHaveLength(3)
  })

  /**
   * **실패를 조용히 빼지 않는다.** 「10건 골랐는데 8건이 승인됐다」를 말하지 못하면
   * 남은 2건은 아무도 다시 보지 않는다.
   */
  it('승인할 수 없는 건을 이유와 함께 돌려준다', async () => {
    const ok = await settlement()
    const paid = await settlement({ status: 'PAID' })
    const missing = randomUUID()

    const answer = (await approveMany(superAdmin, [ok, paid, missing])) as {
      approved: readonly string[]
      failed: readonly { id: string; reason: string }[]
    }

    expect(answer.approved).toEqual([ok])
    expect(answer.failed).toEqual([
      { id: paid, reason: 'wrong_status' },
      { id: missing, reason: 'not_found' },
    ])
  })

  /** 한 건의 거절이 나머지를 되돌리지 않는다 — 한 트랜잭션에 넣지 않은 이유다. */
  it('실패한 건이 있어도 나머지는 승인된 채로 남는다', async () => {
    const ok = await settlement()
    const paid = await settlement({ status: 'PAID' })

    await approveMany(superAdmin, [ok, paid])

    const [row] = await db.query<{ status: string }>(
      `SELECT "status"::text AS "status" FROM "Settlement" WHERE "id" = $1`,
      [ok],
    )

    expect(row?.status).toBe('APPROVED')
  })

  it('운영자는 일괄 승인하지 못한다', async () => {
    expect((await failure(approveMany(operator, [await settlement()]))).status).toBe(403)
  })
})
