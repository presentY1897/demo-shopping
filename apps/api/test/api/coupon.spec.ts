import type { ApiClient, CouponResponse, UserCouponResponse } from '@shopping/shared'
import {
  ApiClientError,
  COUPON_CODE_PATTERN,
  couponResponseSchema,
  userCouponResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { formatCouponCode } from '../../src/coupons/coupon-code.js'
import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createCategory, createProduct, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * 쿠폰 발행 · 발급 (TASK-0072), 이 워커의 실제 데이터베이스에 대고.
 *
 * 규칙 표가 옳은지는 `coupon-rules.spec.ts` 가 순수 함수로 잰다. **여기서 재는 것은
 * 그 표가 행에 실제로 적용되는가**이고, 값의 절반이 둘에 몰려 있다.
 *
 * - **발급 수량이 동시 요청에서도 지켜지는가** (F6). 그 검사가 뜻을 가지려면 열
 *   건이 각자 「아직 남았다」를 읽는 상황이 실제로 만들어져야 한다 — 동시에 쏘는
 *   것만으로는 겹침이 우연이고, 겹치지 않은 실행에서도 단언은 초록이다. 그래서
 *   아래는 배리어로 **겹침을 배열한다.**
 * - **판매자가 자기 가게 밖으로 나가지 못하는가** (F2). 서버로 한 번, **날 SQL 로**
 *   한 번 잰다 (QUALITY-GATES S5) — 마이그레이션에 문자열이 있는지 보는 것만으로는
 *   조건이 잘못 적힌 경우를 못 잡는다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 이 스펙이 서는 시각. 유효기간의 안팎을 여기서부터 잰다. */
const NOW = '2026-09-03T00:00:00.000Z'

const VALID_FROM = '2026-09-01T00:00:00.000Z'
const VALID_UNTIL = '2026-09-30T00:00:00.000Z'

let seller: TestCaller
let otherSeller: TestCaller
let buyer: TestCaller
let categoryId: number

beforeEach(async () => {
  api.clock.set(NOW)

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }

  const rival = await createUser(db)
  const rivalStore = await createSeller(db, { userId: rival.id })

  otherSeller = { userId: rival.id, roles: ['SELLER_OWNER'], sellerId: rivalStore.id }

  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  categoryId = (await createCategory(db)).id
})

/** 발행 요청의 몸통. 스펙마다 한 칸씩만 어긋뜨린다. */
interface CouponDraft {
  readonly sellerId?: string | null
  readonly name?: string
  readonly discountType?: 'FIXED' | 'PERCENT'
  readonly discountValue?: number
  readonly maxDiscountAmount?: number | null
  readonly minOrderAmount?: number
  readonly scopeType?: 'ALL' | 'CATEGORY' | 'PRODUCT' | 'SELLER'
  readonly scopeIds?: readonly string[]
  readonly validFrom?: string
  readonly validUntil?: string
  readonly issueLimit?: number | null
  readonly withCode?: boolean
}

function body(draft: CouponDraft): Record<string, unknown> {
  return {
    sellerId: draft.sellerId ?? null,
    name: draft.name ?? '가을 쿠폰',
    discountType: draft.discountType ?? 'PERCENT',
    discountValue: draft.discountValue ?? 10,
    maxDiscountAmount: draft.maxDiscountAmount ?? null,
    minOrderAmount: draft.minOrderAmount ?? 0,
    scopeType: draft.scopeType ?? 'ALL',
    scopeIds: draft.scopeIds ?? [],
    validFrom: draft.validFrom ?? VALID_FROM,
    validUntil: draft.validUntil ?? VALID_UNTIL,
    issueLimit: draft.issueLimit ?? null,
    withCode: draft.withCode ?? false,
  }
}

function issueCoupon(caller: TestCaller, draft: CouponDraft): Promise<CouponResponse> {
  return client(caller).request({
    path: '/coupons',
    method: 'POST',
    body: body(draft),
    schema: couponResponseSchema,
  })
}

function grant(caller: TestCaller, couponId: string, userId: string): Promise<UserCouponResponse> {
  return client(caller).request({
    path: `/coupons/${couponId}/issues`,
    method: 'POST',
    body: { userId },
    schema: userCouponResponseSchema,
  })
}

