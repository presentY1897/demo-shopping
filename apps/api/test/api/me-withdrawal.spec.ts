import type { AppId } from '@shopping/shared'
import {
  addressListResponseSchema,
  addressResponseSchema,
  profileResponseSchema,
  sessionResponseSchema,
  withdrawalResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { GOOGLE_OAUTH } from '../../src/auth/google-oauth.client.js'
import { OAUTH_STATE_COOKIE } from '../../src/auth/oauth-state.js'
import { refreshCookieName } from '../../src/auth/session-cookie.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createStockLedgerEntry } from '../support/factories.js'
import { A_GOOGLE_PROFILE, createFakeGoogle } from '../support/google-oauth.js'

/**
 * Withdrawal, end to end (TASK-0111 F5 · F8).
 *
 * **Every session here starts the way a real one does** — through the Google
 * callback and a first refresh — and the access token that calls `DELETE /me` is
 * a real signed JWT verified by the resolver that ships. No principal is
 * injected by a header in this file: withdrawal is the one action that has to be
 * proved against the actual authentication path, because what it must end *is*
 * a session.
 *
 * Only Google is replaced, through the `GOOGLE_OAUTH` port (QUALITY-GATES 6장).
 */

const db = useDatabase()
const google = createFakeGoogle()
const api = useApiApp({
  database: db,
  overrides: [{ token: GOOGLE_OAUTH, value: google }],
})

interface Signed {
  /** The `name=value` pair a browser would send back. */
  readonly cookie: string
  readonly accessToken: string
  readonly userId: string
}

function cookieFrom(setCookie: readonly string[], name: string): string | undefined {
  return setCookie
    .map((header) => new RegExp(`(?:^|; )(${name}=[^;]*)`).exec(header)?.[1])
    .find((value) => value !== undefined && !value.endsWith('='))
}

/** Plants a refresh cookie the way the OAuth callback does. */
async function planted(app: AppId): Promise<string> {
  const started = await fetch(`${api.baseUrl}/api/v1/auth/google?app=${app}`, {
    redirect: 'manual',
  })
  const state = new URL(started.headers.get('location') ?? '').searchParams.get('state') ?? ''
  const stateCookie = /shopping_oauth_state=([^;]*)/.exec(
    started.headers.get('set-cookie') ?? '',
  )?.[1]

  const landed = await fetch(
    `${api.baseUrl}/api/v1/auth/google/callback?state=${state}&code=authorization-code`,
    { redirect: 'manual', headers: { cookie: `${OAUTH_STATE_COOKIE}=${stateCookie ?? ''}` } },
  )

  const refresh = cookieFrom(landed.headers.getSetCookie(), refreshCookieName(app))
  if (refresh === undefined) throw new Error(`${app} refresh 쿠키가 심어지지 않았습니다.`)

  return refresh
}

function callRefresh(app: AppId, cookie: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'X-App-Id': app, cookie },
  })
}

/** The whole round trip: sign in, then trade the cookie for an access token. */
async function signIn(app: AppId = 'shop'): Promise<Signed> {
  const plantedCookie = await planted(app)
  const response = await callRefresh(app, plantedCookie)

  if (!response.ok) throw new Error(`갱신이 ${String(response.status)} 로 실패했습니다.`)

  const body = sessionResponseSchema.parse(await response.json())
  const rotated = cookieFrom(response.headers.getSetCookie(), refreshCookieName(app))

  return { cookie: rotated ?? plantedCookie, accessToken: body.accessToken, userId: body.user.id }
}

