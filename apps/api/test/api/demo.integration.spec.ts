import type { AppId, DemoRole } from '@shopping/shared'
import {
  APP_ID_HEADER,
  DEMO_ACCOUNT_TTL_HOURS,
  DEMO_ISSUE_LIMIT,
  demoIssueResponseSchema,
  demoStatusResponseSchema,
  sellerResponseSchema,
  sessionResponseSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { DEMO_PENDING_APPLICATIONS } from '../../src/demo/demo-seed.service.js'
import { useApiApp } from '../support/api-app.js'
import { DEFAULT_TEST_INSTANT } from '../support/clock.js'
import { parseSetCookie } from '../support/cookie-jar.js'
import { useDatabase } from '../support/database.js'
import {
  createCategory,
  createProduct,
  createProductOption,
  createProductOptionValue,
  createProductVariant,
  createSeller,
  createUser,
  mapVariantOptionValue,
} from '../support/factories.js'

/**
 * Demo issuing over real HTTP, against this worker's real database (TASK-0024).
 *
 * **Authentication is the real one.** The harness is not asked for
 * `authenticate: true`, so the application binds `AccessTokenPrincipalResolver`
 * exactly as it is deployed and the only way into `GET /auth/demo` is a token
 * this flow actually produced. That is what makes F3b — a demo administrator
 * approving the application they were issued — a proof rather than an
 * arrangement: nothing here can call as a role it was not given.
 *
 * Every body goes through the schema `@shopping/shared` declares, so gate C3
 * holds whether or not an assertion mentions a field. Raw `fetch` rather than
 * `ApiClient` because half of these assertions are about the `Set-Cookie`
 * header, which a parsed body cannot see (the shape `session.integration.spec.ts`
 * settled on).
 */

const db = useDatabase()
const api = useApiApp({ database: db })

const ISSUED_AT = new Date(DEFAULT_TEST_INSTANT)
const EXPECTED_EXPIRY = new Date(
  ISSUED_AT.getTime() + DEMO_ACCOUNT_TTL_HOURS * 60 * 60 * 1000,
).toISOString()

interface CallOptions {
  readonly ip?: string
  readonly cookie?: string
}

function post(
  path: string,
  app: AppId,
  body: unknown,
  options: CallOptions = {},
): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [APP_ID_HEADER]: app,
      ...(options.ip === undefined ? {} : { 'x-forwarded-for': options.ip }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    body: JSON.stringify(body),
  })
}

function issue(role: DemoRole, app: AppId, options: CallOptions = {}): Promise<Response> {
  return post('/auth/demo', app, { role }, options)
}

/** The refresh cookie a successful issue sets, as `name=value`. */
function refreshCookieOf(response: Response): string {
  const [header] = response.headers.getSetCookie()
  const cookie = parseSetCookie(header ?? '')

  if (cookie === null) throw new Error('발급 응답에 refresh 쿠키가 없습니다.')

  return `${cookie.name}=${cookie.value}`
}

/**
 * Issues an account and completes the sign-in the way an app does.
 *
 * The issue response carries no access token on purpose (TASK-0024 4.1), so the
 * second call is not a convenience — it is the flow.
 */
async function signInAsDemo(
  role: DemoRole,
  app: AppId,
  options: CallOptions = {},
): Promise<{ readonly accessToken: string; readonly userId: string; readonly cookie: string }> {
  const issued = await issue(role, app, options)

  expect(issued.status).toBe(200)

  const cookie = refreshCookieOf(issued)
  const renewed = await post('/auth/refresh', app, undefined, { ...options, cookie })

  expect(renewed.status).toBe(200)

  const session = sessionResponseSchema.parse(await renewed.json())

  return { accessToken: session.accessToken, userId: session.user.id, cookie }
}

function authorised(path: string, accessToken: string, app: AppId): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, [APP_ID_HEADER]: app },
  })
}

async function rolesOf(userId: string): Promise<readonly string[]> {
  const rows = await db.query<{ role: string }>(
    'SELECT "role"::text AS "role" FROM "UserRole" WHERE "userId" = $1 ORDER BY "role"',
    [userId],
  )

  return rows.map((row) => row.role)
}