function claim(caller: TestCaller, code: string): Promise<UserCouponResponse> {
  return client(caller).request({
    path: '/coupons/claims',
    method: 'POST',
    body: { code },
    schema: userCouponResponseSchema,
  })
}

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly field: string
}

/**
 * 실패를 **도메인 코드로** 되읽는다.
 *
 * 예외 클래스로 판단하지 않는 이유는 그것이 검사와 구현을 같은 편으로 만들기
 * 때문이다. 코드는 부르는 쪽이 실제로 보는 것이고, 거절마다 다른 코드가 나가는
 * 것이 이 TASK 가 약속한 바다 (`claim.spec.ts` 와 같은 헬퍼).
 */
function failureOf(error: unknown): HttpFailure {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const detail = error.body?.error.details?.at(0)
  const entry = typeof detail === 'object' && detail !== null ? detail : {}
  const field = 'field' in entry && typeof entry.field === 'string' ? entry.field : ''

  return { status: error.status ?? 0, code: error.body?.error.code ?? '', field }
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  return failureOf(
    await work.then(
      () => null,
      (reason: unknown) => reason,
    ),
  )
}

/** 날 SQL 이 거절당했는가. 거절되지 않으면 그 사실이 실패다. */
async function refusedBySql(statement: string, values: readonly unknown[]): Promise<string> {
  const outcome = await db.execute(statement, values).then(
    () => null,
    (error: unknown) => error,
  )

  if (outcome === null) throw new Error('데이터베이스가 거절할 것으로 기대한 문장이 통과했습니다.')

  // 제약 이름은 메시지에 있다. 그것으로 단언해야 「거절됐다」가 아니라 **어느 제약이
  // 거절했는가**를 재는 검사가 된다 — 다른 이유로 실패한 문장도 거절이기 때문이다.
  return outcome instanceof Error ? outcome.message : JSON.stringify(outcome)
}

// ---------------------------------------------------------------------- 발행

describe('발행 — 부담 주체 (F1)', () => {
  it('관리자가 낸 쿠폰은 플랫폼 부담으로 저장된다', async () => {
    const { coupon } = await issueCoupon(callers.operator, {})

    expect(coupon.issuerType).toBe('PLATFORM')
    expect(coupon.sellerId).toBeNull()
  })

  it('판매자가 낸 쿠폰은 판매자 부담으로, 자기 가게를 달고 저장된다', async () => {
    // 정산이 「판매자 부담 쿠폰」을 이 두 칸으로 읽는다 (D-029 · `pricing.md` 6장).
    const { coupon } = await issueCoupon(seller, {
      sellerId: seller.sellerId ?? null,
      scopeType: 'SELLER',
      scopeIds: [seller.sellerId ?? ''],
    })

    expect(coupon.issuerType).toBe('SELLER')
    expect(coupon.sellerId).toBe(seller.sellerId)
  })

  it('부담 주체는 요청이 고르지 않는다 — 저장된 값이 sellerId 에서 파생된다', async () => {
    // 요청에 `issuerType` 이 없으므로 「PLATFORM 인데 sellerId 가 있는」 조합이
    // 표현조차 되지 않는다. DB 의 `Coupon_issuer_check` 는 그 다음 겹이다.
    const platform = await issueCoupon(callers.operator, {})
    const bySeller = await issueCoupon(callers.operator, {
      sellerId: seller.sellerId ?? null,
      scopeType: 'SELLER',
      scopeIds: [seller.sellerId ?? ''],
    })

    expect([platform.coupon.issuerType, bySeller.coupon.issuerType]).toEqual(['PLATFORM', 'SELLER'])
  })

  it('판매자는 플랫폼 쿠폰을 낼 수 없다', async () => {
    // `platformOwnership` 은 `own` 도 `demo` 도 인정하지 않는다. 서비스가 역할을
    // 직접 보지 않고도 이 거절이 나오는 것이 이 설계의 값이다.
    expect(await failure(issueCoupon(seller, {}))).toMatchObject({ status: 403 })
  })

  it('데모 관리자도 플랫폼 쿠폰을 낼 수 없다', async () => {
    // `DEMO_ADMIN` 의 `coupon.write` 는 `demo` 로 좁혀져 있고, 플랫폼 데이터는
    // 데모가 만든 것이 아니다 — 실계정이 받게 될 쿠폰을 방문자가 만들지 못한다.
    expect(await failure(issueCoupon(callers.demoAdmin, {}))).toMatchObject({ status: 403 })
  })

  it('구매자는 쿠폰을 낼 수 없다 (A3)', async () => {
    expect(await failure(issueCoupon(buyer, {}))).toMatchObject({ status: 403 })
  })

  it('로그인하지 않으면 401 이다 (A4)', async () => {
    const failed = await failure(
      api.client.request({
        path: '/coupons',
        method: 'POST',
        body: body({}),
        schema: couponResponseSchema,
      }),
    )

    expect(failed).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
  })
})

