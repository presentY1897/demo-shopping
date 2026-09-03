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

/**
 * A build with no API address cannot be fixed by asking again, and each attempt
 * would be a request against a free instance whose running time is billed
 * (TASK-0009 R8). The sequence has to recognise that and stop.
 */
describe('the wake-up sequence with no API address', () => {
  it('gives up after one attempt instead of spending the retry budget', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined)
    vi.resetModules()

    const { wakeApi } = await import('@/lib/wake')
    const { WAKE_POLICY } = await import('@/lib/wake-policy')
    const attempts: number[] = []

    const result = await wakeApi(WAKE_POLICY, new AbortController().signal, (attempt) => {
      attempts.push(attempt)
    })

    expect(result).toMatchObject({ ok: false, reason: 'configuration' })
    expect(attempts).toEqual([1])
  })
})
