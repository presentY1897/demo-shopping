import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import { MeilisearchIndex, SearchEngineError } from './search-index.js'

const CONFIG = {
  search: {
    host: 'http://localhost:7740/',
    masterKey: 'x'.repeat(8),
    timeoutMs: 200,
    productsIndex: 'products',
  },
} as AppConfig

const QUERY = { q: '', filter: null, sort: [], offset: 0, limit: 12, facets: [] } as const

/** One canned answer for every call, which is all a single query needs. */
function answerWith(body: unknown, init: { ok: boolean; status?: number } = { ok: true }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: init.ok,
        status: init.status ?? (init.ok ? 200 : 500),
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      }),
    ),
  )
}

/** A non-JSON refusal — what something in front of the engine answers with. */
function answerWithHtml(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('<!DOCTYPE html><title>404</title>'),
      }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('search against a missing index', () => {
  /**
   * The engine is a free web service with no persistent disk, so every restart
   * leaves no index behind and the indexer refills it. A query that lands in
   * that window is looking at a catalogue that holds nothing yet.
   */
  it('answers an empty result rather than failing', async () => {
    answerWith(
      { code: 'index_not_found', message: 'Index `products` not found.' },
      {
        ok: false,
        status: 404,
      },
    )

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).resolves.toEqual({
      hits: [],
      total: 0,
      facets: {},
    })
  })
})

describe('search against a real fault', () => {
  /**
   * The counterpart to the test above, and the reason the check reads the body's
   * code rather than the status. Swallowing every refusal would answer an empty
   * page for a wrong key — a broken deployment that looks like an empty one,
   * which is the failure this whole task is about.
   */
  it('rethrows a key mismatch', async () => {
    answerWith(
      { code: 'invalid_api_key', message: 'The provided API key is invalid.' },
      {
        ok: false,
        status: 403,
      },
    )

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).rejects.toThrow(SearchEngineError)
  })

  it('rethrows a 404 that carries no code', async () => {
    answerWithHtml(404)

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).rejects.toThrow(SearchEngineError)
  })

  it('carries the engine status and code for a caller to read', async () => {
    answerWith({ code: 'invalid_search_filter' }, { ok: false, status: 400 })

    const error = await new MeilisearchIndex(CONFIG).search(QUERY).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SearchEngineError)
    expect(error).toMatchObject({ status: 400, code: 'invalid_search_filter' })
  })
})

describe('search against a healthy index', () => {
  it('reads hits and totals unchanged', async () => {
    answerWith({ hits: [{ id: 'p1' }], estimatedTotalHits: 1, facetDistribution: {} })

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).resolves.toEqual({
      hits: [{ id: 'p1' }],
      total: 1,
      facets: {},
    })
  })
})