// ------------------------------------------------------------- 판매자 범위

describe('판매자 범위 강제 — 서버 (F2)', () => {
  it('전체 범위 쿠폰을 거절한다', async () => {
    const failed = await failure(
      issueCoupon(seller, { sellerId: seller.sellerId ?? null, scopeType: 'ALL', scopeIds: [] }),
    )

    expect(failed).toMatchObject({
      status: 403,
      code: 'COUPON_SCOPE_FORBIDDEN',
      field: 'scopeType',
    })
  })

  it('카테고리 범위 쿠폰도 거절한다', async () => {
    // 카테고리는 플랫폼 공용이라 이름만 좁다. 「셔츠 10%」를 낸 판매자가 다른
    // 가게의 셔츠까지 물게 된다.
    const failed = await failure(
      issueCoupon(seller, {
        sellerId: seller.sellerId ?? null,
        scopeType: 'CATEGORY',
        scopeIds: [String(categoryId)],
      }),
    )

    expect(failed).toMatchObject({ status: 403, code: 'COUPON_SCOPE_FORBIDDEN' })
  })

  it('남의 가게를 범위로 고르면 거절한다', async () => {
    const failed = await failure(
      issueCoupon(seller, {
        sellerId: seller.sellerId ?? null,
        scopeType: 'SELLER',
        scopeIds: [otherSeller.sellerId ?? ''],
      }),
    )

    expect(failed).toMatchObject({
      status: 403,
      code: 'COUPON_SCOPE_FORBIDDEN',
      field: 'scopeIds',
    })
  })

  it('남의 상품을 범위로 고르면 거절한다', async () => {
    // CHECK 가 못 재는 절반이다 — 「이 상품이 저 가게 것인가」는 조인이 필요하고,
    // 그 조인은 서비스에서만 할 수 있다.
    const foreign = await createProduct(db, {
      sellerId: otherSeller.sellerId ?? '',
      categoryId,
    })
    const failed = await failure(
      issueCoupon(seller, {
        sellerId: seller.sellerId ?? null,
        scopeType: 'PRODUCT',
        scopeIds: [foreign.id],
      }),
    )

    expect(failed).toMatchObject({ status: 400, code: 'INVALID', field: 'scopeIds' })
  })

  it('자기 상품이면 통과한다', async () => {
    const mine = await createProduct(db, { sellerId: seller.sellerId ?? '', categoryId })
    const { coupon } = await issueCoupon(seller, {
      sellerId: seller.sellerId ?? null,
      scopeType: 'PRODUCT',
      scopeIds: [mine.id],
    })

    expect(coupon.scopeIds).toEqual([mine.id])
  })

  it('내 상품이 하나 섞여 있어도 남의 상품이 있으면 거절한다', async () => {
    const mine = await createProduct(db, { sellerId: seller.sellerId ?? '', categoryId })
    const foreign = await createProduct(db, {
      sellerId: otherSeller.sellerId ?? '',
      categoryId,
    })
    const failed = await failure(
      issueCoupon(seller, {
        sellerId: seller.sellerId ?? null,
        scopeType: 'PRODUCT',
        scopeIds: [mine.id, foreign.id],
      }),
    )

    expect(failed).toMatchObject({ status: 400, field: 'scopeIds' })
  })

  it('대문자로 온 uuid 도 같은 대상으로 읽는다', async () => {
    // 서버는 통과시키는데 `Coupon_seller_scope_check` 가 거절하면 500 이 나간다 —
    // 그 500 은 「대소문자」라고 말해 주지 않는다. 표준형으로 내려 저장하는 것이
    // 그 갈림을 없앤다 (`canonicalScopeIds`).
    const { coupon } = await issueCoupon(seller, {
      sellerId: (seller.sellerId ?? '').toUpperCase(),
      scopeType: 'SELLER',
      scopeIds: [(seller.sellerId ?? '').toUpperCase()],
    })

    expect(coupon.sellerId).toBe(seller.sellerId)
    expect(coupon.scopeIds).toEqual([seller.sellerId])
  })

  it('같은 대상을 두 번 골라도 받는다', async () => {
    const mine = await createProduct(db, { sellerId: seller.sellerId ?? '', categoryId })
    const { coupon } = await issueCoupon(seller, {
      sellerId: seller.sellerId ?? null,
      scopeType: 'PRODUCT',
      scopeIds: [mine.id, mine.id],
    })

    expect(coupon.scopeIds).toEqual([mine.id])
  })

  it('없는 카테고리를 범위로 고르면 거절한다 — 조용히 아무 일도 안 하는 쿠폰을 막는다', async () => {
    const failed = await failure(
      issueCoupon(callers.operator, {
        scopeType: 'CATEGORY',
        scopeIds: [String(categoryId + 10_000)],
      }),
    )

    expect(failed).toMatchObject({ status: 400, field: 'scopeIds' })
  })
})

