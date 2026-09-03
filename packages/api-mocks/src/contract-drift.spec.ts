/**
 * The mechanism both halves of the contract gate rest on.
 *
 * `createApiClient` parses every response with the shared schema, so a payload
 * that drifted arrives as `ApiClientError { kind: 'malformed_response' }` naming
 * the field. TASK-0106's integration specs call the real API through this same
 * client, which is what makes C3 structural there rather than a habit: there is
 * no way to read a response without parsing it.
 *
 * The specs below drive the client against the mock API instead of a live one,
 * so the check lives here even though the drift it describes is the back-end's.
 */

import { createApiClient, isApiClientError } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { driftedHealthPayload, httpFailure, malformedResponse, networkFailure } from './failures'
import { healthDegraded, healthOk } from './fixtures/health'
import { setupTestServer } from './node'
import { mockPaths } from './paths'

const testServer = setupTestServer()

// The apps never point at a real host in tests either; see the vitest preset.
const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

async function healthFailure(): Promise<unknown> {
  return client.getHealth().then(
    () => null,
    (error: unknown) => error,
  )
}

describe('the mock API', () => {
  it('answers /health with a payload the shared schema accepts', async () => {
    await expect(client.getHealth()).resolves.toEqual(healthOk)
  })

  it('can be told to answer a degraded payload', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthDegraded))

    await expect(client.getHealth()).resolves.toEqual(healthDegraded)
  })
})

describe('a back-end that renamed database to db', () => {
  beforeEach(() => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
  })

  it('is rejected rather than rendered', async () => {
    const error = await healthFailure()

    expect(isApiClientError(error)).toBe(true)
  })

  it('names the field that drifted', async () => {
    const error = await healthFailure()

    expect(isApiClientError(error) && error.kind).toBe('malformed_response')
    expect(isApiClientError(error) && error.message).toContain('database')
  })
})

describe('failure handlers', () => {
  it('turn a 4xx into an http error carrying the API code', async () => {
    testServer.server.use(httpFailure(mockPaths.health, 404, 'NOT_FOUND', 'No such endpoint'))
    const error = await healthFailure()

    expect(isApiClientError(error) && error.kind).toBe('http')
    expect(isApiClientError(error) && error.status).toBe(404)
    expect(isApiClientError(error) && error.code).toBe('NOT_FOUND')
  })

  it('turn a 5xx into an http error', async () => {
    testServer.server.use(
      httpFailure(mockPaths.health, 500, 'INTERNAL_ERROR', 'Something went wrong'),
    )
    const error = await healthFailure()

    expect(isApiClientError(error) && error.kind).toBe('http')
    expect(isApiClientError(error) && error.status).toBe(500)
  })

  it('turn an unreachable API into a network error', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    const error = await healthFailure()

    expect(isApiClientError(error) && error.kind).toBe('network')
  })
})