/** A live listing of a real store, with two variants over one axis. */
async function seedPublicCatalogue(count: number): Promise<void> {
  const category = await createCategory(db)

  for (let index = 0; index < count; index += 1) {
    const owner = await createUser(db)
    const seller = await createSeller(db, { userId: owner.id })
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId: category.id,
      name: `원본 상품 ${String(index)}`,
      status: 'ACTIVE',
      minPrice: 12_000,
    })
    const option = await createProductOption(db, { productId: product.id, name: '색상' })
    const black = await createProductOptionValue(db, { optionId: option.id, value: '블랙' })
    const white = await createProductOptionValue(db, { optionId: option.id, value: '화이트' })

    // The same SKU in every source store, so the copy has to tell them apart.
    for (const [position, value] of [black, white].entries()) {
      const variant = await createProductVariant(db, {
        productId: product.id,
        sellerId: seller.id,
        sku: `SHARED-SKU-${String(position)}`,
        price: 12_000 + position * 1_000,
        stock: 7,
        optionSignature: value.id,
      })

      await mapVariantOptionValue(db, {
        variantId: variant.id,
        optionValueId: value.id,
        optionId: option.id,
        productId: product.id,
      })
    }
  }
}

describe('POST /auth/demo — 구매자', () => {
  it('발급 즉시 로그인할 수 있는 계정과 기본 데이터를 만든다', async () => {
    const response = await issue('BUYER', 'shop', { ip: '203.0.113.10' })

    expect(response.status).toBe(200)

    const body = demoIssueResponseSchema.parse(await response.json())

    expect(body.demo).toEqual({ role: 'BUYER', expiresAt: EXPECTED_EXPIRY })

    const [cookie] = response.headers.getSetCookie()
    const parsed = parseSetCookie(cookie ?? '')

    expect(parsed?.name).toBe('shopping_refresh_shop')
    expect(parsed?.attributes).toMatchObject({ httponly: '', path: '/api/v1/auth' })

    // F9: the pair `User_demo_expiry_check` holds, and no Google identity — the
    // case `User_google_identity_check` exempts by the flag.
    //
    // The expiry is compared **in SQL**. `demoExpiresAt` is a `timestamp`
    // without a zone, so `pg` hands it back as a local-time `Date` and an
    // assertion in TypeScript would be off by whatever offset the machine
    // happens to run in — green in UTC, red in KST, and about nothing.
    const [user] = await db.query<{
      id: string
      isDemo: boolean
      livesForADay: boolean
      googleSub: string | null
    }>(
      `SELECT "id", "isDemo", "googleSub",
              ("demoExpiresAt" - "createdAt") = make_interval(hours => $1) AS "livesForADay"
         FROM "User"`,
      [DEMO_ACCOUNT_TTL_HOURS],
    )

    expect(user?.isDemo).toBe(true)
    expect(user?.livesForADay).toBe(true)
    expect(user?.googleSub).toBeNull()

    expect(await rolesOf(user?.id ?? '')).toEqual(['BUYER'])

    const [address] = await db.query<{ isDefault: boolean }>('SELECT "isDefault" FROM "Address"')
    const preferences = await db.query('SELECT 1 FROM "UserPreference"')

    expect(address?.isDefault).toBe(true)
    expect(preferences).toHaveLength(1)
  })
})