describe('판매자 범위 강제 — 날 SQL (S5)', () => {
  const insert = `INSERT INTO "Coupon"
      ("id", "issuerType", "sellerId", "name", "discountType", "discountValue",
       "minOrderAmount", "scopeType", "scopeIds", "validFrom", "validUntil", "updatedAt")
    VALUES (gen_random_uuid(), $1::"CouponIssuerType", $2, '직접', 'PERCENT', 10,
            0, $3::"CouponScopeType", $4::text[], now(), now() + interval '1 day', now())`

  it('판매자 쿠폰의 전체 범위를 DB 가 거절한다', async () => {
    const message = await refusedBySql(insert, ['SELLER', seller.sellerId, 'ALL', []])

    expect(message).toContain('Coupon_seller_scope_check')
  })

  it('판매자 쿠폰의 카테고리 범위를 DB 가 거절한다', async () => {
    const message = await refusedBySql(insert, [
      'SELLER',
      seller.sellerId,
      'CATEGORY',
      [String(categoryId)],
    ])

    expect(message).toContain('Coupon_seller_scope_check')
  })

  it('판매자 쿠폰이 남의 가게를 가리키는 것을 DB 가 거절한다', async () => {
    // 두 값이 같은 행에 있어서 CHECK 로 표현되는, 이 표에서 가장 강한 제약이다.
    const message = await refusedBySql(insert, [
      'SELLER',
      seller.sellerId,
      'SELLER',
      [otherSeller.sellerId],
    ])

    expect(message).toContain('Coupon_seller_scope_check')
  })

  it('자기 가게를 가리키는 판매자 쿠폰은 통과시킨다', async () => {
    // 통제군. 위 셋이 「무엇이든 거절하는 CHECK」에서도 통과하면 뜻이 없다.
    await expect(
      db.execute(insert, ['SELLER', seller.sellerId, 'SELLER', [seller.sellerId]]),
    ).resolves.toBe(1)
  })

  it('부담 주체와 판매자 참조가 어긋난 행을 DB 가 거절한다', async () => {
    const orphan = await refusedBySql(insert, ['SELLER', null, 'SELLER', ['x']])
    const impostor = await refusedBySql(insert, [
      'PLATFORM',
      seller.sellerId,
      'SELLER',
      [seller.sellerId],
    ])

    expect(orphan).toContain('Coupon_issuer_check')
    expect(impostor).toContain('Coupon_issuer_check')
  })
})

