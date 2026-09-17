/**
 * The unreachable search engine, checked against the same client the apps use
 * (TASK-0143 4.3).
 *
 * The shop specs built on this double assert that a screen *waits* — no alert,
 * no button, and then products. A double that answered the catalogue a check
 * early, or refused in some shape the client does not read as
 * `SEARCH_UNAVAILABLE`, would turn every one of them into a spec of a healthy
 * API, and nothing inside those specs would say so.
 */

import {
  apiFailure,
  createApiClient,
  searchFiltersResponseSchema,
  searchResponseSchema,
  searchSuggestResponseSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { MOCK_REQUEST_ID } from './failures'
import { setupTestServer } from './node'
import { mockPaths } from './paths'
import { searchUnavailableFor, unreachableSearchEngine } from './waking'

const testServer = setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

const search = () => client.request({ path: '/search?limit=5', schema: searchResponseSchema })
const suggest = () =>
  client.request({ path: '/search/suggest?q=코트', schema: searchSuggestResponseSchema })

/** The failure as a screen would read it, or `null` when the call worked. */
async function refusalOf(call: Promise<unknown>) {
  return call.then(
    () => null,
    (error: unknown) => apiFailure(error),
  )
}

const UNAVAILABLE = {
  kind: 'http',
  status: 503,
  code: 'SEARCH_UNAVAILABLE',
  message: '검색을 준비하고 있어요. 잠시 후 다시 시도해 주세요.',
  details: [],
  requestId: MOCK_REQUEST_ID,
}

describe('unreachableSearchEngine', () => {
  it('keeps the API healthy while it reports the engine down, for the stated checks', async () => {
    const engine = unreachableSearchEngine({ downChecks: 2 })
    testServer.server.use(...engine.handlers)

    // 200 with `degraded`, never a failure: the process is serving, and that is
    // exactly what a wake-up loop used to take for "done".
    await expect(client.getHealth()).resolves.toMatchObject({ status: 'degraded', search: 'down' })
    await expect(client.getHealth()).resolves.toMatchObject({ database: 'ok', search: 'down' })
    await expect(client.getHealth()).resolves.toMatchObject({ status: 'ok', search: 'ok' })
  })

  it('refuses a search with 503 and the domain code while the engine is down', async () => {
    const engine = unreachableSearchEngine({ downChecks: 1 })
    testServer.server.use(...engine.handlers)

    expect(await refusalOf(search())).toEqual(UNAVAILABLE)
    expect(await refusalOf(suggest())).toEqual(UNAVAILABLE)
  })

  it('goes on refusing between health checks, not only on them', async () => {
    const engine = unreachableSearchEngine({ downChecks: 2 })
    testServer.server.use(...engine.handlers)

    await client.getHealth()

    expect(await refusalOf(search())).toEqual(UNAVAILABLE)
    expect(await refusalOf(search())).toEqual(UNAVAILABLE)
  })

  it('hands the search back to the catalogue from the check that says ok', async () => {
    const engine = unreachableSearchEngine({ downChecks: 1 })
    testServer.server.use(...engine.handlers)

    await client.getHealth()
    expect(await refusalOf(search())).toEqual(UNAVAILABLE)

    await client.getHealth()
    const answer = await search()

    expect(answer.items.length).toBeGreaterThan(0)
    expect((await suggest()).suggestions.length).toBeGreaterThan(0)
  })

  /**
   * R2 — the engine has no disk, so it comes back empty. Health says `degraded`
   * until the index is rebuilt, and a search in that window is **zero results,
   * not a refusal**. A home row that believed it would say 「상품이 없습니다」.
   */
  it('answers nothing, rather than an error, while the index is rebuilt', async () => {
    const engine = unreachableSearchEngine({ downChecks: 1, indexingChecks: 1 })
    testServer.server.use(...engine.handlers)

    await client.getHealth()
    await expect(client.getHealth()).resolves.toMatchObject({
      status: 'degraded',
      search: 'degraded',
    })

    await expect(search()).resolves.toEqual({ items: [], facets: {}, total: 0, nextCursor: null })
    await expect(suggest()).resolves.toEqual({ suggestions: [] })

    await expect(client.getHealth()).resolves.toMatchObject({ search: 'ok' })
    expect((await search()).items.length).toBeGreaterThan(0)
  })

  it('leaves the filter definitions alone — they come from the database', async () => {
    const engine = unreachableSearchEngine({ downChecks: Number.POSITIVE_INFINITY })
    testServer.server.use(...engine.handlers)

    const answer = await client.request({
      path: '/search/filters',
      schema: searchFiltersResponseSchema,
    })

    expect(Array.isArray(answer.filters)).toBe(true)
  })

  it('never comes back when told not to', async () => {
    const engine = unreachableSearchEngine({ downChecks: Number.POSITIVE_INFINITY })
    testServer.server.use(...engine.handlers)

    for (let check = 0; check < 25; check += 1) {
      await expect(client.getHealth()).resolves.toMatchObject({ search: 'down' })
    }

    expect(await refusalOf(search())).toEqual(UNAVAILABLE)
  })

  it('counts what it was asked, which is how a spec bounds a screen', async () => {
    const engine = unreachableSearchEngine({ downChecks: 1 })
    testServer.server.use(...engine.handlers)

    expect(engine.healthRequests()).toBe(0)
    expect(engine.searchRequests()).toBe(0)

    await client.getHealth()
    await client.getHealth()
    await refusalOf(search())
    await suggest()

    expect(engine.healthRequests()).toBe(2)
    expect(engine.searchRequests()).toBe(2)
  })

  it('counts per scenario, so a second one starts down again', async () => {
    const first = unreachableSearchEngine({ downChecks: 1 })
    testServer.server.use(...first.handlers)
    await client.getHealth()
    await expect(client.getHealth()).resolves.toMatchObject({ search: 'ok' })

    const second = unreachableSearchEngine({ downChecks: 1 })
    testServer.server.use(...second.handlers)

    await expect(client.getHealth()).resolves.toMatchObject({ search: 'down' })
    expect(second.healthRequests()).toBe(1)
    expect(first.healthRequests()).toBe(2)
  })
})

describe('searchUnavailableFor', () => {
  it('refuses the stated number of searches and then answers the catalogue', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.search, 2))

    expect(await refusalOf(search())).toEqual(UNAVAILABLE)
    expect(await refusalOf(search())).toEqual(UNAVAILABLE)
    expect((await search()).items.length).toBeGreaterThan(0)
  })

  it('refuses only the route it was given', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.searchSuggest, 1))

    expect((await search()).items.length).toBeGreaterThan(0)
    expect(await refusalOf(suggest())).toEqual(UNAVAILABLE)
  })
})
