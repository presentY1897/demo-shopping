import type { ApiClient, BulkIssueResponse, CouponListResponse } from '@shopping/shared'
import {
  ApiClientError,
  bulkIssueResponseSchema,
  couponListResponseSchema,
  couponResponseSchema,
  userCouponResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { randomBytes } from 'node:crypto'

import { formatCouponCode } from '../../src/coupons/coupon-code.js'
import { ORDER_NUMBER_SUFFIX_LENGTH, orderNumberOf } from '../../src/orders/order-number.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 발행자 콘솔 (TASK-0073 · TASK-0074), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 상태 판정이 옳은지는 `coupon-console.spec.ts` 가 순수 함수로 잰다. **여기서 재는
 * 것은 그 판정이 실제 목록과 발급에 닿는가**이고, 값의 대부분이 셋에 몰려 있다.
 *
 * - **누가 어느 목록을 보는가** (0074 F6). 판매자가 남의 쿠폰을 읽으면 그것은 남의
 *   할인 정책과 부담 누계를 읽는 일이다.
 * - **중단이 무엇을 멈추고 무엇을 멈추지 않는가** (0073 F5). 이미 받은 사람의 쿠폰을
 *   함께 죽이면 그것은 사람이 받은 것을 빼앗는 일이다.
 * - **일괄 발급이 두 번 눌러도 안전한가** (0073 F4). 안 그러면 한 사람이 두 장을
 *   갖고, 그 두 장은 최소 주문금액을 우회하는 방법이 된다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-06T00:00:00.000Z'
const VALID_FROM = '2026-09-01T00:00:00.000Z'
const VALID_UNTIL = '2026-09-30T00:00:00.000Z'

let operator: TestCaller
let seller: TestCaller
let otherSeller: TestCaller
let buyer: TestCaller

beforeEach(async () => {
  api.clock.set(NOW)

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }

  const rival = await createUser(db)
  const rivalStore = await createSeller(db, { userId: rival.id })

  otherSeller = { userId: rival.id, roles: ['SELLER_OWNER'], sellerId: rivalStore.id }
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

async function issueCoupon(
  caller: TestCaller,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; code: string | null }> {
  const { coupon } = await client(caller).request({
    path: '/coupons',
    method: 'POST',
    body: {
      sellerId: null,
      name: '가을 쿠폰',
      discountType: 'FIXED',
      discountValue: 3_000,
      minOrderAmount: 0,
      scopeType: 'ALL',
      scopeIds: [],
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      ...overrides,
    },
    schema: couponResponseSchema,
  })

  return { id: coupon.id, code: coupon.code }
}

function list(caller: TestCaller, query = ''): Promise<CouponListResponse> {
  return client(caller).request({ path: `/coupons${query}`, schema: couponListResponseSchema })
}

function setSuspended(caller: TestCaller, id: string, suspended: boolean) {
  return client(caller).request({
    path: `/coupons/${id}`,
    method: 'PATCH',
    body: { suspended },
    schema: couponResponseSchema,
  })
}

function bulkIssue(caller: TestCaller, id: string, target: string): Promise<BulkIssueResponse> {
  return client(caller).request({
    path: `/coupons/${id}/issues/bulk`,
    method: 'POST',
    body: { target },
    schema: bulkIssueResponseSchema,
  })
}

function grant(caller: TestCaller, id: string, userId: string) {
  return client(caller).request({
    path: `/coupons/${id}/issues`,
    method: 'POST',
    body: { userId },
    schema: userCouponResponseSchema,
  })
}

function claim(caller: TestCaller, code: string) {
  return client(caller).request({
    path: '/coupons/claims',
    method: 'POST',
    body: { code },
    schema: userCouponResponseSchema,
  })
}

/** 「썼다」가 가리킬 주문 하나. 금액은 이 스펙이 재는 것이 아니라 제약을 채우는 값이다. */
async function orderOf(userId: string): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), '수령인', '010-0000-0000',
             '06234', '서울시 강남구', 10000, 10000, now())
     RETURNING "id"`,
    // 번호는 형식이 있는 값이다(`Order_orderNumber_format_check`). 손으로 지어내지
    // 않고 그것을 만드는 함수를 쓴다.
    [orderNumberOf(new Date(NOW), randomBytes(ORDER_NUMBER_SUFFIX_LENGTH)), userId],
  )

  return row.id
}

async function failure(work: Promise<unknown>): Promise<{ status: number; code: string }> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return { status: error.status ?? 0, code: error.body?.error.code ?? '' }
}

describe('목록 (F6)', () => {
  it('플랫폼 목록은 관리자만 읽는다', async () => {
    await issueCoupon(operator)

    expect((await list(operator)).coupons).toHaveLength(1)
    expect(await failure(list(seller))).toMatchObject({ status: 403 })
    expect(await failure(list(buyer))).toMatchObject({ status: 403 })
  })

  /**
   * **판매자는 남의 목록을 읽지 못한다** (TASK-0074 F6). 남의 할인 정책과 부담
   * 누계를 읽는 일이고, 그 거절은 스토어 소유권 검사 한 줄에서 나온다.
   */
  it('판매자는 자기 스토어의 것만 읽는다', async () => {
    const mine = { sellerId: seller.sellerId, scopeType: 'SELLER', scopeIds: [seller.sellerId] }

    await issueCoupon(seller, mine)

    const answer = await list(seller, `?sellerId=${seller.sellerId ?? ''}`)

    expect(answer.coupons).toHaveLength(1)
    expect(await failure(list(otherSeller, `?sellerId=${seller.sellerId ?? ''}`))).toMatchObject({
      status: 403,
    })
  })

  it('플랫폼 목록에 판매자 쿠폰이 섞이지 않는다', async () => {
    await issueCoupon(operator)
    await issueCoupon(operator, {
      sellerId: seller.sellerId,
      scopeType: 'SELLER',
      scopeIds: [seller.sellerId],
    })

    const answer = await list(operator)

    expect(answer.coupons).toHaveLength(1)
    expect(answer.coupons[0]?.coupon.sellerId).toBeNull()
  })
})

describe('현황 (F6 · TASK-0074 F5)', () => {
  it('발급·사용·할인 총액을 함께 답한다', async () => {
    const coupon = await issueCoupon(operator)

    await grant(operator, coupon.id, buyer.userId)

    // 쓰인 것으로 만든다. 사용 처리는 주문이 하지만(TASK-0075), 여기서 재는 것은
    // 「그 값이 목록에 실리는가」이므로 넷을 함께 적는다 — 「썼다」는 상태·시각·주문·
    // 금액이 함께 움직이는 사실이고(`UserCoupon_used_check`), 주문 없이 쓴 것으로
    // 만들면 제약이 그것을 거절한다.
    await db.query(
      `UPDATE "UserCoupon"
          SET "status" = 'USED', "usedAt" = now(), "orderId" = $2, "discountAmount" = 2500
        WHERE "couponId" = $1`,
      [coupon.id, await orderOf(buyer.userId)],
    )

    const [entry] = (await list(operator)).coupons

    expect(entry?.coupon.issuedCount).toBe(1)
    expect(entry?.stats.usedCount).toBe(1)
    expect(entry?.stats.discountTotal).toBe(2_500)
  })

  /**
   * **누계는 페이지의 합이 아니다** (TASK-0074 F5). 필터와 페이지에 무관한, 서 있는
   * 수다 — 페이지 합으로 답하면 다음 장을 넘길 때마다 누계가 달라지고, 판매자가
   * 정산과 견주려는 수가 그것이라 더 나쁘다.
   */
  it('누계는 걸러 낸 줄까지 함께 센다', async () => {
    const shown = await issueCoupon(operator)
    const hidden = await issueCoupon(operator)

    for (const coupon of [shown, hidden]) {
      await grant(operator, coupon.id, (await createUser(db)).id)
      await db.query(
        `UPDATE "UserCoupon"
            SET "status" = 'USED', "usedAt" = now(), "orderId" = $2, "discountAmount" = 1000
          WHERE "couponId" = $1`,
        [coupon.id, await orderOf(buyer.userId)],
      )
    }

    // 한 줄만 보이도록 좁혀도 누계는 둘을 다 센다.
    const answer = await list(operator, '?limit=1')

    expect(answer.coupons).toHaveLength(1)
    expect(answer.totals).toEqual({ usedCount: 2, discountTotal: 2_000 })
  })

  it('아직 쓰이지 않았으면 0이다', async () => {
    await issueCoupon(operator)

    const [entry] = (await list(operator)).coupons

    expect(entry?.stats).toEqual({ usedCount: 0, discountTotal: 0 })
  })
})

describe('상태 필터', () => {
  it('진행 중인 것만 고른다', async () => {
    const live = await issueCoupon(operator)

    await issueCoupon(operator, { validFrom: '2026-09-20T00:00:00.000Z' })

    const answer = await list(operator, '?lifecycle=ACTIVE')

    expect(answer.coupons.map((entry) => entry.coupon.id)).toEqual([live.id])
  })

  it('중단한 것만 고른다', async () => {
    const stopped = await issueCoupon(operator)

    await issueCoupon(operator)
    await setSuspended(operator, stopped.id, true)

    const answer = await list(operator, '?lifecycle=SUSPENDED')

    expect(answer.coupons.map((entry) => entry.coupon.id)).toEqual([stopped.id])
    expect(answer.coupons[0]?.lifecycle).toBe('SUSPENDED')
  })

  it('소진된 것만 고른다 — 칸과 칸을 견준다', async () => {
    const spent = await issueCoupon(operator, { issueLimit: 1 })

    await issueCoupon(operator, { issueLimit: 5 })
    await grant(operator, spent.id, buyer.userId)

    const answer = await list(operator, '?lifecycle=EXHAUSTED')

    expect(answer.coupons.map((entry) => entry.coupon.id)).toEqual([spent.id])
  })
})

describe('기간 필터', () => {
  /**
   * **겹치는 것을 찾는다.** 「시작일이 이 사이」로 거르면 8월에 시작해 9월까지 가는
   * 쿠폰이 「9월」 조회에서 사라지는데, 발행자가 찾는 것이 바로 그 쿠폰이다.
   */
  it('기간이 겹치는 쿠폰을 고른다', async () => {
    const spanning = await issueCoupon(operator, {
      validFrom: '2026-08-01T00:00:00.000Z',
      validUntil: '2026-09-15T00:00:00.000Z',
    })

    await issueCoupon(operator, {
      validFrom: '2026-10-01T00:00:00.000Z',
      validUntil: '2026-10-31T00:00:00.000Z',
    })

    const answer = await list(
      operator,
      '?from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z',
    )

    expect(answer.coupons.map((entry) => entry.coupon.id)).toEqual([spanning.id])
  })
})

describe('정렬', () => {
  /** 방금 낸 쿠폰이 맨 위다 — 발행 화면에서 돌아온 사람이 찾는 것이 그것이다. */
  it('최신순이다', async () => {
    const first = await issueCoupon(operator, { name: '먼저' })
    const second = await issueCoupon(operator, { name: '나중' })

    expect((await list(operator)).coupons.map((entry) => entry.coupon.id)).toEqual([
      second.id,
      first.id,
    ])
  })
})

describe('발행 중단 (F5)', () => {
  it('멈추면 새로 받지 못한다', async () => {
    const coupon = await issueCoupon(operator, { withCode: true })

    await setSuspended(operator, coupon.id, true)

    expect(await failure(claim(buyer, formatCouponCode(coupon.code ?? '')))).toMatchObject({
      status: 409,
      code: 'COUPON_SUSPENDED',
    })
  })

  /** **이미 받은 장은 그대로다.** 중단은 나간 것을 무르는 일이 아니다. */
  it('이미 받은 장은 건드리지 않는다', async () => {
    const coupon = await issueCoupon(operator)

    await grant(operator, coupon.id, buyer.userId)
    await setSuspended(operator, coupon.id, true)

    const held = await db.one<{ status: string }>(
      `SELECT "status"::text AS "status" FROM "UserCoupon" WHERE "couponId" = $1`,
      [coupon.id],
    )

    expect(held.status).toBe('ISSUED')
  })

  it('다시 열면 또 받는다', async () => {
    const coupon = await issueCoupon(operator, { withCode: true })

    await setSuspended(operator, coupon.id, true)
    await setSuspended(operator, coupon.id, false)

    const { userCoupon } = await claim(buyer, formatCouponCode(coupon.code ?? ''))

    expect(userCoupon.userId).toBe(buyer.userId)
  })

  /**
   * **멈춘 쿠폰은 한꺼번에도 나가지 않는다.** 한 장씩 가는 길은 발급의 조건부 갱신이
   * 막지만 일괄 발급은 그 문장을 지나지 않아서, 중단의 뜻이 문마다 달라질 뻔했다.
   */
  it('멈춘 쿠폰은 일괄 지급도 되지 않는다', async () => {
    const coupon = await issueCoupon(operator)

    await setSuspended(operator, coupon.id, true)

    expect(await failure(bulkIssue(operator, coupon.id, 'ALL'))).toMatchObject({
      status: 403,
      code: 'COUPON_SUSPENDED',
    })
  })

  it('남의 쿠폰은 멈추지 못한다', async () => {
    const coupon = await issueCoupon(operator)

    expect(await failure(setSuspended(seller, coupon.id, true))).toMatchObject({ status: 403 })
  })
})

describe('일괄 발급 (F4)', () => {
  it('조건에 맞는 회원 전원에게 나간다', async () => {
    const coupon = await issueCoupon(operator)
    const answer = await bulkIssue(operator, coupon.id, 'ALL')
    const count = await db.one<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "UserCoupon" WHERE "couponId" = $1`,
      [coupon.id],
    )

    // 이 스펙이 만든 계정 다섯(관리자·구매자·판매자 둘의 주인들).
    expect(answer.issued).toBe(count.count)
    expect(answer.issued).toBeGreaterThan(0)
    expect(answer.remaining).toBe(0)
  })

  /** 두 번 눌러도 두 장이 되지 않는다 — 이미 가진 사람은 대상이 아니다. */
  it('두 번 눌러도 한 사람에 한 장이다', async () => {
    const coupon = await issueCoupon(operator)
    const first = await bulkIssue(operator, coupon.id, 'ALL')
    const second = await bulkIssue(operator, coupon.id, 'ALL')

    expect(second.issued).toBe(0)
    // **아무도 대상이 아닌 것과 모두가 이미 가진 것은 다른 사실이다.** 「0장」만으로는
    // 그 둘을 가를 수 없고, 발행자가 할 일이 각각 다르다.
    expect(second.skipped).toBe(first.issued)

    const count = await db.one<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "UserCoupon" WHERE "couponId" = $1`,
      [coupon.id],
    )

    expect(count.count).toBe(first.issued)
  })

  it('수량 상한을 넘기지 않고, 남은 수를 알려 준다', async () => {
    const coupon = await issueCoupon(operator, { issueLimit: 2 })
    const answer = await bulkIssue(operator, coupon.id, 'ALL')

    expect(answer.issued).toBe(2)
    expect(answer.remaining).toBeGreaterThan(0)

    const row = await db.one<{ issuedCount: number }>(
      `SELECT "issuedCount" FROM "Coupon" WHERE "id" = $1`,
      [coupon.id],
    )

    expect(row.issuedCount).toBe(2)
  })

  it('주문한 적 없는 회원만 고른다', async () => {
    const coupon = await issueCoupon(operator)
    const answer = await bulkIssue(operator, coupon.id, 'NEVER_ORDERED')

    // 이 스펙에는 주문이 하나도 없으므로 「한 번도 안 산 사람」이 전원이다.
    expect(answer.issued).toBeGreaterThan(0)

    const bought = await bulkIssue(operator, coupon.id, 'HAS_ORDERED')

    expect(bought.issued).toBe(0)
  })
})