describe('정책의 짝 (S5 · A2)', () => {
  it('정률 100 초과를 서버가 거절한다', async () => {
    const failed = await failure(issueCoupon(callers.operator, { discountValue: 101 }))

    expect(failed).toMatchObject({ status: 400, code: 'INVALID', field: 'discountValue' })
  })

  it('정액에 상한을 두면 서버가 거절한다', async () => {
    const failed = await failure(
      issueCoupon(callers.operator, {
        discountType: 'FIXED',
        discountValue: 3_000,
        maxDiscountAmount: 1_000,
      }),
    )

    expect(failed).toMatchObject({ status: 400, field: 'maxDiscountAmount' })
  })

  it('기간이 뒤집히면 서버가 거절한다', async () => {
    const failed = await failure(
      issueCoupon(callers.operator, { validFrom: VALID_UNTIL, validUntil: VALID_FROM }),
    )

    expect(failed).toMatchObject({ status: 400, field: 'validUntil' })
  })

  it('DB 도 같은 짝을 거절한다', async () => {
    const percent = await refusedBySql(
      `INSERT INTO "Coupon"
         ("id", "issuerType", "name", "discountType", "discountValue", "minOrderAmount",
          "scopeType", "scopeIds", "validFrom", "validUntil", "updatedAt")
       VALUES (gen_random_uuid(), 'PLATFORM', '직접', 'PERCENT', 101, 0,
               'ALL', '{}'::text[], now(), now() + interval '1 day', now())`,
      [],
    )
    const fixed = await refusedBySql(
      `INSERT INTO "Coupon"
         ("id", "issuerType", "name", "discountType", "discountValue", "maxDiscountAmount",
          "minOrderAmount", "scopeType", "scopeIds", "validFrom", "validUntil", "updatedAt")
       VALUES (gen_random_uuid(), 'PLATFORM', '직접', 'FIXED', 3000, 1000,
               0, 'ALL', '{}'::text[], now(), now() + interval '1 day', now())`,
      [],
    )

    expect(percent).toContain('Coupon_discount_check')
    expect(fixed).toContain('Coupon_discount_check')
  })
})

// ---------------------------------------------------------------------- 발급

describe('발급 (F3 · F4)', () => {
  it('지급하면 쿠폰함에 한 장이 생기고 발급 수가 는다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: 10 })
    const { userCoupon } = await grant(callers.operator, coupon.id, buyer.userId)

    expect(userCoupon).toMatchObject({
      couponId: coupon.id,
      userId: buyer.userId,
      status: 'ISSUED',
      usedAt: null,
      orderId: null,
    })
    // 만료 시각은 정책의 사본이다 — 발행자가 나중에 기간을 줄여도 이미 받은
    // 쿠폰이 소급해서 짧아지지 않는다.
    expect(userCoupon.expiresAt).toBe(new Date(VALID_UNTIL).toISOString())
    expect(await issuedCountOf(coupon.id)).toBe(1)
  })

  it('같은 쿠폰을 두 번 받을 수 없다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: 10 })

    await grant(callers.operator, coupon.id, buyer.userId)

    const failed = await failure(grant(callers.operator, coupon.id, buyer.userId))

    expect(failed).toMatchObject({ status: 409, code: 'COUPON_ALREADY_ISSUED' })
    // 진 요청이 자리를 태우지 않는다 — 늘린 수량이 트랜잭션과 함께 되돌아간다.
    expect(await issuedCountOf(coupon.id)).toBe(1)
  })

  it('중복 발급을 DB 가 막는다 (S5)', async () => {
    const { coupon } = await issueCoupon(callers.operator, {})

    await grant(callers.operator, coupon.id, buyer.userId)

    const message = await refusedBySql(
      `INSERT INTO "UserCoupon" ("id", "couponId", "userId", "expiresAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, now() + interval '1 day', now())`,
      [coupon.id, buyer.userId],
    )

    expect(message).toContain('UserCoupon_couponId_userId_key')
  })

  it('없는 회원에게는 지급하지 않는다', async () => {
    const { coupon } = await issueCoupon(callers.operator, {})
    const failed = await failure(
      grant(callers.operator, coupon.id, '0192f0c1-0000-7000-8000-0000000cffff'),
    )

    expect(failed.status).toBe(404)
  })

  it('남의 쿠폰은 나눠 줄 수 없다', async () => {
    const { coupon } = await issueCoupon(otherSeller, {
      sellerId: otherSeller.sellerId ?? null,
      scopeType: 'SELLER',
      scopeIds: [otherSeller.sellerId ?? ''],
    })

    expect(await failure(grant(seller, coupon.id, buyer.userId))).toMatchObject({ status: 403 })
  })
})

