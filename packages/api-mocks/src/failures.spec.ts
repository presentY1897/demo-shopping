/**
 * The failure helpers, checked through the same client the apps use.
 *
 * {@link gatedFailureOn} gets the attention here because its whole value is a
 * negative: **nothing happens until the spec says so.** A helper that answered
 * early would make the optimistic-frame specs in the three apps pass without
 * exercising anything, which is the failure TASK-0121 exists to remove.
 */

import { createApiClient, isApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { gatedFailureOn } from './failures'
import { setupTestServer } from './node'
import { mockPaths } from './paths'

const testServer = setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

/** Resolves once the microtask queue has drained a few times over. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe('gatedFailureOn', () => {
  it('does not answer before release', async () => {
    const failure = gatedFailureOn('get', mockPaths.health)
    testServer.server.use(failure.handler)

    let settled = false
    const pending = client.getHealth().then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await settle()

    // No clock is involved: the request is held open by construction, so this
    // is a fact about the double rather than a bet on how fast the machine is.
    expect(settled).toBe(false)

    failure.release()
    await pending

    expect(settled).toBe(true)
  })

  it('answers as a network failure once released', async () => {
    const failure = gatedFailureOn('get', mockPaths.health)
    testServer.server.use(failure.handler)

    const pending = client.getHealth().then(
      () => null,
      (error: unknown) => error,
    )

    failure.release()

    const error = await pending

    expect(isApiClientError(error) ? error.kind : null).toBe('network')
  })

  it('is safe to release twice', async () => {
    const failure = gatedFailureOn('get', mockPaths.health)
    testServer.server.use(failure.handler)

    const pending = client.getHealth().catch((error: unknown) => error)

    failure.release()
    failure.release()

    await expect(pending).resolves.toBeDefined()
  })
})
