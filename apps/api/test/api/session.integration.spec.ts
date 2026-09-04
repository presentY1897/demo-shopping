import type { AppId } from '@shopping/shared'
import { sessionResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { GOOGLE_OAUTH } from '../../src/auth/google-oauth.client.js'
import { OAUTH_STATE_COOKIE } from '../../src/auth/oauth-state.js'
import { refreshCookieName } from '../../src/auth/session-cookie.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { A_GOOGLE_PROFILE, createFakeGoogle } from '../support/google-oauth.js'

/**
 * Sessions over real HTTP, against this worker's real database (TASK-0022).
 *
 * **Every session here starts the way a real one does** — through the Google
 * callback, which is what plants the refresh cookie (TASK-0021 ⑤). Nothing
 * forges a token or writes a `RefreshToken` row by hand, so what these specs
 * exercise is the whole path a person takes.
 *
 * **The access token is never in a redirect.** The callback hands back only the
 * cookie; the app trades it for an access token on its first `POST
 * /auth/refresh`. So "sign in" below is two calls, exactly as it is in a
 * browser.
 *
 * Only Google is replaced, through the `GOOGLE_OAUTH` port (gate 6장). The
 * database, the HTTP stack, the guard and the resolver are the ones that ship.
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

function cookieFrom(setCookie: string[] | null, name: string): string | undefined {
  const match = (setCookie ?? [])
    .map((header) => new RegExp(`(?:^|; )(${name}=[^;]*)`).exec(header)?.[1])
    .find((value) => value !== undefined && !value.endsWith('='))

  return match
}

function setCookiesOf(response: Response): string[] {
  return response.headers.getSetCookie()
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

  const refresh = cookieFrom(setCookiesOf(landed), refreshCookieName(app))
  if (refresh === undefined) throw new Error(`${app} refresh 쿠키가 심어지지 않았습니다.`)

  return refresh
}

function callRefresh(app: AppId, cookie: string | undefined): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'X-App-Id': app,
      ...(cookie === undefined ? {} : { cookie }),
    },
  })
}

/** The whole round trip: sign in, then trade the cookie for an access token. */
async function signIn(app: AppId): Promise<Signed> {
  const planted_ = await planted(app)
  const response = await callRefresh(app, planted_)

  if (!response.ok) throw new Error(`갱신이 ${String(response.status)} 로 실패했습니다.`)

  // Parsed with the schema the front-ends are typed against: a renamed field
  // fails here whether or not an assertion mentions it (gate C1).
  const body = sessionResponseSchema.parse(await response.json())
  const rotated = cookieFrom(setCookiesOf(response), refreshCookieName(app))

  return { cookie: rotated ?? planted_, accessToken: body.accessToken, userId: body.user.id }
}

function liveTokens(userId: string, app?: string): Promise<{ count: number }> {
  return db.one<{ count: number }>(
    `SELECT count(*)::int AS count FROM "RefreshToken"
      WHERE "userId" = $1 AND "revokedAt" IS NULL
        AND ($2::text IS NULL OR app::text = $2)`,
    [userId, app ?? null],
  )
}

beforeEach(() => {
  google.reset()
})

describe('F11 로그인이 세션을 남긴다', () => {
  it('콜백 응답에 refresh 쿠키가 얹힌다', async () => {
    const cookie = await planted('shop')

    expect(cookie).toContain('shopping_refresh_shop=')
  })

  it('access 토큰은 리다이렉트에 실리지 않는다', async () => {
    // It would land in browser history, in the next request's `Referer` and in
    // every proxy log on the way. The cookie is exchanged for one instead.
    const started = await fetch(`${api.baseUrl}/api/v1/auth/google?app=shop`, {
      redirect: 'manual',
    })
    const state = new URL(started.headers.get('location') ?? '').searchParams.get('state') ?? ''
    const stateCookie = /shopping_oauth_state=([^;]*)/.exec(
      started.headers.get('set-cookie') ?? '',
    )?.[1]

    const landed = await fetch(`${api.baseUrl}/api/v1/auth/google/callback?state=${state}&code=c`, {
      redirect: 'manual',
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${stateCookie ?? ''}` },
    })

    const location = landed.headers.get('location') ?? ''
    expect(location).not.toMatch(/token/i)
    expect(location).not.toContain('.')
  })
})

describe('F5 쿠키 속성', () => {
  it('HttpOnly · SameSite=Lax · Path 이고 Domain 이 없다', async () => {
    const header = setCookiesOf(
      await fetch(`${api.baseUrl}/api/v1/auth/google?app=shop`, { redirect: 'manual' }),
    )
    const planted_ = await planted('seller')

    expect(planted_).toBeDefined()
    expect(header.length).toBeGreaterThan(0)

    const response = await callRefresh('seller', planted_)
    const refresh = setCookiesOf(response).find((value) =>
      value.startsWith(refreshCookieName('seller')),
    )

    expect(refresh).toContain('HttpOnly')
    expect(refresh).toContain('SameSite=Lax')
    expect(refresh).toContain('Path=/api/v1/auth')
    // D-028. A `Domain` would hand the token to every sibling subdomain.
    expect(refresh).not.toContain('Domain')
    // Local development is http; a Secure cookie would simply never be sent.
    expect(refresh).not.toContain('Secure')
  })
})

describe('F1 · F5b 앱별 독립 (D-218)', () => {
  it('세 앱의 쿠키 이름이 다르다', async () => {
    const cookies = await Promise.all([planted('shop'), planted('seller'), planted('admin')])
    const names = cookies.map((cookie) => cookie.split('=')[0])

    expect(new Set(names).size).toBe(3)
  })

  it('shop 로그인은 seller 를 로그인시키지 않는다', async () => {
    // The point of D-218. A single cookie on the shared API origin would make
    // this pass for the wrong reason — the browser would send it to both.
    const shop = await signIn('shop')

    const asSeller = await callRefresh('seller', shop.cookie)

    expect(asSeller.status).toBe(401)
  })

  it('앱을 밝히지 않으면 읽을 쿠키를 고를 수 없다', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/auth/refresh`, { method: 'POST' })

    expect(response.status).toBe(400)
  })
})

describe('F2 · F3 갱신과 회전', () => {
  it('갱신하면 새 access 와 새 refresh 가 온다', async () => {
    const first = await signIn('shop')
    const response = await callRefresh('shop', first.cookie)

    expect(response.status).toBe(200)

    const body = sessionResponseSchema.parse(await response.json())
    const rotated = cookieFrom(setCookiesOf(response), refreshCookieName('shop'))

    expect(rotated).not.toBe(first.cookie)
    expect(body.user.id).toBe(first.userId)
    expect(body.user.roles).toEqual(['BUYER'])
  })

  it('회전할 때마다 이전 것에 revokedAt 이 찍힌다', async () => {
    const signed = await signIn('shop')
    const response = await callRefresh('shop', signed.cookie)
    const rotated = cookieFrom(setCookiesOf(response), refreshCookieName('shop'))

    await callRefresh('shop', rotated)

    const revoked = await db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "RefreshToken" WHERE "userId" = $1 AND "revokedAt" IS NOT NULL',
      [signed.userId],
    )

    // Four rows issued in all — the callback's, plus one per renewal — and the
    // three that were presented are spent. Only the newest is live.
    expect(revoked.count).toBe(3)
    expect((await liveTokens(signed.userId, 'SHOP')).count).toBe(1)
  })
})

describe('F4 재사용 감지', () => {
  it('유예 창 안의 재시도는 세션을 끊지 않는다', async () => {
    const signed = await signIn('shop')
    await callRefresh('shop', signed.cookie)

    // The same cookie again, immediately: two tabs, or one retried request.
    const retry = await callRefresh('shop', signed.cookie)

    expect(retry.status).toBe(200)
    expect((await liveTokens(signed.userId)).count).toBeGreaterThan(0)
  })

  it('유예 창 밖의 재사용은 그 앱의 세션을 전부 끊는다', async () => {
    const signed = await signIn('shop')
    const response = await callRefresh('shop', signed.cookie)
    const rotated = cookieFrom(setCookiesOf(response), refreshCookieName('shop'))

    // Past the window. The clock is the injected one, so no waiting happens.
    api.clock.advance(11_000)

    const replay = await callRefresh('shop', signed.cookie)

    expect(replay.status).toBe(401)
    expect((await liveTokens(signed.userId, 'SHOP')).count).toBe(0)

    // The token the legitimate client held is gone too — that is the point.
    expect((await callRefresh('shop', rotated)).status).toBe(401)
  })

  it('실패한 갱신은 쿠키를 지운다', async () => {
    // Leaving a dead credential in the browser turns one refusal into a loop.
    const response = await callRefresh('shop', 'shopping_refresh_shop=not-a-real-token')

    expect(response.status).toBe(401)
    expect(setCookiesOf(response).some((value) => value.includes('Max-Age=0'))).toBe(true)
  })
})

describe('F6 · F7 로그아웃', () => {
  it('한 앱에서 로그아웃해도 다른 앱은 남는다', async () => {
    const shop = await signIn('shop')
    const seller = await signIn('seller')

    const out = await fetch(`${api.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'X-App-Id': 'shop', cookie: shop.cookie },
    })

    expect(out.status).toBe(204)
    expect((await liveTokens(shop.userId, 'SHOP')).count).toBe(0)
    expect((await liveTokens(seller.userId, 'SELLER')).count).toBeGreaterThan(0)
    expect((await callRefresh('seller', seller.cookie)).status).toBe(200)
  })

  it('전체 로그아웃은 세 앱을 모두 끊는다', async () => {
    const shop = await signIn('shop')
    await signIn('seller')
    await signIn('admin')

    const out = await fetch(`${api.baseUrl}/api/v1/auth/logout-all`, {
      method: 'POST',
      headers: { 'X-App-Id': 'shop', cookie: shop.cookie },
    })

    expect(out.status).toBe(204)
    expect((await liveTokens(shop.userId)).count).toBe(0)
  })

  it('전체 로그아웃에 살아있는 access 토큰이 필요하지 않다', async () => {
    // It is wanted precisely when something has gone wrong, and requiring a
    // fresh access token would refuse it in the window where it matters.
    const shop = await signIn('shop')
    api.clock.advance(16 * 60 * 1000)

    const out = await fetch(`${api.baseUrl}/api/v1/auth/logout-all`, {
      method: 'POST',
      headers: { 'X-App-Id': 'shop', cookie: shop.cookie },
    })

    expect(out.status).toBe(204)
  })
})

describe('F8 저장 형태', () => {
  it('평문 토큰이 어디에도 없다', async () => {
    const signed = await signIn('shop')
    const value = signed.cookie.split('=')[1] ?? ''

    const rows = await db.query<{ tokenHash: string }>(
      'SELECT "tokenHash" FROM "RefreshToken" WHERE "userId" = $1',
      [signed.userId],
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.tokenHash).not.toBe(value)
      // SHA-256, hex.
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('F9 · F10 · F12 리졸버가 실제 토큰을 읽는다', () => {
  /** Guarded by `user.read`, which a BUYER does not hold. */
  function guarded(userId: string, token?: string): Promise<Response> {
    return fetch(`${api.baseUrl}/api/v1/users/${userId}/roles`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    })
  }

  it('공개 엔드포인트는 토큰 없이도 답한다', async () => {
    // The resolver must never answer 401 itself — a signed-out visitor, or one
    // whose browser holds a stale token, still gets the public API.
    expect((await fetch(`${api.baseUrl}/api/v1/health`)).status).toBe(200)
  })

  it('토큰이 없으면 익명이라 401 이다', async () => {
    const signed = await signIn('shop')

    expect((await guarded(signed.userId)).status).toBe(401)
  })

  it('토큰이 있으면 주체가 채워져 자기 것은 읽고 남의 것은 거절된다', async () => {
    const mine = await signIn('shop')

    google.setProfile({ ...A_GOOGLE_PROFILE, sub: 'other-google-sub', email: 'other@example.test' })
    const other = await signIn('shop')

    // Both halves matter, and neither was observable before the resolver was
    // replaced — every guarded call used to be anonymous, so `own` had nothing
    // to resolve against and every one of them answered 401.
    expect((await guarded(mine.userId, mine.accessToken)).status).toBe(200)
    // 403, not 401: the guard knows *who* is calling and refuses on the scope.
    expect((await guarded(other.userId, mine.accessToken)).status).toBe(403)
  })

  it('만료된 access 토큰은 익명으로 떨어진다', async () => {
    const signed = await signIn('shop')
    api.clock.advance(16 * 60 * 1000)

    expect((await guarded(signed.userId, signed.accessToken)).status).toBe(401)
  })

  it('서명이 깨진 토큰도 익명이다', async () => {
    const signed = await signIn('shop')
    const [header, payload] = signed.accessToken.split('.')

    expect((await guarded(signed.userId, `${header}.${payload}.forged`)).status).toBe(401)
  })

  it('alg 를 바꿔도 검증은 그것을 읽지 않는다', async () => {
    // The header is rebuilt here as `{"alg":"none"}` with the signature dropped —
    // the classic forgery. It fails on the signature, because this module never
    // consults the token's `alg` at all (`jwt.ts`).
    const signed = await signIn('shop')
    const payload = signed.accessToken.split('.')[1] ?? ''
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')

    expect((await guarded(signed.userId, `${header}.${payload}.`)).status).toBe(401)
  })
})