describe('발급 수량 소진 (F5)', () => {
  it('한도만큼 나가면 그 다음은 거절된다 — 순차', async () => {
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: 2 })
    const recipients = [
      (await createUser(db)).id,
      (await createUser(db)).id,
      (await createUser(db)).id,
    ]

    await grant(callers.operator, coupon.id, recipients[0] ?? '')
    await grant(callers.operator, coupon.id, recipients[1] ?? '')

    const failed = await failure(grant(callers.operator, coupon.id, recipients[2] ?? ''))

    expect(failed).toMatchObject({ status: 409, code: 'COUPON_ISSUE_EXHAUSTED' })
    expect(await issuedCountOf(coupon.id)).toBe(2)
  })

  it('무제한 쿠폰은 소진되지 않는다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: null })

    for (let index = 0; index < 3; index += 1) {
      await grant(callers.operator, coupon.id, (await createUser(db)).id)
    }

    expect(await issuedCountOf(coupon.id)).toBe(3)
  })

  it('잔여 1장에 **동시에** 들어오면 한 명만 받는다 (F6 · A7)', async () => {
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: 1, withCode: true })
    const results = await raceToClaim(coupon.id, coupon.code ?? '')

    expect(fulfilled(results)).toHaveLength(1)
    expect(await issuedCountOf(coupon.id)).toBe(1)
    // 캐시와 행이 어긋나지 않았다. 「한 명만 통과했다」는 결과일 뿐이고, 지켜진
    // 것은 **발급 수가 한도를 넘지 않았다**는 쪽이다.
    expect(await issuedRowsOf(coupon.id)).toBe(1)

    // 진 쪽은 전부 같은 이유로 졌다 — 조건부 갱신이 0행으로 끝난 자리다.
    const codes = rejected(results).map((reason) => failureOf(reason).code)

    expect(new Set(codes)).toEqual(new Set(['COUPON_ISSUE_EXHAUSTED']))
  })

  it('자리가 남아 있으면 동시에 들어와도 전부 받는다', async () => {
    // **통제군이다.** 위 검사만 있으면 「무조건 하나만 통과시키는」 구현 — 예컨대
    // 전부 직렬화해 놓고 첫 건 말고 거절하는 코드 — 도 초록이고, 그때 재고 있는
    // 쿠폰이 아무에게도 나가지 않는다.
    const { coupon } = await issueCoupon(callers.operator, {
      issueLimit: RACE_PARTIES,
      withCode: true,
    })
    const results = await raceToClaim(coupon.id, coupon.code ?? '')

    expect(fulfilled(results)).toHaveLength(RACE_PARTIES)
    expect(await issuedCountOf(coupon.id)).toBe(RACE_PARTIES)
    expect(await issuedRowsOf(coupon.id)).toBe(RACE_PARTIES)
  })

  it('마지막 방어선은 DB 다 — 넘긴 수량을 날 SQL 로도 쓸 수 없다 (S5)', async () => {
    // 조건부 갱신이 이기는 한 이 CHECK 는 발동하지 않는다. 그래도 두는 이유는,
    // 언젠가 이 자리가 「읽고 판단하고 쓰는」 모양으로 고쳐 쓰이는 날 초과 발급을
    // 거절하는 것이 하나도 남지 않게 되기 때문이다.
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: 1 })

    const message = await refusedBySql(
      `UPDATE "Coupon" SET "issuedCount" = 2, "updatedAt" = now() WHERE "id" = $1`,
      [coupon.id],
    )

    expect(message).toContain('Coupon_issued_count_check')
  })

  it('한도까지는 DB 도 통과시킨다', async () => {
    // 통제군.
    const { coupon } = await issueCoupon(callers.operator, { issueLimit: 3 })

    await expect(
      db.execute(`UPDATE "Coupon" SET "issuedCount" = 3, "updatedAt" = now() WHERE "id" = $1`, [
        coupon.id,
      ]),
    ).resolves.toBe(1)
  })
})

