import { randomUUID } from 'node:crypto'

import type { AppId } from '@shopping/shared'
import { APP_ID_HEADER, sessionResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { GOOGLE_OAUTH } from '../../src/auth/google-oauth.client.js'
import { OAUTH_STATE_COOKIE } from '../../src/auth/oauth-state.js'
import { refreshCookieName } from '../../src/auth/session-cookie.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { A_GOOGLE_PROFILE, createFakeGoogle } from '../support/google-oauth.js'

/**
 * Gate A1 (response time) for the three session endpoints TASK-0022 adds.
 *
 * **`POST /auth/refresh`** is timed because it is the busiest authenticated
 * path in the system — every signed-in browser calls it roughly every fifteen
 * minutes, so a regression here is not one slow request but a multiplied one.
 * A rising p95 points at the rotation write path: the revoke-then-insert pair
 * on `RefreshToken`, or the `ownerOf` lookup that repopulates the roles baked
 * into the next access token (`session.service.ts`).
 *
 * **The bearer-authenticated request** is timed separately from the endpoint
 * it rides on, because `AccessTokenPrincipalResolver` is documented to add
 * nothing but a signature check — "No database query." — which is the whole
 * reason the access token is self-contained rather than looked up on every
 * request (`access-token.resolver.ts`, TASK-0022 4장). `GET /categories` with
 * no `rootId` is the vehicle: its own cost is already pinned down elsewhere
 * (`categories-performance.spec.ts`, A5) as exactly one query against an
 * otherwise-empty tree, and every role a Google sign-in can grant — including
 * the plain `BUYER` a first sign-in gets — holds `catalog.read` with scope
 * `any` (`role-permissions.ts`), so a bearer token is enough to clear the
 * permission check without needing a seller or admin account. Against that
 * known, fixed baseline, this number moving on its own is the signal that a
 * database round trip crept back into the resolver.
 *
 * **`POST /auth/logout`** is timed because it is on the path a person is
 * actually watching — the request a browser waits on before it can call
 * itself signed out.
 *
 * Google sits behind the same fake port `google-auth-performance.spec.ts`
 * uses, so none of these numbers include a real network round trip to
 * Google — that cost belongs to TASK-0021, not this one.
 */

const db = useDatabase()
const google = createFakeGoogle()
const api = useApiApp({
  database: db,
  overrides: [{ token: GOOGLE_OAUTH, value: google }],
})

const SAMPLES = 50
const APP: AppId = 'shop'
const REFRESH_COOKIE = refreshCookieName(APP)

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

function setCookiesOf(response: Response): string[] {
  return response.headers.getSetCookie()
}

/**
 * The named cookie's `name=value` pair, or `undefined` if it was cleared (an
 * empty value) or never set. Reads every `Set-Cookie` header individually
 * rather than the folded string `Headers#get` would return, because a
 * response here can carry more than one — the callback both expires the
 * OAuth state cookie and plants the refresh cookie in the same answer.
 */
function cookieFrom(setCookie: readonly string[], name: string): string | undefined {
  return setCookie
    .map((header) => new RegExp(`(?:^|; )(${name}=[^;]*)`).exec(header)?.[1])
    .find((value) => value !== undefined && !value.endsWith('='))
}

async function beginOnce(): Promise<{ cookie: string; state: string }> {
  const response = await fetch(`${api.baseUrl}/api/v1/auth/google?app=${APP}`, {
    redirect: 'manual',
  })
  const location = new URL(response.headers.get('location') ?? '')
  const cookie = /shopping_oauth_state=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1]

  return { cookie: cookie ?? '', state: location.searchParams.get('state') ?? '' }
}

/**
 * Plants a refresh cookie the way the real Google callback does (TASK-0021
 * ⑤), for a brand-new buyer each time so the samples in a loop never collide
 * on the same account.
 */
async function signUpAndPlant(): Promise<string> {
  google.setProfile({ ...A_GOOGLE_PROFILE, sub: `perf-${randomUUID()}` })

  const { cookie, state } = await beginOnce()
  const response = await fetch(`${api.baseUrl}/api/v1/auth/google/callback?state=${state}&code=c`, {
    redirect: 'manual',
    headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` },
  })
  const planted = cookieFrom(setCookiesOf(response), REFRESH_COOKIE)

  if (planted === undefined) throw new Error('callback did not plant a refresh cookie')

  return planted
}

function callRefresh(cookie: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { cookie, [APP_ID_HEADER]: APP },
  })
}

function callLogout(cookie: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie, [APP_ID_HEADER]: APP },
  })
}

describe('response time (A1)', () => {
  it('rotates a refresh token well inside 300ms at p95', async () => {
    // A chain of rotations, exactly what one signed-in browser produces over
    // time: each answer's cookie is the next call's credential. Starting over
    // with a fresh sign-in every sample would only ever exercise the
    // first-refresh-after-login case; reusing an already-spent token would hit
    // the ten-second grace-window branch instead of the live-token branch a
    // real renewal takes (TASK-0022 4장) — a different, and misleadingly
    // cheap, query shape.
    let cookie = await signUpAndPlant()
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()
      const response = await callRefresh(cookie)

      durations.push(performance.now() - started)

      const rotated = cookieFrom(setCookiesOf(response), REFRESH_COOKIE)
      if (rotated === undefined) throw new Error('refresh did not rotate the cookie')
      cookie = rotated
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('resolves a bearer-authenticated request well inside 300ms at p95', async () => {
    const cookie = await signUpAndPlant()
    const response = await callRefresh(cookie)
    const { accessToken } = sessionResponseSchema.parse(await response.json())
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await fetch(`${api.baseUrl}/api/v1/categories`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('answers a logout well inside 300ms at p95', async () => {
    // A fresh session per sample, not a reused one: logout revokes whatever is
    // still live for the (user, app) pair, and calling it twice on the same
    // token turns the second `UPDATE` into a no-op that matches zero rows —
    // cheaper than, and not representative of, the sign-out a person actually
    // waits on.
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const cookie = await signUpAndPlant()
      const started = performance.now()

      await callLogout(cookie)
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})
