import type { ApiClient, PointSummaryResponse, UserCouponListResponse } from '@shopping/shared'
import {
  ApiClientError,
  pointLedgerResponseSchema,
  pointSummaryResponseSchema,
  userCouponListResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { PointsService } from '../../src/points/points.service.js'
import { createCoupon, createSeller, createUser, createUserCoupon } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 내 쿠폰함과 적립금 (TASK-0077), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 재는 것이 셋이다. **탭의 수가 탭과 무관한가**(F1) · **원장이 그대로 나가는가**(F4) ·
 * **아직 일어나지 않은 둘이 보이는가**(F6, 만료 예정).
 *
 * 마지막이 이 TASK 의 값이다. 적립은 구매확정 시점에 일어나므로 배송완료된 주문은
 * 아직 아무것도 적립하지 않았고, 그 사실을 말해 주지 않으면 사는 사람은 「샀는데 왜
 * 적립이 안 됐지」로 읽는다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-07T00:00:00.000Z'

let buyer: TestCaller

beforeEach(async () => {
  api.clock.set(NOW)
  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }
})

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function box(query = ''): Promise<UserCouponListResponse> {
  return client().request({ path: `/me/coupons${query}`, schema: userCouponListResponseSchema })
}

function points(): Promise<PointSummaryResponse> {
  return client().request({ path: '/me/points', schema: pointSummaryResponseSchema })
}

/** 한 장을 이 사람의 쿠폰함에 넣는다. */
async function issued(
  status: 'ISSUED' | 'USED' | 'EXPIRED',
  options: { readonly expiresAt?: string; readonly userId?: string } = {},
): Promise<string> {
  const coupon = await createCoupon(db)
  const row = await createUserCoupon(db, {
    couponId: coupon.id,
    userId: options.userId ?? buyer.userId,
    status,
    expiresAt: options.expiresAt,
    // 「썼다」는 넷이 함께 움직인다. 여기서 재는 것은 분류이므로 주문 없이 쓴 것으로
    // 만들 수 없고, 그래서 `USED` 는 아래 헬퍼가 주문까지 만든다.
    ...(status === 'USED' ? { usedAt: NOW, orderId: await orderOf(), discountAmount: 1_000 } : {}),
  })

  return row.id
}

async function orderOf(): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), '수령인', '010-0000-0000',
             '06234', '서울시 강남구', 10000, 10000, now())
     RETURNING "id"`,
    [`20260907-${randomSuffix()}`, buyer.userId],
  )

  return row.id
}

/** 실제 경로로 적립한다. 원장은 추가 전용이라 손으로 행을 만들 수 없다. */
async function earn(paidAmount: number): Promise<void> {
  // 정책 행이 없으면 여기서 만들어진다. 유효기간을 미리 줄여 둔 검사는 그 값을 쓴다.
  await api
    .resolve<PointsService>(PointsService)
    .earn({ userId: buyer.userId, paidAmount, refType: 'ORDER', refId: await orderOf() })
}

/**
 * 배송이 끝난 주문 한 건 — 「구매확정을 기다리는 몫」.
 *
 * 상태를 인자로 받는 이유는 **세지 않는 쪽도 재야** 하기 때문이다. 배송완료만
 * 센다는 규칙은 배송중인 몫을 넣어 봐야 증명된다.
 */
async function deliveredOrder(paidAmount: number, status = 'DELIVERED'): Promise<string> {
  const orderId = await orderOf()
  const seller = await createSeller(db, { userId: (await createUser(db)).id })

  await db.query(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3::"SellerOrderStatus", '브랜드', $4, $4, now())`,
    [orderId, seller.id, status, paidAmount],
  )

  return orderId
}

/** 주문번호의 뒤 여덟 자리. Crockford base32 라 아무 문자열이나 되지 않는다. */
function randomSuffix(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * 32)] ?? '0').join('')
}

describe('쿠폰함 (F1)', () => {
  it('상태로 좁혀도 탭의 수는 달라지지 않는다', async () => {
    await issued('ISSUED')
    await issued('ISSUED')
    await issued('USED')
    await issued('EXPIRED')

    const all = await box()
    const usable = await box('?status=ISSUED')

    expect(usable.coupons).toHaveLength(2)
    // **탭의 수는 그 탭을 보고 있는지와 무관한 사실이다.** 좁혀서 세면 고른 탭만
    // 0이 아닌 화면이 된다.
    expect(usable.counts).toEqual({ ISSUED: 2, USED: 1, EXPIRED: 1 })
    expect(all.counts).toEqual(usable.counts)
  })

  it('세 상태가 전부 나간다 — 0이어도', async () => {
    await issued('ISSUED')

    expect((await box()).counts).toEqual({ ISSUED: 1, USED: 0, EXPIRED: 0 })
  })

  it('정책을 함께 실어 한 줄을 그릴 수 있게 한다', async () => {
    await issued('ISSUED')

    const [entry] = (await box()).coupons

    expect(entry?.coupon.discountValue).toBe(3_000)
    expect(entry?.coupon.name).toBeTruthy()
  })

  it('남의 쿠폰함은 보이지 않는다', async () => {
    const stranger = await createUser(db)

    await issued('ISSUED', { userId: stranger.id })

    expect((await box()).coupons).toEqual([])
    expect((await box()).counts).toEqual({ ISSUED: 0, USED: 0, EXPIRED: 0 })
  })

  it('방금 받은 장이 맨 위다', async () => {
    const first = await issued('ISSUED')
    const second = await issued('ISSUED')

    expect((await box()).coupons.map((entry) => entry.id)).toEqual([second, first])
  })
})

