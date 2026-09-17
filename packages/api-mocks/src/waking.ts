import { searchResponseSchema, searchSuggestResponseSchema } from '@shopping/shared'
import type { JsonBodyType, RequestHandler } from 'msw'
import { delay, http, HttpResponse } from 'msw'

import { defineFixture } from './define'
import { apiErrorBody, mockResponseHeaders } from './failures'
import { healthDegraded, healthOk, healthSearchIndexing } from './fixtures/health'
import type { MockMethod, MockPath } from './paths'
import { mockPaths } from './paths'

/**
 * A cold API, as a front-end spec can hold it still and look at it.
 *
 * The deployed API sleeps after 15 minutes and takes about 90 seconds to answer
 * the first request after that (TASK-0101 4.1). None of these helpers wait that
 * long: the wake-up policy is a value the component takes, so a spec hands it
 * millisecond thresholds and reproduces the same sequence in a fraction of a
 * second. What is being checked is the *order of events*, not the clock.
 *
 * The real numbers are pinned separately, by asserting on the policy constant
 * itself — a check that cannot be made to pass by a slow machine.
 */

/**
 * Answers `path` only after `ms`, with a normal 200.
 *
 * This is the shape of a slow wake-up: nothing is broken, the answer is just
 * late. It is what the delay notice has to appear on top of.
 */
export function slowResponse(path: MockPath, ms: number, body: JsonBodyType): RequestHandler {
  return http.get(path, async () => {
    await delay(ms)
    return HttpResponse.json(body)
  })
}

/**
 * Never answers `path`.
 *
 * The caller's own deadline is what ends the request, which is precisely the
 * failure a sleeping instance produces when the wait is capped too low.
 */
export function neverAnswers(path: MockPath): RequestHandler {
  return neverAnswersOn('get', path)
}

/**
 * {@link neverAnswers} for a verb other than `GET`.
 *
 * A mutation that never answers is how a spec holds a screen still *during* a
 * request: an optimistic update has already been drawn and the response that
 * would confirm or undo it has not arrived, which is the only window in which
 * "즉시 반영" can be observed at all.
 */
export function neverAnswersOn(method: MockMethod, path: MockPath): RequestHandler {
  return http[method](path, async () => {
    await delay('infinite')
  })
}

/**
 * Fails the first `coldAttempts` requests, then answers normally.
 *
 * The recovery case: the visitor does nothing, the retry loop keeps going, and
 * the instance finishes booting between two attempts. A transport error stands
 * in for the wait so the spec stays instant — from the caller's side an aborted
 * deadline and an unreachable host arrive as the same thing, a request with no
 * response.
 */
export function wakesAfter(
  path: MockPath,
  coldAttempts: number,
  body: JsonBodyType,
): RequestHandler {
  let seen = 0

  return http.get(path, () => {
    seen += 1
    return seen <= coldAttempts ? HttpResponse.error() : HttpResponse.json(body)
  })
}

/**
 * An instance that is asleep and boots once, **as measured against Render**.
 *
 * The first request starts the instance and is **refused immediately** — the
 * platform edge answers 502 with its own HTML page while the container boots,
 * and keeps doing so until the health check passes. Every request that lands in
 * that window gets the same instant refusal. Then the instance is up and answers
 * normally.
 *
 * ```
 * t=0      first request  → 502 in ~0.3s, boot starts
 * t=…      more requests  → 502, each in ~0.3s
 * t=boot   the edge starts routing → 200
 * ```
 *
 * **This is the second model this helper has had, and the first one was wrong.**
 * It held requests open until the instance answered — see
 * {@link heldRequestInstance}, which keeps that behaviour — and a retry policy
 * that budgets by *attempt* passes against it while failing in production: three
 * attempts against a held request spend their full deadlines, three attempts
 * against an instant 502 spend about a second between them (TASK-0118 4.1).
 *
 * The clock starts on the first request, exactly as the spin-up does — and it
 * is the **monotonic** clock. `Date.now()` is corrected underneath a running
 * test, and a boot timed on it ends late by however much the system clock was
 * stepped back meanwhile: the 90 second replay came up at 103s on such a
 * machine, where the schedule says 95 (TASK-0118 6.3).
 */
export function sleepingInstance(
  path: MockPath,
  wakesAfterMs: number,
  body: JsonBodyType,
): RequestHandler {
  let readyAt: number | null = null

  // Not `async`: the refusal is what this helper is *for*, and it involves no
  // waiting at all — which is exactly the difference from the model it replaced.
  return http.get(path, () => {
    readyAt ??= performance.now() + wakesAfterMs

    // **A transport failure, not a 502 — and the difference is the browser.**
    //
    // On the wire the edge answers 502 with its own HTML page. That page carries
    // no `Access-Control-Allow-Origin`, so the browser rejects it before the app
    // sees anything: `fetch` throws and the console reports a CORS violation
    // (TASK-0118 4.2). Modelling the 502 itself would be *less* faithful here —
    // these specs drive a browser app, and a browser never receives it.
    //
    // It matters which one the double produces: a 502 body reaching the client
    // classifies as `malformed_response`, which the wake-up loop treats as final
    // and does not retry (TASK-0118 R8).
    if (performance.now() < readyAt) return HttpResponse.error()

    return HttpResponse.json(body)
  })
}

/**
 * A sleeping instance that **holds** the request until it is up.
 *
 * The model {@link sleepingInstance} used to have, kept because a platform may
 * behave this way — the deadline is shared, so a caller that gives up and asks
 * again joins a wait already in progress rather than restarting it.
 *
 * **A wake-up policy has to survive both.** Which one a deployment gets is not
 * something the front end can choose, and the replay runs against each
 * (TASK-0118 4.6).
 */
