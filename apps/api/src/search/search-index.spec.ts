import type { Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import {
  MeilisearchIndex,
  SearchEngineError,
  SearchEngineUnreachableError,
} from './search-index.js'

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
        text: () => Promise.resolve(`<!DOCTYPE html><title>${String(status)}</title>`),
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

describe('size of a missing index', () => {
  /**
   * `ensurePopulated` declines to act on `null`, so this answer is what decides
   * whether a restarted engine ever gets its index back (TASK-0119 4.7).
   */
  it('is zero, so the indexer rebuilds', async () => {
    answerWith({ code: 'index_not_found' }, { ok: false, status: 404 })

    await expect(new MeilisearchIndex(CONFIG).size()).resolves.toBe(0)
  })

  it('is unknown when the engine cannot be reached (R5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))),
    )

    await expect(new MeilisearchIndex(CONFIG).size()).resolves.toBeNull()
  })

  it('is unknown when the engine refuses for another reason (R5)', async () => {
    answerWith({ code: 'invalid_api_key' }, { ok: false, status: 403 })

    await expect(new MeilisearchIndex(CONFIG).size()).resolves.toBeNull()
  })

  it('is the document count when the index is there', async () => {
    answerWith({ numberOfDocuments: 42 })

    await expect(new MeilisearchIndex(CONFIG).size()).resolves.toBe(42)
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

/**
 * TASK-0143 4.1 — "not reached" is told apart from "refused".
 *
 * The first is a state: the engine is a free service that sleeps and restarts on
 * its own, and waiting fixes it. The second is a fault, and waiting does not.
 * The public search paths answer the first as 503 and the second as 500, so the
 * line drawn here is the line a visitor's screen ends up on one side of.
 */
describe('an engine that answers through the platform gateway', () => {
  it.each([502, 503, 504])('reads a %i with no code as unreachable (F2)', async (status) => {
    answerWithHtml(status)

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).rejects.toThrow(
      SearchEngineUnreachableError,
    )
  })

  it('keeps what the gateway said as the cause, for the log', async () => {
    answerWithHtml(503)

    const error = await new MeilisearchIndex(CONFIG).search(QUERY).catch((cause: unknown) => cause)

    expect(error).toMatchObject({ cause: { name: 'SearchEngineError', status: 503, code: null } })
  })

  /**
   * The negative control for the rule. Meilisearch has 503s of its own, and they
   * come with a code; a status alone would have called them "asleep".
   */
  it('reads the same status as a refusal when the engine put a code on it', async () => {
    answerWith({ code: 'too_many_search_requests' }, { ok: false, status: 503 })

    const error = await new MeilisearchIndex(CONFIG).search(QUERY).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SearchEngineError)
    expect(error).not.toBeInstanceOf(SearchEngineUnreachableError)
  })

  it('does not read a 200 that is not JSON as something to wait out', async () => {
    // Whatever answered, it answered — and it said success. Waiting is not what
    // fixes a host that points at the wrong thing.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<!DOCTYPE html>') }),
      ),
    )

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).rejects.toThrow(SyntaxError)
  })

  it('does not read a key mismatch as something to wait out (F3)', async () => {
    answerWith({ code: 'invalid_api_key' }, { ok: false, status: 403 })

    await expect(new MeilisearchIndex(CONFIG).search(QUERY)).rejects.not.toBeInstanceOf(
      SearchEngineUnreachableError,
    )
  })
})

/**
 * Over real sockets, on the loopback interface only.
 *
 * What `fetch` throws for a refused port or a passed deadline is the runtime's
 * business, and a stubbed rejection would assert this file's guess about it
 * rather than the thing itself.
 */
describe('an engine that does not answer at all', () => {
  const servers: Server[] = []

  /** A local engine that does whatever `respond` does — including nothing. */
  async function engineThat(respond: (response: ServerResponse) => void): Promise<AppConfig> {
    const server = createServer((_request, response) => {
      respond(response)
    })

    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    return configFor((server.address() as AddressInfo).port)
  }

  function configFor(port: number): AppConfig {
    return {
      search: { ...CONFIG.search, host: `http://127.0.0.1:${String(port)}` },
    } as AppConfig
  }

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('reads a refused connection as unreachable, and says why', async () => {
    // A port that was just listening and no longer is: closed for certain,
    // without guessing at a number nobody else on this machine uses.
    const config = await engineThat(() => undefined)
    const [server] = servers.splice(0)

    await new Promise((resolve) => server?.close(resolve))

    const error = await new MeilisearchIndex(config).search(QUERY).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SearchEngineUnreachableError)
    // `fetch failed` alone does not tell a closed port from a mistyped host.
    expect((error as Error).message).toContain('ECONNREFUSED')
    expect((error as Error).cause).toBeInstanceOf(TypeError)
  })

  it('reads a passed deadline as unreachable', async () => {
    // Accepts the connection and never answers — what a request held by a
    // waking instance looks like from this side.
    const config = await engineThat(() => undefined)

    const error = await new MeilisearchIndex(config).search(QUERY).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SearchEngineUnreachableError)
    expect(error).toMatchObject({ cause: { name: 'TimeoutError' } })
  })

  it('reads an answer that stops arriving as unreachable', async () => {
    // Headers and half a body, then silence. The status says 200, so nothing
    // but the deadline would ever end this — and it ends inside the body read,
    // after `fetch` has already resolved.
    const config = await engineThat((response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"hits":[')
    })

    await expect(new MeilisearchIndex(config).search(QUERY)).rejects.toThrow(
      SearchEngineUnreachableError,
    )
  })
})
