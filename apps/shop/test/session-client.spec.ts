/**
 * The session client, driven by a counting `fetch` (TASK-0023 F5 · F6).
 *
 * A stub rather than msw here, deliberately. What is being checked is *how many
 * times* the renewal is called and *what happens in between*, and both need the
 * request held open at a moment of the test's choosing — which a handler that
 * answers immediately cannot give. The double in `@shopping/api-mocks` proves
 * the other half (that the request and the answer match the API's shape); this
 * proves the client's own arithmetic.
 *
 * This file is `apps/shop`'s copy of a module that also exists in `apps/seller`
 * and `apps/admin` (see `src/lib/auth/session-client.ts` for why). One spec, not
 * three: the three files are byte-identical, and a second copy of this would
 * make the duplication cost more without proving anything new.
 */

import type { SessionResponse } from '@shopping/shared'
import { API_PATH_PREFIX, APP_ID_HEADER } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { authenticatedFetch, createSessionClient } from '@/lib/auth/session-client'

const BASE_URL = 'http://api.test.invalid'
const REFRESH_URL = `${BASE_URL}${API_PATH_PREFIX}/auth/refresh`
const LOGOUT_URL = `${BASE_URL}${API_PATH_PREFIX}/auth/logout`
const RESOURCE_URL = `${BASE_URL}${API_PATH_PREFIX}/orders`

const USER = {
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001',
  roles: ['BUYER'] as const,
  sellerId: null,
}

function session(token: string, expiresAt: string): SessionResponse {
  return { accessToken: token, accessExpiresAt: expiresAt, user: { ...USER, roles: ['BUYER'] } }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The 401 `SessionController.refused` builds, in the shape a client reads. */
function refusal(reason: string): Response {
  return jsonResponse(
    {
      error: {
        code: 'AUTH_REQUIRED',
        message: '다시 로그인해 주세요.',
        details: [{ field: 'session', message: '다시 로그인해 주세요.', params: { reason } }],
        requestId: '0192f0c1-4e2b-7a10-9c33-8f2b6d0a41c7',
      },
    },
    401,
  )
}

interface Recorder {
  readonly calls: { readonly url: string; readonly init: RequestInit }[]
  readonly refreshes: () => number
}

/**
 * A `fetch` that records every call and answers from `route`.
 *
 * `route` returns a promise so a test can hold one open — which is the only way
 * to observe that a second caller *joined* the first rather than starting a
 * second request.
 */
function recording(route: (url: string) => Promise<Response>): {
  readonly fetch: typeof globalThis.fetch
  readonly recorder: Recorder
} {
  const calls: { url: string; init: RequestInit }[] = []

  const fetchLike = ((input: string, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return route(String(input))
  }) as unknown as typeof globalThis.fetch

  return {
    fetch: fetchLike,
    recorder: { calls, refreshes: () => calls.filter((call) => call.url === REFRESH_URL).length },
  }
}

describe('renewing a session', () => {
  it('sends the app id, because that is what selects the cookie', async () => {
    const { fetch, recorder } = recording(() =>
      Promise.resolve(jsonResponse(session('a', '2099-01-01T00:00:00.000Z'))),
    )
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    await client.renew()

    const headers = new Headers(recorder.calls[0]?.init.headers)
    expect(headers.get(APP_ID_HEADER)).toBe('shop')
    expect(recorder.calls[0]?.init.credentials).toBe('include')
  })

  it('reads the refusal reason off details[].params', async () => {
    const { fetch } = recording(() => Promise.resolve(refusal('reused')))
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    await expect(client.renew()).resolves.toEqual({ ok: false, reason: 'reused' })
  })

  it('falls back to "unknown" for a refusal that names no reason', async () => {
    const { fetch } = recording(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 'AUTH_REQUIRED', message: 'x', details: [], requestId: 'r' } },
          401,
        ),
      ),
    )
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    await expect(client.renew()).resolves.toEqual({ ok: false, reason: 'unknown' })
  })

  /**
   * A dead network is not a refused session. Telling somebody to sign in again
   * because the API was restarting would take a working session away from them.
   */
  it('reports an unreachable API as its own thing, not as a sign-out', async () => {
    const { fetch } = recording(() => Promise.reject(new TypeError('Failed to fetch')))
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    await expect(client.renew()).resolves.toEqual({ ok: false, reason: 'unreachable' })
  })

  it('refuses a body that is not a session rather than adopting it', async () => {
    const { fetch } = recording(() => Promise.resolve(jsonResponse({ accessToken: 42 })))
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    await expect(client.renew()).resolves.toEqual({ ok: false, reason: 'unreachable' })
    expect(client.accessToken()).toBeNull()
  })
})

