import type { AppId } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { GOOGLE_OAUTH } from '../../src/auth/google-oauth.client.js'
import { OAUTH_STATE_COOKIE } from '../../src/auth/oauth-state.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { A_GOOGLE_PROFILE, createFakeGoogle } from '../support/google-oauth.js'

/**
 * Google sign-in over real HTTP, against this worker's real database (TASK-0021).
 *
 * **The assertions are on redirects, not on response bodies.** This flow never
 * produces one: both endpoints answer 302, because a browser opens them itself
 * and JSON on the screen is what F5 forbids. So the contract under test is the
 * `Location` header and the state cookie — which also means `createApiClient`
 * is the wrong tool here and `fetch` with `redirect: 'manual'` is the right one.
 *
 * **What is real and what is not.** The database is real (gate A6) and so is the
 * HTTP stack, the guard, the middleware and the service. Only Google is
 * replaced, through the `GOOGLE_OAUTH` port, because gate 6장 keeps external
 * systems out of the suite — we cannot make Google fail on demand, and F5 needs
 * exactly that.
 *
 * **Nobody is signed in at the end of any of these.** TASK-0021 stops before the
 * session (its 4장). What these prove is that the account exists and the browser
 * is pointed back at the right app; TASK-0022 adds the `Set-Cookie` that makes
 * it a login.
 */

const db = useDatabase()
const google = createFakeGoogle()
const api = useApiApp({
  database: db,
  overrides: [{ token: GOOGLE_OAUTH, value: google }],
})

/** The three origins `testAppConfig` puts in the allow list. */
const ORIGINS: Readonly<Record<AppId, string>> = {
  shop: 'http://localhost:3000',
  seller: 'http://localhost:3001',
  admin: 'http://localhost:3002',
}

interface Hop {
  readonly status: number
  readonly location: URL
  readonly setCookie: string | null
}

/** Follows nothing: the redirect *is* the thing under test. */
async function hop(path: string, headers: Record<string, string> = {}): Promise<Hop> {
  const response = await fetch(`${api.baseUrl}${path}`, { redirect: 'manual', headers })
  const location = response.headers.get('location')

  if (location === null) {
    throw new Error(`리다이렉트를 기대했지만 ${String(response.status)} 이 왔습니다.`)
  }

  return {
    status: response.status,
    location: new URL(location),
    setCookie: response.headers.get('set-cookie'),
  }
}

async function statusOf(path: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await fetch(`${api.baseUrl}${path}`, { redirect: 'manual', headers })
  return response.status
}

function cookieValue(setCookie: string | null): string {
  const value = /shopping_oauth_state=([^;]*)/.exec(setCookie ?? '')?.[1]

  if (value === undefined || value === '') throw new Error('state 쿠키가 없습니다.')
  return value
}

/** Starts a sign-in and hands back what the browser would now be holding. */
async function begin(app: AppId): Promise<{ cookie: string; state: string }> {
  const started = await hop(`/api/v1/auth/google?app=${app}`)
  const cookie = cookieValue(started.setCookie)

  return { cookie, state: started.location.searchParams.get('state') ?? '' }
}

function callback(params: {
  cookie?: string
  state?: string
  code?: string
  error?: string
}): Promise<Hop> {
  const query = new URLSearchParams()
  if (params.state !== undefined) query.set('state', params.state)
  if (params.code !== undefined) query.set('code', params.code)
  if (params.error !== undefined) query.set('error', params.error)

  return hop(
    `/api/v1/auth/google/callback?${query.toString()}`,
    params.cookie === undefined ? {} : { cookie: `${OAUTH_STATE_COOKIE}=${params.cookie}` },
  )
}

/** Runs one whole sign-in for `app` and returns where it landed. */
async function signIn(app: AppId): Promise<Hop> {
  const { cookie, state } = await begin(app)

  return callback({ cookie, state, code: 'authorization-code' })
}

interface UserRow {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly avatarUrl: string | null
  readonly lastLoginAt: Date | null
}

function usersWithSub(sub: string): Promise<UserRow[]> {
  return db.query<UserRow>(
    'SELECT id, email, name, "avatarUrl", "lastLoginAt" FROM "User" WHERE "googleSub" = $1',
    [sub],
  )
}

beforeEach(() => {
  google.reset()
})

