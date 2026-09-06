import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  COUPON_EXPIRY_BATCH_LIMIT,
  COUPON_EXPIRY_LAST_EXPIRED_KEY,
  COUPON_EXPIRY_LAST_RUN_KEY,
  COUPON_EXPIRY_LOCK_KEY,
} from '../../src/coupons/coupon-expiry.js'
import { CouponExpiryService } from '../../src/coupons/coupon-expiry.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'

/**
 * 쿠폰 만료 배치 (TASK-0072 F7), 이 워커의 실제 데이터베이스에 대고.
 *
 * 재는 것이 셋이고, **셋 다 틀려도 아무 요청이 실패하지 않는다.**
 *
 * - 기간이 지난 장을 옮기는가, 그리고 **아직 유효한 장을 건드리지 않는가.** 뒤엣
 *   것이 더 위험하다 — 옮겨진 쿠폰은 그 사람이 쓰려 할 때에야 사라진 것을 알게 된다.
 * - **쓴 장을 건드리지 않는가.** `USED` 를 만료로 덮으면 「이 주문에 쓰인 쿠폰」이
 *   만료된 쿠폰이 되어 환불 복원(TASK-0078)이 되돌릴 대상을 잃는다.
 * - **건너뛴 주기를 「돌았다」로 적지 않는가.** 적으면 한 인스턴스도 옮기지 못하는
 *   상태에서 마지막 실행 시각이 계속 새로워지고, 그것을 보는 헬스체크는 영원히
 *   초록이다 (`payment-reconcile.spec.ts` 와 같은 단언).
 */

const db = useDatabase()
const api = useApiApp({ database: db })

/** 이 스펙이 서는 시각. 만료의 안팎을 여기서부터 잰다. */
const NOW = '2026-09-20T00:00:00.000Z'

const PAST = '2026-09-10T00:00:00.000Z'
const FUTURE = '2026-09-30T00:00:00.000Z'
const OPENED = '2026-09-01T00:00:00.000Z'

let userId: string

beforeEach(async () => {
  api.clock.set(NOW)
  userId = (await createUser(db)).id
})

function expiry(): CouponExpiryService {
  return api.resolve<CouponExpiryService>(CouponExpiryService)
}

/** 정책 하나. 유효기간만 스펙이 정한다. */
async function coupon(validUntil: string): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO "Coupon"
       ("id", "issuerType", "name", "discountType", "discountValue", "minOrderAmount",
        "scopeType", "scopeIds", "validFrom", "validUntil", "updatedAt")
     VALUES (gen_random_uuid(), 'PLATFORM', '만료 시험', 'FIXED', 1000, 0,
             'ALL', '{}'::text[], $1::timestamp, $2::timestamp, now())
     RETURNING "id"`,
    [OPENED, validUntil],
  )

  return row.id
}

/** 발급된 한 장. 배치가 보는 것은 이 표의 `status` 와 `expiresAt` 뿐이다. */
async function issued(
  couponId: string,
  options: { readonly expiresAt: string; readonly owner?: string } = { expiresAt: FUTURE },
): Promise<string> {
  const row = await db.one<{ id: string }>(
    `INSERT INTO "UserCoupon" ("id", "couponId", "userId", "expiresAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3::timestamp, now())
     RETURNING "id"`,
    [couponId, options.owner ?? userId, options.expiresAt],
  )

  return row.id
}

/** 이미 쓴 한 장. `UserCoupon_used_check` 때문에 주문까지 있어야 만들어진다. */
async function used(couponId: string, expiresAt: string): Promise<string> {
  const orderId = randomUUID()

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '수령인', '010-0000-0000',
             '06234', '서울시 강남구', 10000, 10000, now())`,
    [orderId, `20260920-${randomUUID().slice(0, 8).toUpperCase()}`, userId],
  )

  const row = await db.one<{ id: string }>(
    `INSERT INTO "UserCoupon"
       ("id", "couponId", "userId", "status", "expiresAt", "usedAt", "orderId", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 'USED', $3::timestamp, now(), $4, now())
     RETURNING "id"`,
    [couponId, userId, expiresAt, orderId],
  )

  return row.id
}

async function statusOf(id: string): Promise<string> {
  const row = await db.one<{ status: string }>(
    `SELECT "status"::text AS "status" FROM "UserCoupon" WHERE "id" = $1`,
    [id],
  )

  return row.status
}

