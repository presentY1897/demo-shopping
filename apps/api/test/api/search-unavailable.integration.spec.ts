/**
 * 검색 엔진에 닿지 못할 때 — over real HTTP (TASK-0143 6.1 F1 · F3, 4.2).
 *
 * On 2026-09-17 the storefront's two product rows ended in a failure notice
 * because `/search` answered 500 while `/health` said `search: "down"`: the API
 * was up and only the engine was not. What is measured here is what a screen
 * gets to *read* in that moment — a code it can wait on, or one it cannot.
 *
 * **No engine is needed, and none is contacted.** "Not reached" is a closed port
 * on the loopback interface, and "answered" is a server this file starts and
 * tells what to say. A real Meilisearch cannot be asked to be asleep on command
 * (the reason `SearchIndex` is a port at all), and QUALITY-GATES 6장 keeps
 * everything outside this machine out of the suite.
 *
 * Asserted on `code`, never on the Korean — `error-contract.md` 6장.
 */

import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { apiErrorSchema, searchFiltersResponseSchema } from '@shopping/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createCategory } from '../support/factories.js'

const db = useDatabase()

interface Answer {
  readonly status: number
  readonly cacheControl: string | null
  readonly code: string
  readonly message: string
  readonly details: readonly unknown[]
}

/** One GET, read as the error envelope it is expected to be. */
async function refusalFrom(baseUrl: string, path: string): Promise<Answer> {
  const response = await fetch(`${baseUrl}/api/v1${path}`)
  const parsed = apiErrorSchema.safeParse(await response.json())

  if (!parsed.success) throw new Error(`${path} 의 응답이 공통 오류 봉투가 아닙니다.`)

  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    details: parsed.data.error.details,
  }
}

describe('with the engine behind a closed port (F1)', () => {
  const api = useApiApp({
    database: db,
    config: {
      search: {
        // Port 9 (discard) is reserved and never accepts a connection — the
        // same address the harness gives every spec that does not want an
        // engine, spelled out here because it is the subject.
        host: 'http://127.0.0.1:9',
        masterKey: 'test-master-key',
        timeoutMs: 300,
        productsIndex: 'products_unreachable',
      },
    },
  })

  it.each([
    ['/search?sort=sales&limit=12', 'the home row that failed in production'],
    ['/search?q=코트', 'a typed query'],
    ['/search/suggest?q=코', 'autocomplete'],
  ])('answers %s with 503 · SEARCH_UNAVAILABLE — %s', async (path) => {
    const answer = await refusalFrom(api.baseUrl, path)

    expect(answer.status).toBe(503)
    expect(answer.code).toBe('SEARCH_UNAVAILABLE')
    // A sentence for a catalogue that has never heard of the code, and nothing
    // about which input was wrong: none was.
    expect(answer.message).not.toBe('')
    expect(answer.details).toEqual([])
  })

  it('answers a category page the same way, after reading its filters', async () => {
    const category = await createCategory(db, { name: '코트' })
    const answer = await refusalFrom(api.baseUrl, `/search?categoryId=${String(category.id)}`)

    expect(answer).toMatchObject({ status: 503, code: 'SEARCH_UNAVAILABLE' })
  })

  it('tells whatever sits in between not to keep the answer (R4)', async () => {
    // True for seconds. A proxy that stored it would go on saying "not ready"
    // to a screen that is polling to learn when that stops being so.
    const answer = await refusalFrom(api.baseUrl, '/search?limit=1')

    expect(answer.cacheControl).toBe('no-store')
  })

  /**
   * The third public path, and the reason it is not in the table above:
   * `filtersFor` reads `AttributeDefinition` from PostgreSQL and never asks the
   * engine. A sleeping engine is no reason to take the filter panel down with
   * the results — asserted so that a future change which routes it through the
   * engine has to come here and decide.
   */
  it('keeps answering /search/filters, which never asks the engine', async () => {
    const category = await createCategory(db, { name: '신발' })
    const answer = await api.client.request({
      path: `/search/filters?categoryId=${String(category.id)}`,
      schema: searchFiltersResponseSchema,
    })

    expect(answer.filters).toEqual([])
  })
})

describe('with an engine that answers', () => {
  /** What the local engine says next, to every request. */
  let reply: { status: number; contentType: string; body: string } = {
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }
  let heard = 0
  let engine: Server | null = null

  // Filled in once the engine is listening. `useApiApp` spreads `config`
  // shallowly, so the application reads the host from this same object — which
  // is what lets the port be one the OS picked rather than one this file
  // guessed.
  const search = {
    host: '',
    masterKey: 'a-key-the-engine-does-not-accept',
    timeoutMs: 1_000,
    productsIndex: 'products_refused',
  }

  // Registered before `useApiApp` so that it also runs before it.
  beforeAll(async () => {
    const server = createServer((_request, response) => {
      heard += 1
      response.writeHead(reply.status, { 'content-type': reply.contentType })
      response.end(reply.body)
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    engine = server
    search.host = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  })

  const api = useApiApp({ database: db, config: { search } })

  afterAll(async () => {
    engine?.closeAllConnections()
    await new Promise((resolve) => engine?.close(resolve))
  })

  /**
   * F3 — the negative control for everything above. A key mismatch is the
   * engine *speaking*, and no amount of waiting changes what it says. Answered
   * as 503 it would have a storefront politely retrying a broken deployment.
   */
  it('still answers 500 for a refusal the engine put a code on (F3)', async () => {
    reply = {
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'The provided API key is invalid.',
        code: 'invalid_api_key',
        type: 'auth',
      }),
    }

    const answer = await refusalFrom(api.baseUrl, '/search?limit=1')

    expect(answer).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', details: [] })
    expect(answer.cacheControl).toBeNull()
  })

  it.each([502, 503, 504])(
    'answers 503 when it is the gateway that says %i (F2, end to end)',
    async (status) => {
      reply = {
        status,
        contentType: 'text/html',
        body: '<!DOCTYPE html><title>Service waking up</title>',
      }

      const answer = await refusalFrom(api.baseUrl, '/search?limit=1')

      expect(answer).toMatchObject({ status: 503, code: 'SEARCH_UNAVAILABLE' })
    },
  )

  /**
   * TASK-0143 4.2. The query that failed is already the request that reached
   * the gateway, and that is what starts a sleeping service. A second one from
   * here — a wake-up, a retry — would be this API spending the free plan's
   * instance time on its own initiative.
   */
  it('sends the engine exactly one request per query, and none afterwards', async () => {
    reply = { status: 503, contentType: 'text/html', body: '<!DOCTYPE html>' }

    const before = heard

    await refusalFrom(api.baseUrl, '/search?limit=1')
    // Long enough for a fire-and-forget request to have arrived on loopback.
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(heard - before).toBe(1)
  })
})