describe('single flight (F6)', () => {
  it('calls the API once no matter how many callers ask at the same time', async () => {
    let release: (value: Response) => void = () => undefined
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })
    const { fetch, recorder } = recording(() => held)
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    const all = Promise.all([client.renew(), client.renew(), client.renew(), client.renew()])
    release(jsonResponse(session('a', '2099-01-01T00:00:00.000Z')))
    const outcomes = await all

    expect(recorder.refreshes()).toBe(1)
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true)
  })

  it('starts a new request once the first has settled', async () => {
    const { fetch, recorder } = recording(() =>
      Promise.resolve(jsonResponse(session('a', '2099-01-01T00:00:00.000Z'))),
    )
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    await client.renew()
    await client.renew()

    expect(recorder.refreshes()).toBe(2)
  })

  /**
   * The case the window in TASK-0022 4장 exists for, seen from this side. Four
   * concurrent requests with an expired token must produce one rotation, not
   * four — the server survives four, but three of the results are thrown away
   * and the browser keeps whichever cookie landed last.
   */
  it('renews once for a burst of requests that all found the token expired', async () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    let release: (value: Response) => void = () => undefined
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })

    const { fetch, recorder } = recording((url) =>
      url === REFRESH_URL ? held : Promise.resolve(jsonResponse({ ok: true })),
    )
    const client = createSessionClient({
      appId: 'shop',
      baseUrl: BASE_URL,
      fetch,
      now: () => now,
    })

    // A live session, then time moves past its expiry.
    release(jsonResponse(session('fresh', '2026-01-01T00:15:00.000Z')))
    await client.renew()
    now = Date.parse('2026-01-01T00:20:00.000Z')

    const send = authenticatedFetch(client, fetch)
    const before = recorder.refreshes()
    await Promise.all([send(RESOURCE_URL, {}), send(RESOURCE_URL, {}), send(RESOURCE_URL, {})])

    expect(recorder.refreshes() - before).toBe(1)
  })
})

describe('the authenticated fetch (F5)', () => {
  it('sends the token it holds', async () => {
    const { fetch, recorder } = recording(() =>
      Promise.resolve(jsonResponse(session('token-1', '2099-01-01T00:00:00.000Z'))),
    )
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })
    await client.renew()

    await authenticatedFetch(client, fetch)(RESOURCE_URL, {})

    const last = recorder.calls.at(-1)
    expect(new Headers(last?.init.headers).get('Authorization')).toBe('Bearer token-1')
  })

  it('renews and retries once when the API answers 401', async () => {
    let tokens = 0
    const seen: string[] = []

    const { fetch, recorder } = recording((url) => {
      if (url === REFRESH_URL) {
        tokens += 1
        return Promise.resolve(
          jsonResponse(session(`token-${String(tokens)}`, '2099-01-01T00:00:00.000Z')),
        )
      }
      // The first call with `token-1` is refused; anything later goes through.
      return Promise.resolve(seen.length === 1 ? refusal('expired') : jsonResponse({ ok: true }))
    })
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })
    await client.renew()

    const send = ((url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('Authorization') ?? '')
      return fetch(url, init)
    }) as unknown as typeof globalThis.fetch

    const response = await authenticatedFetch(client, send)(RESOURCE_URL, {})

    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer token-1', 'Bearer token-2'])
    expect(recorder.refreshes()).toBe(2)
  })

  /**
   * A 401 for a request that carried no token is the expected answer for a
   * signed-out visitor. Renewing there would add a round trip to every anonymous
   * page view, to be told again what boot already established.
   */
  it('does not renew for a 401 on a request that carried no token', async () => {
    const { fetch, recorder } = recording(() => Promise.resolve(refusal('unknown')))
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })

    const response = await authenticatedFetch(client, fetch)(RESOURCE_URL, {})

    expect(response.status).toBe(401)
    expect(recorder.refreshes()).toBe(0)
  })

  it('gives up after one retry rather than looping', async () => {
    const { fetch, recorder } = recording((url) =>
      url === REFRESH_URL
        ? Promise.resolve(jsonResponse(session('t', '2099-01-01T00:00:00.000Z')))
        : Promise.resolve(refusal('expired')),
    )
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })
    await client.renew()

    const response = await authenticatedFetch(client, fetch)(RESOURCE_URL, {})

    expect(response.status).toBe(401)
    // The boot renewal plus exactly one retry renewal.
    expect(recorder.refreshes()).toBe(2)
  })
})

describe('signing out (F10)', () => {
  it('drops the token before the request, so a failure cannot resurrect it', async () => {
    const { fetch, recorder } = recording((url) =>
      url === LOGOUT_URL
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse(session('t', '2099-01-01T00:00:00.000Z'))),
    )
    const client = createSessionClient({ appId: 'shop', baseUrl: BASE_URL, fetch })
    await client.renew()

    await client.logout()

    expect(client.accessToken()).toBeNull()
    expect(client.user()).toBeNull()
    expect(recorder.calls.some((call) => call.url === LOGOUT_URL)).toBe(true)
  })
})