async function metaOf(key: string): Promise<string | null> {
  const rows = await db.query<{ value: string }>(`SELECT "value" FROM "AppMeta" WHERE "key" = $1`, [
    key,
  ])

  return rows[0]?.value ?? null
}

describe('만료 전환 (F7)', () => {
  it('기간이 지난 장을 EXPIRED 로 옮긴다', async () => {
    const stale = await issued(await coupon(PAST), { expiresAt: PAST })

    expect(await expiry().sweep()).toEqual({ expired: 1, skipped: false })
    expect(await statusOf(stale)).toBe('EXPIRED')
  })

  it('아직 유효한 장은 건드리지 않는다', async () => {
    // 옮겨진 쿠폰은 그 사람이 쓰려 할 때에야 사라진 것을 알게 된다 — 아무것도
    // 실패하지 않고, 아무도 신고하지 않는다.
    const live = await issued(await coupon(FUTURE), { expiresAt: FUTURE })

    expect(await expiry().sweep()).toEqual({ expired: 0, skipped: false })
    expect(await statusOf(live)).toBe('ISSUED')
  })

  it('만료 시각 정각이면 만료다 — 발급 판정과 같은 순간이다', async () => {
    // `issuabilityFault` 의 끝은 열린 구간(`now >= validUntil`)이고 배치의 조건은
    // `"expiresAt" <= now` 다. 둘이 어긋나면 그 한 순간에 발급된 쿠폰이 받자마자
    // 만료된 채로 쿠폰함에 앉는다.
    const edge = await issued(await coupon(NOW), { expiresAt: NOW })

    expect(await expiry().sweep()).toMatchObject({ expired: 1 })
    expect(await statusOf(edge)).toBe('EXPIRED')
  })

  it('이미 쓴 장은 기간이 지나도 건드리지 않는다', async () => {
    // 쓴 쿠폰은 만료된 것이 아니라 쓰인 것이다. 덮으면 환불 복원(TASK-0078)이
    // 되돌릴 대상을 잃는다.
    const spent = await used(await coupon(PAST), PAST)

    expect(await expiry().sweep()).toEqual({ expired: 0, skipped: false })
    expect(await statusOf(spent)).toBe('USED')
  })

  it('이미 만료된 장을 두 번 세지 않는다', async () => {
    await issued(await coupon(PAST), { expiresAt: PAST })

    expect((await expiry().sweep()).expired).toBe(1)
    // 두 번째 주기는 옮길 것이 없다. 세면 「배치가 일하고 있는가」를 묻는 숫자가
    // 영원히 0으로 안 떨어진다.
    expect((await expiry().sweep()).expired).toBe(0)
  })

  it('섞여 있어도 지난 것만 고른다', async () => {
    const stale = await issued(await coupon(PAST), { expiresAt: PAST })
    const live = await issued(await coupon(FUTURE), { expiresAt: FUTURE })
    const spent = await used(await coupon(PAST), PAST)

    expect((await expiry().sweep()).expired).toBe(1)
    expect([await statusOf(stale), await statusOf(live), await statusOf(spent)]).toEqual([
      'EXPIRED',
      'ISSUED',
      'USED',
    ])
  })
})

describe('상한과 다음 주기', () => {
  it('한 주기가 상한만큼만 옮기고 나머지는 다음 주기가 가져간다', async () => {
    // 쿠폰은 **한꺼번에 만료된다** — 캠페인 하나가 같은 `validUntil` 로 뿌린 장이
    // 그 순간 전부 대상이 된다. 상한이 없으면 그 한 문장이 표 전체를 훑는 동안
    // 쿠폰함 조회가 그 뒤에 선다.
    await bulkIssued(COUPON_EXPIRY_BATCH_LIMIT + 3)

    expect((await expiry().sweep()).expired).toBe(COUPON_EXPIRY_BATCH_LIMIT)
    expect((await expiry().sweep()).expired).toBe(3)
    expect((await expiry().sweep()).expired).toBe(0)
  })
})

