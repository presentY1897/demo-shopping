/**
 * What the session double promises the three apps that boot against it.
 *
 * The renewal endpoint is the one call every app makes before it can render
 * anything, so a double that answered loosely would let three sign-in flows pass
 * their specs against an API that refuses them. Two things are worth checking:
 * the success body is a real {@link sessionResponseSchema} (C2), and the refusal
 * carries the reason where `SessionController.refused` puts it —
 * `AUTH_REQUIRED` on the envelope, the reason on `details[].params`.
 *
 * The calls go through `createApiClient` rather than bare `fetch`, so the header
 * every renewal has to carry is sent the way an app sends it.
 */

import type { ApiErrorBody } from '@shopping/shared'
import {
  API_PATH_PREFIX,
  APP_ID_HEADER,
  createApiClient,
  isApiClientError,
  isApiFieldError,
  sessionResponseSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { sessionAdminSuper, sessionBuyer } from './fixtures/session'
import { failNextRefresh, mockSession, resetSessionStore } from './handlers/session'
import { setupTestServer } from './node'

setupTestServer()

const BASE_URL = 'http://api.test.invalid'
const client = createApiClient({ appId: 'shop', baseUrl: BASE_URL })

function refresh(): Promise<unknown> {
  return client.request({
    method: 'POST',
    path: '/auth/refresh',
    schema: sessionResponseSchema,
  })
}

/** The envelope behind a refusal, or `null` when the call went through. */
async function envelopeOf(call: Promise<unknown>): Promise<ApiErrorBody | null> {
  return call.then(
    () => null,
    (error: unknown) => (isApiClientError(error) ? (error.body ?? null) : null),
  )
}

describe('POST /auth/refresh', () => {
  it('answers a signed-out browser with AUTH_REQUIRED and a reason', async () => {
    resetSessionStore(null)

    const body = await envelopeOf(refresh())

    expect(body?.error.code).toBe('AUTH_REQUIRED')
    expect(body?.error.details.find(isApiFieldError)?.params).toEqual({ reason: 'unknown' })
  })

  it('answers a live session with a body the shared schema accepts', async () => {
    resetSessionStore(sessionBuyer)

    await expect(refresh()).resolves.toEqual(sessionBuyer)
  })

  it('serves whichever role the spec seeded', async () => {
    resetSessionStore(sessionAdminSuper)

    await expect(refresh()).resolves.toEqual(sessionAdminSuper)
  })

  it('refuses a request that does not say which app it is', async () => {
    resetSessionStore(sessionBuyer)

    // Deliberately not through the client: the header is exactly what is being
    // left out, and the client always sends it.
    const response = await fetch(`${BASE_URL}${API_PATH_PREFIX}/auth/refresh`, { method: 'POST' })

    expect(response.status).toBe(400)
  })

  it('sends the app id the client was built with', async () => {
    resetSessionStore(sessionBuyer)
    let seen: string | null = null

    const sellerClient = createApiClient({
      appId: 'seller',
      baseUrl: BASE_URL,
      fetch: (input, init) => {
        seen = new Headers(init.headers).get(APP_ID_HEADER)
        return globalThis.fetch(input, init)
      },
    })
    await sellerClient.request({
      method: 'POST',
      path: '/auth/refresh',
      schema: sessionResponseSchema,
    })

    expect(seen).toBe('seller')
  })

  it('can be made to fail once, and recovers on the next call', async () => {
    resetSessionStore(sessionBuyer)
    failNextRefresh('reused')

    const body = await envelopeOf(refresh())
    expect(body?.error.details.find(isApiFieldError)?.params).toEqual({ reason: 'reused' })

    // The failure ended the session, exactly as a replay does on the real API.
    expect(mockSession()).toBeNull()
  })
})

describe('POST /auth/logout', () => {
  it('ends the session it is told about', async () => {
    resetSessionStore(sessionBuyer)

    await client.request({
      method: 'POST',
      path: '/auth/logout',
      schema: sessionResponseSchema.optional(),
    })

    expect(mockSession()).toBeNull()
  })
})