// ------------------------------------------------------------------ 코드 발급

describe('코드 발급 (F8)', () => {
  it('코드를 붙여 발행하면 저장 가능한 모양이 돌아온다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { withCode: true })

    expect(coupon.code).toMatch(COUPON_CODE_PATTERN)
  })

  it('코드가 없는 쿠폰도 있다 — 지급으로만 나간다', async () => {
    const { coupon } = await issueCoupon(callers.operator, {})

    expect(coupon.code).toBeNull()
  })

  it('두 쿠폰의 코드가 겹치지 않는다', async () => {
    const codes = new Set<string>()

    for (let index = 0; index < 5; index += 1) {
      const { coupon } = await issueCoupon(callers.operator, { withCode: true })

      codes.add(coupon.code ?? '')
    }

    expect(codes.size).toBe(5)
  })

  it('본인이 코드를 넣으면 자기 쿠폰함에 들어온다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { withCode: true })
    const { userCoupon } = await claim(buyer, coupon.code ?? '')

    expect(userCoupon.userId).toBe(buyer.userId)
    expect(userCoupon.couponId).toBe(coupon.id)
  })

  it('보여 준 모양 그대로, 소문자로 넣어도 받는다', async () => {
    // 배너를 보고 옮겨 적는 사람을 위한 것이다. 「잘못된 코드입니다」로 끝나는
    // 화면은 무엇이 틀렸는지 말해 주지 않는다.
    const { coupon } = await issueCoupon(callers.operator, { withCode: true })
    const typed = formatCouponCode(coupon.code ?? '').toLowerCase()

    await expect(claim(buyer, typed)).resolves.toMatchObject({
      userCoupon: { couponId: coupon.id },
    })
  })

  it('없는 코드와 형식이 틀린 코드가 같은 답을 받는다', async () => {
    // 갈라 답하면 코드를 찍어 보는 쪽에 「형식은 맞다」는 힌트가 되고, 그 힌트가
    // 탐색 공간을 좁힌다.
    const unknown = await failure(claim(buyer, '0123456789'))
    const malformed = await failure(claim(buyer, '!!!'))

    expect(unknown).toMatchObject({ status: 400, code: 'COUPON_CODE_UNKNOWN' })
    expect(malformed.code).toBe(unknown.code)
    expect(malformed.status).toBe(unknown.status)
  })

  it('시작 전이면 거절한다 — 기다리면 되는 거절이다', async () => {
    const { coupon } = await issueCoupon(callers.operator, {
      withCode: true,
      validFrom: '2026-09-10T00:00:00.000Z',
      validUntil: '2026-09-20T00:00:00.000Z',
    })
    const failed = await failure(claim(buyer, coupon.code ?? ''))

    expect(failed).toMatchObject({ status: 409, code: 'COUPON_NOT_STARTED' })
  })

  it('기간이 끝났으면 다른 코드로 거절한다 — 기다려도 안 되는 거절이다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { withCode: true })

    api.clock.set(VALID_UNTIL)

    const failed = await failure(claim(buyer, coupon.code ?? ''))

    expect(failed).toMatchObject({ status: 409, code: 'COUPON_ENDED' })
  })

  it('끝난 쿠폰은 자리를 태우지 않는다', async () => {
    const { coupon } = await issueCoupon(callers.operator, { withCode: true, issueLimit: 1 })

    api.clock.set(VALID_UNTIL)
    await failure(claim(buyer, coupon.code ?? ''))

    expect(await issuedCountOf(coupon.id)).toBe(0)
  })
})

/** 정책 행이 세고 있는 발급 수. */
async function issuedCountOf(couponId: string): Promise<number> {
  const row = await db.one<{ issuedCount: number }>(
    `SELECT "issuedCount" FROM "Coupon" WHERE "id" = $1`,
    [couponId],
  )

  return row.issuedCount
}