describe('한 인스턴스만 돈다', () => {
  it('락을 못 잡으면 건너뛴다', async () => {
    const stale = await issued(await coupon(PAST), { expiresAt: PAST })

    const result = await db.withConnection(async (holder) => {
      await holder.query('SELECT pg_advisory_lock($1::bigint)', [COUPON_EXPIRY_LOCK_KEY])

      try {
        return await expiry().sweep()
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1::bigint)', [COUPON_EXPIRY_LOCK_KEY])
      }
    })

    expect(result).toEqual({ expired: 0, skipped: true })
    // 건너뛴 주기는 아무것도 옮기지 않았다 — 「0장 처리」와 「못 돌았다」가 여기서
    // 갈린다.
    expect(await statusOf(stale)).toBe('ISSUED')
  })

  it('건너뛴 주기는 돈 것으로 적지 않는다', async () => {
    // 적으면 실제로는 한 인스턴스도 옮기지 못하는 상태에서 마지막 실행 시각이
    // 계속 새로워지고, 그것을 보는 헬스체크는 영원히 초록을 답한다.
    await db.withConnection(async (holder) => {
      await holder.query('SELECT pg_advisory_lock($1::bigint)', [COUPON_EXPIRY_LOCK_KEY])

      try {
        await expiry().sweep()
      } finally {
        await holder.query('SELECT pg_advisory_unlock($1::bigint)', [COUPON_EXPIRY_LOCK_KEY])
      }
    })

    expect(await metaOf(COUPON_EXPIRY_LAST_RUN_KEY)).toBeNull()
    expect(await expiry().lastRunAt()).toBeNull()
  })
})

describe('돈 사실을 남긴다', () => {
  it('주기가 시작한 시각과 옮긴 장수를 적는다', async () => {
    await issued(await coupon(PAST), { expiresAt: PAST })
    await expiry().sweep()

    expect(await metaOf(COUPON_EXPIRY_LAST_RUN_KEY)).toBe(NOW)
    expect(await metaOf(COUPON_EXPIRY_LAST_EXPIRED_KEY)).toBe('1')
    expect(await expiry().lastRunAt()).toEqual(new Date(NOW))
    expect(await expiry().lastExpired()).toBe(1)
  })

  it('0장인 주기도 돈 것으로 적는다', async () => {
    // 로그는 남기지 않지만 **돌았다는 사실은 남긴다.** 헬스체크가 묻는 것은 「무엇을
    // 옮겼나」가 아니라 「돌고 있나」다.
    await expiry().sweep()

    expect(await metaOf(COUPON_EXPIRY_LAST_RUN_KEY)).toBe(NOW)
    expect(await expiry().lastExpired()).toBe(0)
  })

  it('한 번도 안 돌았으면 시각이 없다', async () => {
    expect(await expiry().lastRunAt()).toBeNull()
    expect(await expiry().lastExpired()).toBe(0)
  })

  it('손으로 고친 행이 헬스체크를 끌어내리지 않는다', async () => {
    await db.execute(
      `INSERT INTO "AppMeta" ("key", "value", "updatedAt") VALUES ($1, '어제쯤', now())`,
      [COUPON_EXPIRY_LAST_RUN_KEY],
    )

    expect(await expiry().lastRunAt()).toBeNull()
  })
})

/**
 * 만료 대상 `count` 장을 한 문장으로 만든다.
 *
 * 사람을 `count` 명 만들지 않는 이유는 중복 발급 열쇠가 `(couponId, userId)` 라
 * **쿠폰을 늘리는 쪽이 싸기** 때문이다. 배치가 보는 것은 `status` 와 `expiresAt`
 * 뿐이므로 어느 쪽으로 늘리든 재는 것은 같다.
 */
async function bulkIssued(count: number): Promise<void> {
  await db.execute(
    `WITH minted AS (
       INSERT INTO "Coupon"
         ("id", "issuerType", "name", "discountType", "discountValue", "minOrderAmount",
          "scopeType", "scopeIds", "validFrom", "validUntil", "updatedAt")
       SELECT gen_random_uuid(), 'PLATFORM', '대량', 'FIXED', 1000, 0,
              'ALL', '{}'::text[], $2::timestamp, $3::timestamp, now()
         FROM generate_series(1, $1::int)
       RETURNING "id"
     )
     INSERT INTO "UserCoupon" ("id", "couponId", "userId", "expiresAt", "updatedAt")
     SELECT gen_random_uuid(), m."id", $4::uuid, $3::timestamp, now() FROM minted m`,
    [count, OPENED, PAST, userId],
  )
}