describe('GET /api/v1/auth/google', () => {
  it('세 앱이 같은 콜백 URL 을 쓴다', async () => {
    // The registered redirect URI is one address (TASK-0021 4장). If this ever
    // became per-app, two of the three would stop working the moment Google
    // compared them against its console.
    await begin('shop')
    await begin('seller')
    await begin('admin')

    const unique = new Set(google.redirectUris)

    expect(unique.size).toBe(1)
    expect([...unique][0]).toMatch(/\/api\/v1\/auth\/google\/callback$/)
  })

  it('state 쿠키가 HttpOnly · SameSite=Lax 이고 Domain 이 없다', async () => {
    const started = await hop('/api/v1/auth/google?app=shop')

    expect(started.status).toBe(302)
    expect(started.setCookie).toContain('HttpOnly')
    // Strict would withhold the cookie on the top-level cross-site navigation
    // back from Google, and every sign-in would fail as a state mismatch — in a
    // real browser only. A spec that sets the header itself would never see it.
    expect(started.setCookie).toContain('SameSite=Lax')
    // D-028: no `Domain`, so a sibling subdomain cannot read it.
    expect(started.setCookie).not.toContain('Domain')
  })

  it('알 수 없는 앱은 400 이다', async () => {
    expect(await statusOf('/api/v1/auth/google?app=warehouse')).toBe(400)
    expect(await statusOf('/api/v1/auth/google')).toBe(400)
  })
})

describe('F1 · F2 최초 로그인과 재로그인', () => {
  it('신규 계정이 만들어지고 BUYER 가 부여된다', async () => {
    const landed = await signIn('shop')

    expect(landed.location.origin).toBe(ORIGINS.shop)
    expect(landed.location.searchParams.get('status')).toBe('ok')

    const users = await usersWithSub(A_GOOGLE_PROFILE.sub)
    expect(users).toHaveLength(1)
    expect(users[0]?.email).toBe(A_GOOGLE_PROFILE.email)
    expect(users[0]?.name).toBe(A_GOOGLE_PROFILE.name)
    expect(users[0]?.avatarUrl).toBe(A_GOOGLE_PROFILE.picture)
    expect(users[0]?.lastLoginAt).not.toBeNull()

    const roles = await db.query<{ role: string }>(
      'SELECT role FROM "UserRole" WHERE "userId" = $1',
      [users[0]?.id],
    )
    expect(roles.map((row) => row.role)).toEqual(['BUYER'])
  })

  it('재로그인은 계정을 늘리지 않고 역할도 중복되지 않는다', async () => {
    await signIn('shop')
    await signIn('shop')

    const users = await usersWithSub(A_GOOGLE_PROFILE.sub)
    expect(users).toHaveLength(1)

    const roles = await db.query('SELECT role FROM "UserRole" WHERE "userId" = $1', [users[0]?.id])
    expect(roles).toHaveLength(1)
  })
})

describe('F3 state 검증', () => {
  it('변조된 state 는 거부되고 계정이 만들어지지 않는다', async () => {
    const { cookie } = await begin('shop')

    const landed = await callback({ cookie, state: 'tampered', code: 'authorization-code' })

    expect(landed.location.searchParams.get('status')).toBe('error')
    expect(landed.location.searchParams.get('reason')).toBe('state_mismatch')
    expect(await usersWithSub(A_GOOGLE_PROFILE.sub)).toHaveLength(0)
    // Never reached Google either: a mismatch is decided before the exchange.
    expect(google.exchangeCount).toBe(0)
  })

  it('쿠키가 없으면 돌아갈 앱을 알 수 없어 400 이다', async () => {
    // The one place this flow does not redirect. Guessing an app here is exactly
    // the open redirect the design refuses to have.
    expect(
      await statusOf('/api/v1/auth/google/callback?state=anything&code=authorization-code'),
    ).toBe(400)
  })

  it('같은 state 를 두 번 쓸 수 없다', async () => {
    const { cookie, state } = await begin('shop')

    const first = await callback({ cookie, state, code: 'authorization-code' })
    expect(first.location.searchParams.get('status')).toBe('ok')

    // A browser would no longer hold the cookie — the callback expired it — so
    // the replay arrives without one and has nowhere to go.
    expect(first.setCookie).toContain('Max-Age=0')
    expect(
      await statusOf(`/api/v1/auth/google/callback?state=${state}&code=authorization-code`),
    ).toBe(400)
  })
})

describe('F4 앱별 복귀', () => {
  it('세 앱이 각자의 오리진으로 돌아간다', async () => {
    const landings = await Promise.all([signIn('shop'), signIn('seller'), signIn('admin')])
    const origins = landings.map((landed) => landed.location.origin)

    expect(origins).toEqual([ORIGINS.shop, ORIGINS.seller, ORIGINS.admin])
    expect(new Set(origins).size).toBe(3)
    for (const landed of landings) expect(landed.location.pathname).toBe('/login')
  })

  it('복귀 앱은 쿠키가 정하지 쿼리가 정하지 않는다', async () => {
    // Started from seller; the callback carries no app at all. If it ever did,
    // a crafted link could complete a real sign-in and land somewhere else.
    const { cookie, state } = await begin('seller')

    const landed = await callback({ cookie, state, code: 'authorization-code' })

    expect(landed.location.origin).toBe(ORIGINS.seller)
  })
})