export function heldRequestInstance(
  path: MockPath,
  wakesAfterMs: number,
  body: JsonBodyType,
): RequestHandler {
  let readyAt: number | null = null

  return http.get(path, async () => {
    readyAt ??= performance.now() + wakesAfterMs

    const remaining = readyAt - performance.now()
    if (remaining > 0) await delay(remaining)

    return HttpResponse.json(body)
  })
}

/**
 * How the API answers a search it could not take to the engine (TASK-0143 4.1).
 *
 * 503 and a domain code, in the ordinary envelope. The code is what a screen
 * reads: `SEARCH_UNAVAILABLE` means "wait and ask again", which the 500 this
 * used to be could not say.
 */
function searchUnavailable(): Response {
  return HttpResponse.json(
    apiErrorBody('SEARCH_UNAVAILABLE', '검색을 준비하고 있어요. 잠시 후 다시 시도해 주세요.'),
    { status: 503, headers: mockResponseHeaders },
  )
}

/** What an engine that is up says before its index has been rebuilt. */
const NOTHING_INDEXED = defineFixture(searchResponseSchema, {
  items: [],
  facets: {},
  total: 0,
  nextCursor: null,
})

const NOTHING_TO_SUGGEST = defineFixture(searchSuggestResponseSchema, { suggestions: [] })

/** An unreachable engine, with the counts a spec needs to bound what a screen asked. */
export interface UnreachableSearchEngine {
  /** `/health`, `/search` and `/search/suggest` — hand them to `server.use` together. */
  readonly handlers: readonly RequestHandler[]
  /** Health answers given so far. The number TASK-0143 F8 caps at 21. */
  readonly healthRequests: () => number
  /** `/search` and `/search/suggest` requests taken so far, refused or not. */
  readonly searchRequests: () => number
}

/**
 * An API that is awake beside a search engine that is not — and the engine
 * coming back, **as observed in production on 2026-09-17** (TASK-0143 1장).
 *
 * The engine is its own free service: it sleeps on its own and, having no disk,
 * restarts empty. Meanwhile the API answers everything that does not need it.
 *
 * ```
 * health 1 … downChecks          → 200, search: "down"      /search → 503 SEARCH_UNAVAILABLE
 * the next `indexingChecks`      → 200, search: "degraded"  /search → 200, nothing indexed yet
 * every health answer after that → 200, search: "ok"        /search → the catalogue
 * ```
 *
 * **The engine comes back on a health check, not on a clock.** That is how it
 * happens — the API's health indicator probes the engine, and a request reaching
 * the platform's gateway is what starts a sleeping service (TASK-0143 4.2) — and
 * it is also what lets a spec say "from the third check" and mean exactly that,
 * on any machine. What is being checked is the order of events.
 *
 * The middle phase is R2: `search: "degraded"` while the index is rebuilt, and a
 * search in that window answers **zero results rather than an error**. A screen
 * that took that for an empty catalogue passes against a double without it.
 *
 * `/search/filters` is not here. The filter definitions come from the database,
 * so that route keeps answering while the engine is away.
 *
 * Once the engine is back the search routes return nothing, which hands the
 * request to the next handler — the catalogue in `handlers/search.ts`. This
 * double has no second idea of what a result looks like.
 *
 * `downChecks: Infinity` is an engine that never returns.
 */
export function unreachableSearchEngine({
  downChecks,
  indexingChecks = 0,
}: {
  readonly downChecks: number
  readonly indexingChecks?: number
}): UnreachableSearchEngine {
  let healthSeen = 0
  let searchSeen = 0

  function phaseAt(check: number): 'down' | 'indexing' | 'ok' {
    if (check <= downChecks) return 'down'
    if (check <= downChecks + indexingChecks) return 'indexing'

    return 'ok'
  }

  // A search that lands before anybody has asked for health sees what the first
  // health answer is about to report — the engine's state does not wait for an
  // observer.
  const phaseNow = (): 'down' | 'indexing' | 'ok' => phaseAt(Math.max(healthSeen, 1))

  const HEALTH = { down: healthDegraded, indexing: healthSearchIndexing, ok: healthOk } as const

  return {
    handlers: [
      http.get(mockPaths.health, () => {
        healthSeen += 1

        return HttpResponse.json(HEALTH[phaseAt(healthSeen)])
      }),
      http.get(mockPaths.search, () => {
        searchSeen += 1
        const phase = phaseNow()

        if (phase === 'down') return searchUnavailable()
        if (phase === 'indexing') return HttpResponse.json(NOTHING_INDEXED)

        return undefined
      }),
      http.get(mockPaths.searchSuggest, () => {
        searchSeen += 1
        const phase = phaseNow()

        if (phase === 'down') return searchUnavailable()
        if (phase === 'indexing') return HttpResponse.json(NOTHING_TO_SUGGEST)

        return undefined
      }),
    ],
    healthRequests: () => healthSeen,
    searchRequests: () => searchSeen,
  }
}

/**
 * Refuses the first `refusals` requests to a search route with 503
 * `SEARCH_UNAVAILABLE`, then steps aside for the catalogue.
 *
 * {@link unreachableSearchEngine} for a screen that never asks for health. The
 * results screen has no wake-up gate: the search it just sent *is* the request
 * that reached the engine's gateway, and asking again is how it finds out the
 * engine is up. `Infinity` never recovers.
 */
export function searchUnavailableFor(path: MockPath, refusals: number): RequestHandler {
  let seen = 0

  return http.get(path, () => {
    seen += 1

    return seen <= refusals ? searchUnavailable() : undefined
  })
}