describe('POST /auth/demo — 판매자', () => {
  it('승인된 스토어와 복제한 카탈로그를 함께 만든다', async () => {
    await seedPublicCatalogue(3)

    const { userId } = await signInAsDemo('SELLER', 'seller', { ip: '203.0.113.11' })

    expect(await rolesOf(userId)).toEqual(['SELLER_OWNER'])

    const [store] = await db.query<{ id: string; status: string }>(
      'SELECT "id", "status"::text AS "status" FROM "Seller" WHERE "userId" = $1',
      [userId],
    )

    expect(store?.status).toBe('ACTIVE')

    const copies = await db.query<{ id: string; name: string }>(
      'SELECT "id", "name" FROM "Product" WHERE "sellerId" = $1',
      [store?.id],
    )

    expect(copies).toHaveLength(3)

    // F2b: the copy is a whole listing, not a name — options, values, variants,
    // their mappings and the opening balance all came with it.
    const [counts] = await db.query<{
      options: number
      values: number
      variants: number
      mappings: number
      ledger: number
      inStock: number
    }>(
      `SELECT (SELECT count(*)::int FROM "ProductOption" o
                WHERE o."productId" = ANY($1::uuid[]))                     AS "options",
              (SELECT count(*)::int FROM "ProductOptionValue" v
                JOIN "ProductOption" o ON o."id" = v."optionId"
               WHERE o."productId" = ANY($1::uuid[]))                      AS "values",
              (SELECT count(*)::int FROM "ProductVariant" pv
                WHERE pv."productId" = ANY($1::uuid[]))                    AS "variants",
              (SELECT count(*)::int FROM "VariantOptionValue" m
                WHERE m."productId" = ANY($1::uuid[]))                     AS "mappings",
              (SELECT count(*)::int FROM "StockLedger" l
                JOIN "ProductVariant" pv ON pv."id" = l."variantId"
               WHERE pv."productId" = ANY($1::uuid[]))                     AS "ledger",
              (SELECT COALESCE(sum(pv."stock"), 0)::int FROM "ProductVariant" pv
                WHERE pv."productId" = ANY($1::uuid[]))                    AS "inStock"`,
      [copies.map((row) => row.id)],
    )

    expect(counts).toMatchObject({
      options: 3,
      values: 6,
      variants: 6,
      mappings: 6,
      ledger: 6,
      inStock: 42,
    })

    // L1 of the ledger (TASK-0036 4.1): the stock is the sum of the movements.
    const [reconciled] = await db.query<{ broken: number }>(
      `SELECT count(*)::int AS "broken"
         FROM "ProductVariant" pv
         LEFT JOIN LATERAL (SELECT COALESCE(sum(l."quantity"), 0) AS moved
                              FROM "StockLedger" l WHERE l."variantId" = pv."id") m ON TRUE
        WHERE pv."productId" = ANY($1::uuid[]) AND pv."stock" <> m.moved`,
      [copies.map((row) => row.id)],
    )

    expect(reconciled?.broken).toBe(0)

    // The three sources all used `SHARED-SKU-0`; inside one store that is one
    // index violation, so the copy has to have renamed the collisions.
    const skus = await db.query<{ sku: string }>(
      'SELECT "sku" FROM "ProductVariant" WHERE "sellerId" = $1',
      [store?.id],
    )

    expect(new Set(skus.map((row) => row.sku)).size).toBe(skus.length)
  })

  it('복제할 원본이 없어도 발급은 성공하고 빈 스토어가 열린다', async () => {
    const { userId } = await signInAsDemo('SELLER', 'seller', { ip: '203.0.113.12' })

    const [store] = await db.query<{ id: string; status: string }>(
      'SELECT "id", "status"::text AS "status" FROM "Seller" WHERE "userId" = $1',
      [userId],
    )

    expect(store?.status).toBe('ACTIVE')
    expect(await db.query('SELECT 1 FROM "Product"')).toHaveLength(0)
  })

  it('다른 데모의 상품은 복제하지 않는다', async () => {
    await seedPublicCatalogue(1)
    await signInAsDemo('SELLER', 'seller', { ip: '203.0.113.13' })
    const second = await signInAsDemo('SELLER', 'seller', { ip: '203.0.113.14' })

    const [store] = await db.query<{ id: string }>(
      'SELECT "id" FROM "Seller" WHERE "userId" = $1',
      [second.userId],
    )
    const copies = await db.query('SELECT 1 FROM "Product" WHERE "sellerId" = $1', [store?.id])

    // One original, one copy each — never the first demo's copy as well.
    expect(copies).toHaveLength(1)
  })
})

describe('POST /auth/demo — 관리자', () => {
  it('처리할 수 있는 심사 대기 신청과 함께 발급된다', async () => {
    const { userId, accessToken } = await signInAsDemo('ADMIN', 'admin', { ip: '203.0.113.20' })

    expect(await rolesOf(userId)).toEqual(['DEMO_ADMIN'])

    const waiting = await db.query<{ id: string; version: number }>(
      `SELECT s."id", s."version" FROM "Seller" s
         JOIN "User" u ON u."id" = s."userId"
        WHERE s."status" = 'PENDING' AND u."demoExpiresAt" IS NOT NULL`,
    )

    expect(waiting).toHaveLength(DEMO_PENDING_APPLICATIONS)

    // F3b: the button the console shows actually works for this caller.
    const approved = await fetch(
      `${api.baseUrl}/api/v1/admin/sellers/${waiting[0]?.id ?? ''}/approve`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
          [APP_ID_HEADER]: 'admin',
        },
        body: JSON.stringify({ version: waiting[0]?.version ?? 0 }),
      },
    )

    expect(approved.status).toBe(200)
    expect(sellerResponseSchema.parse(await approved.json()).seller.status).toBe('ACTIVE')
  })

  it('실계정의 신청은 같은 토큰으로도 승인하지 못한다', async () => {
    const { accessToken } = await signInAsDemo('ADMIN', 'admin', { ip: '203.0.113.21' })
    const applicant = await createUser(db)
    const real = await createSeller(db, { userId: applicant.id, status: 'PENDING' })

    const refused = await fetch(`${api.baseUrl}/api/v1/admin/sellers/${real.id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        [APP_ID_HEADER]: 'admin',
      },
      body: JSON.stringify({ version: 0 }),
    })

    // F4: `demo` scope, and the reason names the permission rather than the row.
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain('seller.approve')
  })

  it('다른 데모가 만든 신청도 처리할 수 있다', async () => {
    // Two administrators, issued separately. The second decides an application
    // the first one's issue created — so this is demo-to-demo across accounts,
    // not an account reaching its own rows.
    const first = await signInAsDemo('ADMIN', 'admin', { ip: '203.0.113.22' })
    const second = await signInAsDemo('ADMIN', 'admin', { ip: '203.0.113.23' })

    expect(first.userId).not.toBe(second.userId)

    const [waiting] = await db.query<{ id: string; version: number }>(
      `SELECT s."id", s."version" FROM "Seller" s
         JOIN "User" u ON u."id" = s."userId"
        WHERE s."status" = 'PENDING' AND u."demoExpiresAt" IS NOT NULL
        ORDER BY s."id" LIMIT 1`,
    )

    const rejected = await fetch(
      `${api.baseUrl}/api/v1/admin/sellers/${waiting?.id ?? ''}/reject`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${second.accessToken}`,
          [APP_ID_HEADER]: 'admin',
        },
        body: JSON.stringify({ version: waiting?.version ?? 0, reason: '체험용 반려입니다.' }),
      },
    )

    // D-058 · R3: the `demo` scope protects real accounts, it does not isolate
    // demos from each other.
    expect(rejected.status).toBe(200)
    expect(sellerResponseSchema.parse(await rejected.json()).seller.status).toBe('REJECTED')
  })
})

