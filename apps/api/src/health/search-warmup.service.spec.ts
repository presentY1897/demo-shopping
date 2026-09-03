/**
 * F9 · F10 — the search engine is woken exactly once, and never on a timer.
 *
 * The second half matters more than the first. A repeating warm-up is "keep it
 * awake", and the free plan's 750 instance hours are shared by both services:
 * two services running around the clock is 1460 hours, which stops everything
 * for the rest of the month (TASK-0009 R8).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import { SEARCH_WARMUP_TIMEOUT_MS, SearchWarmupService } from './search-warmup.service.js'

function config(nodeEnv: AppConfig['nodeEnv'] = 'production'): AppConfig {
  return {
    nodeEnv,
    search: { host: 'http://localhost:7740/', masterKey: 'x'.repeat(8), timeoutMs: 200 },
  } as AppConfig
}

function stubFetch(result: Promise<unknown> = Promise.resolve({ status: 200 })) {
  const fetchMock = vi.fn((_url: string, _init?: unknown) => result)
  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the warm-up request', () => {
  it("goes to the search engine's open health route", async () => {
    const fetchMock = stubFetch()

    await new SearchWarmupService(config()).wake()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:7740/health')
  })

  it('is allowed to stay open far longer than a health probe, so it can time the wake-up', () => {
    // The probe ceiling is 10s (`MEILI_HEALTH_TIMEOUT_MS`); a spin-up is ~90s.
    expect(SEARCH_WARMUP_TIMEOUT_MS).toBeGreaterThan(90_000)
  })

  it('does not reject when the engine never answers', async () => {
    stubFetch(Promise.reject(new Error('TimeoutError')))

    await expect(new SearchWarmupService(config()).wake()).resolves.toBeUndefined()
  })

  it('opens no socket during a test run', async () => {
    const fetchMock = stubFetch()

    await new SearchWarmupService(config('test')).wake()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('bootstrap', () => {
  it('fires the request without making boot wait for it', () => {
    let settle: (() => void) | undefined
    stubFetch(
      new Promise((resolve) => {
        settle = () => {
          resolve({ status: 200 })
        }
      }),
    )

    // Returns void, not a promise: Nest awaits this hook, and awaiting a cold
    // search engine here would add its spin-up to the API's own boot time.
    expect(new SearchWarmupService(config()).onApplicationBootstrap()).toBeUndefined()

    settle?.()
  })

  it('schedules nothing — one process, one request', async () => {
    const fetchMock = stubFetch()
    vi.useFakeTimers()

    try {
      const service = new SearchWarmupService(config())
      service.onApplicationBootstrap()
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