describe('F5 취소', () => {
  it('동의를 취소하면 오류가 아니라 cancelled 로 돌아간다', async () => {
    const { cookie, state } = await begin('shop')

    const landed = await callback({ cookie, state, error: 'access_denied' })

    expect(landed.status).toBe(302)
    expect(landed.location.origin).toBe(ORIGINS.shop)
    expect(landed.location.searchParams.get('status')).toBe('cancelled')
    expect(landed.location.searchParams.get('reason')).toBeNull()
    expect(await usersWithSub(A_GOOGLE_PROFILE.sub)).toHaveLength(0)
  })

  it('Google 호출이 실패해도 봉투가 아니라 리다이렉트로 답한다', async () => {
    google.failAt('exchange')
    const { cookie, state } = await begin('shop')

    const landed = await callback({ cookie, state, code: 'authorization-code' })

    expect(landed.location.searchParams.get('status')).toBe('error')
    expect(landed.location.searchParams.get('reason')).toBe('exchange_failed')
  })

  it('프로필 조회 실패는 교환 실패와 구분된다', async () => {
    google.failAt('profile')
    const { cookie, state } = await begin('shop')

    const landed = await callback({ cookie, state, code: 'authorization-code' })

    expect(landed.location.searchParams.get('reason')).toBe('profile_failed')
  })
})

describe('F6 권한 없는 앱', () => {
  it('BUYER 만 있는 계정으로 admin 에 오면 no_role 이 실린다', async () => {
    const landed = await signIn('admin')

    // Signing in still worked — D-016 keeps role grants out of the login path,
    // so this is every new account. The console is told so TASK-0023 can say so.
    expect(landed.location.searchParams.get('status')).toBe('ok')
    expect(landed.location.searchParams.get('notice')).toBe('no_role')
  })

  it('shop 에는 요구 역할이 없으므로 안내도 없다', async () => {
    const landed = await signIn('shop')

    expect(landed.location.searchParams.get('notice')).toBeNull()
  })

  it('역할이 있으면 seller 에서 안내가 사라진다', async () => {
    await signIn('seller')
    const users = await usersWithSub(A_GOOGLE_PROFILE.sub)
    await db.query(
      'INSERT INTO "UserRole" ("id", "userId", role) VALUES (gen_random_uuid(), $1, $2)',
      [users[0]?.id, 'SELLER_OWNER'],
    )

    const landed = await signIn('seller')

    expect(landed.location.searchParams.get('notice')).toBeNull()
  })
})

describe('F7 동시 최초 로그인 (A7)', () => {
  it('같은 계정으로 콜백 둘이 동시에 와도 계정은 하나다', async () => {
    // Two browsers, two valid states, one Google identity.
    //
    // **This half proves the recovery, not the race.** Whether the two requests
    // actually interleave is up to the runtime, so "one account exists" would
    // also pass if they had simply queued. What it does prove is that the loser
    // of a collision comes back with the winner's row instead of a 500 — and
    // that the collision is possible at all is pinned down deterministically,
    // with a barrier and a negative control, in
    // `test/db/google-identity-contention.spec.ts`.
    const [first, second] = await Promise.all([begin('shop'), begin('shop')])

    const landings = await Promise.all([
      callback({ cookie: first.cookie, state: first.state, code: 'code-1' }),
      callback({ cookie: second.cookie, state: second.state, code: 'code-2' }),
    ])

    for (const landed of landings) expect(landed.location.searchParams.get('status')).toBe('ok')

    const users = await usersWithSub(A_GOOGLE_PROFILE.sub)
    expect(users).toHaveLength(1)

    const roles = await db.query('SELECT role FROM "UserRole" WHERE "userId" = $1', [users[0]?.id])
    expect(roles).toHaveLength(1)
  })
})

describe('F8 Google 이 설정되지 않은 환경', () => {
  const unconfigured = useApiApp({ database: db, config: { googleOAuth: null } })

  it('기동은 되고 두 엔드포인트만 503 이다', async () => {
    // The state that CI runs in, and the state this repository ran in for two
    // days after the Render deploy. Health has to keep answering.
    const health = await fetch(`${unconfigured.baseUrl}/api/v1/health`)
    expect(health.status).toBe(200)

    const started = await fetch(`${unconfigured.baseUrl}/api/v1/auth/google?app=shop`, {
      redirect: 'manual',
    })
    expect(started.status).toBe(503)
  })
})

describe('F10 허용 목록에 없는 앱', () => {
  const noApps = useApiApp({
    database: db,
    config: { appOrigins: { shop: null, seller: null, admin: null } },
  })

  it('돌아갈 곳이 없으면 로그인을 시작조차 하지 않는다', async () => {
    const response = await fetch(`${noApps.baseUrl}/api/v1/auth/google?app=shop`, {
      redirect: 'manual',
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })
})
