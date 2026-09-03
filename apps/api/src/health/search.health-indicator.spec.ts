import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import { SearchHealthIndicator } from './search.health-indicator.js'

const CONFIG = {
  search: { host: 'http://localhost:7740/', masterKey: 'x'.repeat(8), timeoutMs: 200 },
} as AppConfig

/** No expected index — the state of the repository until TASK-0038 lands. */
function indicator(indexes: readonly string[] = []): SearchHealthIndicator {
  return new SearchHealthIndicator(CONFIG, indexes)
}

interface Answer {
  readonly ok?: boolean
  readonly status?: number
  readonly body: unknown
}

function answerWith(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })),
  )
}

/**
 * Routes each URL to its own answer, which is what the readiness path needs:
 * `/health` and `/indexes/<uid>/stats` are two different calls with two
 * different failure modes.
 */
function route(answers: Readonly<Record<string, Answer>>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    const answer = answers[url]
    if (answer === undefined) return Promise.reject(new Error(`unrouted ${url}`))

    return Promise.resolve({
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: () => Promise.resolve(answer.body),
    })
  })
  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

const HEALTH_URL = 'http://localhost:7740/health'
const PRODUCTS_STATS_URL = 'http://localhost:7740/indexes/products/stats'
const AVAILABLE = { status: 'available' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('engine liveness', () => {
  it('reports ok when Meilisearch says it is available', async () => {
    answerWith(AVAILABLE)

    await expect(indicator().check()).resolves.toBe('ok')
  })

  it('strips the trailing slash off the configured host', async () => {
    const fetchMock = route({ [HEALTH_URL]: { body: AVAILABLE } })

    await indicator().check()

    expect(fetchMock.mock.calls[0]?.[0]).toBe(HEALTH_URL)
  })

  it('reports degraded when the answer is not the expected payload', async () => {
    answerWith({ status: 'unavailable' })
    await expect(indicator().check()).resolves.toBe('degraded')

    answerWith('nonsense')
    await expect(indicator().check()).resolves.toBe('degraded')
  })

  it('reports down on an error status', async () => {
    answerWith(AVAILABLE, false)

    await expect(indicator().check()).resolves.toBe('down')
  })

  it('reports down instead of rejecting when the host refuses the connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )

    await expect(indicator().check()).resolves.toBe('down')
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

    await expect(indicator().check()).resolves.toBe('down')
  })
})

/**
 * F7 · F8 — an engine that is up but cannot answer a query yet.
 *
 * This is the state a restart leaves behind: the free plan has no persistent
 * disk, so Meilisearch comes back with nothing and a search returns zero results
 * rather than an error (TASK-0009 4장). `degraded` is what lets the screen say
 * "준비 중" instead of "결과 없음".
 */
describe('index readiness', () => {
  it('sends no readiness request while no index is expected', async () => {
    const fetchMock = route({ [HEALTH_URL]: { body: AVAILABLE } })

    await expect(indicator().check()).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports ok when every expected index holds documents', async () => {
    route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { body: { numberOfDocuments: 800, isIndexing: false } },
    })

    await expect(indicator(['products']).check()).resolves.toBe('ok')
  })

  it('reports degraded when an expected index is empty', async () => {
    route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { body: { numberOfDocuments: 0, isIndexing: false } },
    })

    await expect(indicator(['products']).check()).resolves.toBe('degraded')
  })

  it('reports degraded while the index is being rebuilt', async () => {
    route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { body: { numberOfDocuments: 120, isIndexing: true } },
    })

    await expect(indicator(['products']).check()).resolves.toBe('degraded')
  })

  it('reports degraded when the index does not exist at all', async () => {
    route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { ok: false, status: 404, body: {} },
    })

    await expect(indicator(['products']).check()).resolves.toBe('degraded')
  })

  it('reports degraded when the master key is refused', async () => {
    route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { ok: false, status: 403, body: {} },
    })

    await expect(indicator(['products']).check()).resolves.toBe('degraded')
  })

  it('carries the master key, which every data route requires', async () => {
    const fetchMock = route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { body: { numberOfDocuments: 1, isIndexing: false } },
    })

    await indicator(['products']).check()

    const init = fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }

    expect(init.headers.authorization).toBe(`Bearer ${'x'.repeat(8)}`)
  })

  it('is degraded when any one of several indexes is not ready', async () => {
    route({
      [HEALTH_URL]: { body: AVAILABLE },
      [PRODUCTS_STATS_URL]: { body: { numberOfDocuments: 800, isIndexing: false } },
      'http://localhost:7740/indexes/reviews/stats': { body: { numberOfDocuments: 0 } },
    })

    await expect(indicator(['products', 'reviews']).check()).resolves.toBe('degraded')
  })

  it('never probes an index when the engine itself is unreachable', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(indicator(['products']).check()).resolves.toBe('down')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