describe('POST /auth/demo — 앱과 역할의 짝', () => {
  it('앱이 발급할 수 없는 역할을 거절한다', async () => {
    const response = await issue('ADMIN', 'shop')

    expect(response.status).toBe(400)

    const body = (await response.json()) as { error: { details: { field: string }[] } }

    expect(body.error.details[0]?.field).toBe('role')
    expect(await db.query('SELECT 1 FROM "User"')).toHaveLength(0)
  })

  it('앱 헤더가 없으면 거절한다', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/auth/demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'BUYER' }),
    })

    expect(response.status).toBe(400)
  })

  it('역할이 목록에 없으면 거절한다', async () => {
    const response = await post('/auth/demo', 'shop', { role: 'SUPERUSER' })

    expect(response.status).toBe(400)
  })
})

describe('POST /auth/demo — 남용 방지', () => {
  it('한 주소의 발급을 창 안에서 제한한다', async () => {
    const attempts = 10
    const statuses: number[] = []

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await issue('BUYER', 'shop', { ip: '198.51.100.1' })

      statuses.push(response.status)
      await response.text()
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(DEMO_ISSUE_LIMIT)
    expect(statuses.filter((status) => status === 429)).toHaveLength(attempts - DEMO_ISSUE_LIMIT)
    expect(await db.query('SELECT 1 FROM "User"')).toHaveLength(DEMO_ISSUE_LIMIT)
  })

  it('다른 주소는 막히지 않는다', async () => {
    for (let attempt = 0; attempt < DEMO_ISSUE_LIMIT; attempt += 1) {
      await (await issue('BUYER', 'shop', { ip: '198.51.100.2' })).text()
    }

    const blocked = await issue('BUYER', 'shop', { ip: '198.51.100.2' })
    const allowed = await issue('BUYER', 'shop', { ip: '198.51.100.3' })

    expect(blocked.status).toBe(429)
    expect(allowed.status).toBe(200)
  })

  it('창이 지나면 다시 발급된다', async () => {
    for (let attempt = 0; attempt < DEMO_ISSUE_LIMIT; attempt += 1) {
      await (await issue('BUYER', 'shop', { ip: '198.51.100.4' })).text()
    }

    expect((await issue('BUYER', 'shop', { ip: '198.51.100.4' })).status).toBe(429)

    // The window is measured against the row's `createdAt`, which the clock
    // wrote — so moving the clock is the whole of "a minute later".
    api.clock.advance(61_000)

    expect((await issue('BUYER', 'shop', { ip: '198.51.100.4' })).status).toBe(200)
    api.clock.set(DEFAULT_TEST_INSTANT)
  })
})

describe('GET /auth/demo', () => {
  it('데모 계정에는 남은 시간을 답한다', async () => {
    const { accessToken } = await signInAsDemo('BUYER', 'shop', { ip: '203.0.113.30' })
    const response = await authorised('/auth/demo', accessToken, 'shop')

    expect(response.status).toBe(200)
    expect(demoStatusResponseSchema.parse(await response.json())).toEqual({
      demo: { role: 'BUYER', expiresAt: EXPECTED_EXPIRY },
    })
  })

  it('판매자 데모의 역할을 되읽는다', async () => {
    const { accessToken } = await signInAsDemo('SELLER', 'seller', { ip: '203.0.113.31' })
    const response = await authorised('/auth/demo', accessToken, 'seller')

    expect(demoStatusResponseSchema.parse(await response.json()).demo?.role).toBe('SELLER')
  })

  it('토큰이 없으면 401 이다', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/auth/demo`, {
      headers: { [APP_ID_HEADER]: 'shop' },
    })

    expect(response.status).toBe(401)
  })
})
