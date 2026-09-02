import type { AppConfig } from '../config/app-config.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SearchHealthIndicator } from './search.health-indicator.js'

const CONFIG = {
  search: { host: 'http://localhost:7740/', masterKey: 'x'.repeat(8), timeoutMs: 200 },
} as AppConfig

function answerWith(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SearchHealthIndicator', () => {
  it('reports ok when Meilisearch says it is available', async () => {
    answerWith({ status: 'available' })

    await expect(new SearchHealthIndicator(CONFIG).check()).resolves.toBe('ok')
  })

  it('strips the trailing slash off the configured host', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'available' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await new SearchHealthIndicator(CONFIG).check()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:7740/health')
  })

  it('reports degraded when the answer is not the expected payload', async () => {
    answerWith({ status: 'unavailable' })
    await expect(new SearchHealthIndicator(CONFIG).check()).resolves.toBe('degraded')

    answerWith('nonsense')
    await expect(new SearchHealthIndicator(CONFIG).check()).resolves.toBe('degraded')
  })

  it('reports down on an error status', async () => {
    answerWith({ status: 'available' }, false)

    await expect(new SearchHealthIndicator(CONFIG).check()).resolves.toBe('down')
  })

  it('reports down instead of rejecting when the host refuses the connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )

    await expect(new SearchHealthIndicator(CONFIG).check()).resolves.toBe('down')
  })

  it('gives up once the deadline passes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'))
            })
          }),
      ),
    )

    await expect(new SearchHealthIndicator(CONFIG).check()).resolves.toBe('down')
  })
})
