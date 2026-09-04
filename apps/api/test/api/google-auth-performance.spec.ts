import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { GOOGLE_OAUTH } from '../../src/auth/google-oauth.client.js'
import { OAUTH_STATE_COOKIE } from '../../src/auth/oauth-state.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { A_GOOGLE_PROFILE, createFakeGoogle } from '../support/google-oauth.js'

/**
 * Gate A1 (response time) for the two sign-in endpoints.
 *
 * **What is being measured, and what is not.** Google is behind the port and
 * answers instantly, so the two network round trips a real sign-in pays are
 * excluded on purpose — they are not ours and no threshold we set could hold
 * them. What is left is the part this task owns: state generation, the cookie,
 * the identity lookup, the insert on first sign-in, and the redirect. If those
 * are slow, they are slow because of something we wrote.
 *
 * The re-sign-in case is the one that runs on every visit, and it is the one
 * with a query in it — the first-sign-in case additionally writes two rows in a
 * transaction, which is why both are measured rather than just the cheaper one.
 */

const db = useDatabase()
const google = createFakeGoogle()
const api = useApiApp({
  database: db,
  overrides: [{ token: GOOGLE_OAUTH, value: google }],
})

const SAMPLES = 50

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

async function beginOnce(): Promise<{ cookie: string; state: string }> {
  const response = await fetch(`${api.baseUrl}/api/v1/auth/google?app=shop`, {
    redirect: 'manual',
  })
  const location = new URL(response.headers.get('location') ?? '')
  const cookie = /shopping_oauth_state=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1]

  return { cookie: cookie ?? '', state: location.searchParams.get('state') ?? '' }
}

function callbackOnce(cookie: string, state: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/google/callback?state=${state}&code=c`, {
    redirect: 'manual',
    headers: { cookie: `${OAUTH_STATE_COOKIE}=${cookie}` },
  })
}

describe('A1 — 응답 시간', () => {
  it('authorize 가 300ms 안에 답한다', async () => {
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await beginOnce()
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('재로그인 콜백이 300ms 안에 답한다', async () => {
    // Warm up the row so that what is timed is the steady state — the path a
    // returning visitor takes — rather than the one-off insert measured below.
    const first = await beginOnce()
    await callbackOnce(first.cookie, first.state)

    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const { cookie, state } = await beginOnce()
      const started = performance.now()

      await callbackOnce(cookie, state)
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('최초 로그인 콜백이 300ms 안에 답한다', async () => {
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      // A new identity every time, so every sample takes the insert path.
      google.setProfile({ ...A_GOOGLE_PROFILE, sub: `perf-${randomUUID()}` })

      const { cookie, state } = await beginOnce()
      const started = performance.now()

      await callbackOnce(cookie, state)
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})
