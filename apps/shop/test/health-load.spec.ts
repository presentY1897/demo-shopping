/**
 * The one failure the API cannot produce: no base URL at all.
 *
 * `getApiClient()` throws before a request exists, so there is nothing for msw
 * to answer — which is also why this spec adds no unhandled request to the
 * counter the setup file asserts on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('loadHealth', () => {
  it('reports a missing NEXT_PUBLIC_API_URL as a configuration failure', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined)
    vi.resetModules()

    const { loadHealth } = await import('@/lib/health')

    expect(await loadHealth()).toMatchObject({ ok: false, reason: 'configuration' })
  })

  it('returns the parsed payload when the API answers', async () => {
    const { loadHealth } = await import('@/lib/health')
    const result = await loadHealth()

    expect(result.ok).toBe(true)
    expect(result.endpoint).toBe('http://api.test.invalid')
  })
})