describe('적립금 (F4 · F6)', () => {
  it('한 번도 적립받지 않았어도 답이 있다', async () => {
    const answer = await points()

    expect(answer.account.balance).toBe(0)
    expect(answer.pendingEarn).toBe(0)
    expect(answer.expiringSoon).toBeNull()
  })

  it('원장을 그대로 내보낸다 — 잔액만으로는 「왜 줄었지」에 답할 수 없다', async () => {
    const answer = await client().request({
      path: '/me/points/transactions',
      schema: pointLedgerResponseSchema,
    })

    expect(answer.entries).toEqual([])
    expect(answer.account.balance).toBe(0)
  })

  it('남의 적립금은 보이지 않는다 — userId 를 받지 않는다', async () => {
    const stranger = { userId: (await createUser(db)).id, roles: ['BUYER'] as const }
    const answer = await client(stranger).request({
      path: '/me/points',
      schema: pointSummaryResponseSchema,
    })

    expect(answer.account.balance).toBe(0)
  })

  /**
   * **아직 일어나지 않은 적립을 보여 준다** (F6).
   *
   * 적립은 구매확정 시점이므로(`pricing.md` 5장) 배송완료된 주문은 아직 아무것도
   * 적립하지 않았다. 그 사실을 말해 주지 않으면 사는 사람은 「샀는데 왜 적립이 안
   * 됐지」로 읽고, 그것이 이 값의 존재 이유다.
   */
  it('배송완료된 몫에서 들어올 적립금을 미리 말한다', async () => {
    await deliveredOrder(50_000)

    // 정책 행은 처음 물을 때 만들어진다 — 표를 직접 읽으면 아직 없다.
    const policy = await api.resolve<PointsService>(PointsService).policy()
    const answer = await points()

    expect(answer.pendingEarn).toBe(Math.floor((50_000 * policy.earnRateBp) / 10_000))
    expect(answer.pendingEarn).toBeGreaterThan(0)
    // 아직 원장에는 아무 행도 없다 — 확정되지 않았기 때문이다.
    expect(answer.account.balance).toBe(0)
  })

  /**
   * **준비중·배송중은 세지 않는다.** 취소 한 번에 사라지는 수를 「들어올 것」이라고
   * 적으면, 그때 그 화면은 없어진 돈을 설명해야 한다.
   */
  it('아직 배송이 끝나지 않은 몫은 세지 않는다', async () => {
    await deliveredOrder(50_000, 'SHIPPED')

    expect((await points()).pendingEarn).toBe(0)
  })

  it('기본 유효기간이면 아직 경고하지 않는다', async () => {
    await earn(100_000)

    const answer = await points()

    // 정책의 기본 유효기간이 1년이라 30일 안에 사라질 것이 없다.
    expect(answer.account.balance).toBeGreaterThan(0)
    expect(answer.expiringSoon).toBeNull()
  })

  /**
   * 합을 함께 내는 이유는 **시각만으로는 사람이 할 일을 정할 수 없기** 때문이다 —
   * 「9월 30일에 만료됩니다」는 100원이든 5만원이든 같은 문장이고, 둘에 대해 할 일이
   * 다르다.
   *
   * 원장을 손으로 고쳐 만들지 않는다. 추가 전용 트리거가 그것을 막고 있고, 막는 것이
   * 맞다 — 대신 **정책의 유효기간을 줄여** 실제 경로로 짧은 통을 만든다.
   */
  it('곧 사라질 적립금을 합과 가장 이른 시각으로 말한다', async () => {
    // **정책 행을 먼저 만든다.** 그 행은 처음 물을 때 생기므로, 묻기 전에 고치면
    // 0행을 고치고 조용히 지나간다 — 그 상태에서는 기본 1년이 그대로 쓰인다.
    await api.resolve<PointsService>(PointsService).policy()
    await db.query(`UPDATE "PointPolicy" SET "validityDays" = 10 WHERE "id" = 1`)
    await earn(100_000)

    const answer = await points()

    expect(answer.expiringSoon?.amount).toBe(answer.account.balance)
    expect(answer.expiringSoon?.at).toBe('2026-09-17T00:00:00.000Z')
  })

  it('로그인하지 않으면 읽을 수 없다 (A4)', async () => {
    const error: unknown = await api.client
      .request({ path: '/me/points', schema: pointSummaryResponseSchema })
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).status).toBe(401)
  })
})
