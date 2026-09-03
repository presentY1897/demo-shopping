/**
 * The cold-API helpers, checked against the same client the apps use.
 *
 * A helper that quietly answered straight away would make every wake-up spec in
 * the three apps pass without exercising anything, and that failure is invisible
 * from inside those specs — they would simply see a healthy API.
 */

import { createApiClient, isApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { healthOk } from './fixtures/health'
import { setupTestServer } from './node'
import { mockPaths } from './paths'
import { neverAnswers, slowResponse, wakesAfter } from './waking'

const testServer = setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

async function healthFailure(timeoutMs: number): Promise<unknown> {
  return client.getHealth({ timeoutMs }).then(
    () => null,
    (error: unknown) => error,
  )
}

/** The client's failure category, or `null` when the call unexpectedly worked. */
function kindOf(error: unknown): string | null {
  return isApiClientError(error) ? error.kind : null
}

describe('slowResponse', () => {
  it('answers, but not before the delay has passed', async () => {
    testServer.server.use(slowResponse(mockPaths.health, 60, healthOk))

    const startedAt = performance.now()
    await expect(client.getHealth()).resolves.toEqual(healthOk)

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50)
  })
})

describe('neverAnswers', () => {
  it('leaves the caller to end the request on its own deadline', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    const error = await healthFailure(40)

    // `timeout`, not `network`: the request went out and nothing came back,
    // which is what a sleeping instance looks like from the browser.
    expect(isApiClientError(error) && error.kind).toBe('timeout')
  })

  it('holds the request for at least as long as the deadline', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))

    const startedAt = performance.now()
    await healthFailure(60)

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50)
  })
})

describe('wakesAfter', () => {
  it('fails the stated number of attempts and then answers', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 2, healthOk))

    expect(kindOf(await healthFailure(500))).toBe('network')
    expect(kindOf(await healthFailure(500))).toBe('network')
    await expect(client.getHealth()).resolves.toEqual(healthOk)
  })

  it('counts per handler, so a second scenario starts cold again', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 1, healthOk))
    expect(kindOf(await healthFailure(500))).toBe('network')
    await expect(client.getHealth()).resolves.toEqual(healthOk)

    testServer.server.use(wakesAfter(mockPaths.health, 1, healthOk))
    expect(kindOf(await healthFailure(500))).toBe('network')
  })
})