/** 실제로 만들어진 발급 행의 수. 캐시와 어긋나면 그것이 실패다. */
async function issuedRowsOf(couponId: string): Promise<number> {
  const row = await db.one<{ count: number }>(
    `SELECT count(*)::int AS "count" FROM "UserCoupon" WHERE "couponId" = $1`,
    [couponId],
  )

  return row.count
}

/**
 * 동시에 들어오는 발급의 수.
 *
 * **시험용 앱의 풀이 5이기 때문이다** (`test/support/app-config.ts`). 여섯 번째
 * 요청은 커넥션을 기다리느라 아예 잠금 대기에 서지 못하고, 그러면 「전부 겹쳤다」가
 * 거짓이 된다 — `payments.integration.spec.ts` 가 같은 이유로 둘을 쓴다.
 */
const RACE_PARTIES = 5

/**
 * 겹쳤다고 인정하는 최소 인원.
 *
 * 다섯 전부를 기다리지 않는다. **둘이 겹치면 이미 재려던 것은 재어진다** — 「각자
 * 「아직 남았다」를 읽고 둘 다 통과하는」 구현은 둘만으로도 두 장을 내보낸다.
 * 다섯을 요구하면 이 스펙이 커넥션 풀 크기와 스케줄러의 운에 인질로 잡히고, 그때
 * 실패는 구현이 아니라 하네스에 대한 것이 된다.
 */
const OVERLAP_REQUIRED = 2

/** 겹침을 기다리는 상한. 넘으면 배열에 실패한 것이므로 그 사실이 실패다. */
const BLOCKED_ATTEMPTS = 300

/**
 * {@link RACE_PARTIES} 명이 **실제로 겹친 채로** 같은 코드를 넣는다.
 *
 * **장벽만으로는 부족하다** (`concurrently.ts` 의 주석). 장벽은 전원이 도착할
 * 때까지 붙잡아 두지만, 그 다음 다섯 건이 차례로 지나간 실행에서도 「하나만
 * 통과했다」는 초록이다 — 즉 「읽고 · 판단하고 · 쓰는」 깨진 구현에서도 통과한다.
 * 실제로 그렇다는 것을 이 스펙을 쓰면서 확인했다: 조건부 갱신을 읽기-쓰기로
 * 바꿔 놓아도 장벽만 있는 판은 초록이었다.
 *
 * 그래서 바깥 커넥션이 쿠폰 행을 먼저 잠근다. 다섯 건은 각자 자기 판단을 마친 뒤
 * 갱신에서 **전부 멈추고**, 데이터베이스가 「다섯이 잠금을 기다리고 있다」고 말해
 * 준 뒤에야 바깥이 커밋한다. 겹침은 바란 것이 아니라 배열된 것이 된다.
 */
async function raceToClaim(
  couponId: string,
  code: string,
): Promise<PromiseSettledResult<UserCouponResponse>[]> {
  const claimants = await Promise.all(
    Array.from({ length: RACE_PARTIES }, async () => ({
      userId: (await createUser(db)).id,
      roles: ['BUYER'] as const,
    })),
  )
  const gate = barrier(RACE_PARTIES)

  return db.withConnection(async (blocker) => {
    await blocker.query('BEGIN')
    await blocker.query('SELECT "id" FROM "Coupon" WHERE "id" = $1 FOR UPDATE', [couponId])

    const pending = concurrently(RACE_PARTIES, async (index) => {
      await gate.arrive()

      return claim({ userId: claimants[index]?.userId ?? '', roles: ['BUYER'] }, code)
    })

    try {
      await awaitAllBlockedOnCoupon()
    } finally {
      await blocker.query('COMMIT')
    }

    return pending
  })
}

/** 적어도 {@link OVERLAP_REQUIRED} 건이 쿠폰 행의 잠금을 기다릴 때까지. */
async function awaitAllBlockedOnCoupon(): Promise<void> {
  for (let attempt = 0; attempt < BLOCKED_ATTEMPTS; attempt += 1) {
    const row = await db.one<{ waiting: number }>(
      `SELECT count(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query LIKE '%UPDATE "Coupon"%'`,
    )

    if (row.waiting >= OVERLAP_REQUIRED) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('발급 요청들이 잠금 대기 상태가 되지 않았습니다 — 겹침이 배열되지 않았습니다.')
}