/** A call carrying the real bearer token, the way an app makes one. */
function callAs(
  session: Signed,
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-App-Id': 'shop',
      Authorization: `Bearer ${session.accessToken}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

async function saveAddress(session: Signed, label: string): Promise<void> {
  const response = await callAs(session, '/me/addresses', {
    method: 'POST',
    body: {
      label,
      recipientName: '김수령',
      phone: '010-1234-5678',
      postalCode: '06234',
      addressLine1: '서울시 강남구 테헤란로 1',
    },
  })

  expect(response.status).toBe(201)
  addressResponseSchema.parse(await response.json())
}

function accountRow(userId: string): Promise<{ deletedAt: Date | null; googleSub: string | null }> {
  return db.one<{ deletedAt: Date | null; googleSub: string | null }>(
    'SELECT "deletedAt", "googleSub" FROM "User" WHERE "id" = $1',
    [userId],
  )
}

function addressCount(userId: string): Promise<number> {
  return db
    .one<{ count: number }>('SELECT count(*)::int AS count FROM "Address" WHERE "userId" = $1', [
      userId,
    ])
    .then((row) => row.count)
}

function liveTokenCount(userId: string): Promise<number> {
  return db
    .one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "RefreshToken" WHERE "userId" = $1 AND "revokedAt" IS NULL',
      [userId],
    )
    .then((row) => row.count)
}

beforeEach(() => {
  google.reset()
})

describe('탈퇴 (F5)', () => {
  it('배송지는 사라지고 계정 행은 남는다', async () => {
    const session = await signIn()
    await saveAddress(session, '집')
    await saveAddress(session, '회사')

    const response = await callAs(session, '/me', { method: 'DELETE' })
    expect(response.status).toBe(200)

    const body = withdrawalResponseSchema.parse(await response.json())
    expect(body.userId).toBe(session.userId)
    expect(body.deletedAddresses).toBe(2)
    expect(body.revokedSessions).toBeGreaterThanOrEqual(1)

    // Hard delete: the exception to the soft-delete rule, because an order
    // snapshots its recipient and the personal data here has to be removable.
    expect(await addressCount(session.userId)).toBe(0)

    // The account itself is a tombstone, not a hole: history points at it.
    const account = await accountRow(session.userId)
    expect(account.deletedAt).not.toBeNull()
  })

  it('탈퇴한 계정을 참조하는 이력 행은 그대로 남는다', async () => {
    // `Order` arrives in M07; the edge that exists today is
    // `StockLedger.actorId`, and it is `onDelete: Restrict` for exactly this
    // reason — a hard delete would either be refused or take history with it.
    const session = await signIn()
    const { variant } = await createSellableVariant(db)
    await createStockLedgerEntry(db, { variantId: variant.id, actorId: session.userId })

    await callAs(session, '/me', { method: 'DELETE' })

    const { count } = await db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "StockLedger" WHERE "actorId" = $1',
      [session.userId],
    )
    expect(count).toBe(1)
  })

  it('googleSub 는 지우지 않지만 부분 인덱스가 신원을 놓아 준다', async () => {
    const first = await signIn()
    await callAs(first, '/me', { method: 'DELETE' })

    // Not scrubbed — that is TASK-0025's destruction schedule.
    expect((await accountRow(first.userId)).googleSub).toBe(A_GOOGLE_PROFILE.sub)

    // …and yet the same person can sign up again, because
    // `User_googleSub_active_key` only indexes rows with `deletedAt IS NULL`.
    const second = await signIn()

    expect(second.userId).not.toBe(first.userId)
    expect((await accountRow(second.userId)).deletedAt).toBeNull()
  })

  it('탈퇴한 계정의 access 토큰은 더 이상 통하지 않는다', async () => {
    const session = await signIn()
    await callAs(session, '/me', { method: 'DELETE' })

    // The token is still signed and unexpired — nothing revokes a JWT. What
    // stops it is that every `/me` handler resolves a live account first.
    const answered = await callAs(session, '/me')
    expect(answered.status).toBe(404)

    const listed = await callAs(session, '/me/addresses')
    expect(listed.status).toBe(404)
  })

  it('두 번째 탈퇴는 404 다', async () => {
    const session = await signIn()

    expect((await callAs(session, '/me', { method: 'DELETE' })).status).toBe(200)
    expect((await callAs(session, '/me', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('탈퇴 후 세션 (F8)', () => {
  it('기존 refresh 토큰으로 갱신하면 401 이다', async () => {
    const session = await signIn()

    expect(await liveTokenCount(session.userId)).toBe(1)

    await callAs(session, '/me', { method: 'DELETE' })

    expect(await liveTokenCount(session.userId)).toBe(0)

    const renewed = await callRefresh('shop', session.cookie)
    expect(renewed.status).toBe(401)
  })

  it('다른 앱에 열어 둔 세션도 함께 끊긴다', async () => {
    // Sessions are per app (D-218), but withdrawal is not: the account is gone
    // everywhere at once.
    const shop = await signIn('shop')
    const seller = await signIn('seller')

    expect(shop.userId).toBe(seller.userId)

    await callAs(shop, '/me', { method: 'DELETE' })

    expect((await callRefresh('seller', seller.cookie)).status).toBe(401)
  })
})

describe('탈퇴 전에는 평소처럼 동작한다', () => {
  it('실제 access 토큰으로 프로필과 배송지를 읽는다', async () => {
    // The counterweight to every 404 above: they have to be caused by the
    // withdrawal and not by this file failing to authenticate at all.
    const session = await signIn()
    await saveAddress(session, '집')

    const profile = profileResponseSchema.parse(await (await callAs(session, '/me')).json())
    const addresses = addressListResponseSchema.parse(
      await (await callAs(session, '/me/addresses')).json(),
    )

    expect(profile.profile.id).toBe(session.userId)
    expect(profile.profile.roles).toEqual(['BUYER'])
    expect(addresses.items).toHaveLength(1)
  })
})
