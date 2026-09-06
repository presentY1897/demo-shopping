/**
 * A stand-in for this app's `ApiClient`, for the routes `@shopping/api-mocks`
 * has no handlers for.
 *
 * ## Why this exists rather than an msw handler
 *
 * Every other screen in this console is driven through `@shopping/api-mocks`,
 * and that is the rule: TASK-0107 F3 says **no spec imports `msw` outside that
 * package**, and pnpm enforces it — `msw` is not a dependency of any app, so a
 * spec here cannot import `http` even if it wanted to.
 *
 * TASK-0082's three routes (`/seller-revenue`,
 * `/seller-settlement-outlook`, `/settlements`) have no handlers there yet, and
 * this branch does not own `packages/`. So the seam moves one layer up: instead
 * of intercepting the network, the specs replace `getApiClient` with a **real**
 * `createApiClient` whose `fetch` is this stub.
 *
 * What that keeps is the part that matters for gate C1 — **every answer is still
 * parsed by the contract schema the screen declared**, because the client doing
 * the parsing is the shipped one. A fixture that drifts from
 * `settlementListResponseSchema` fails here exactly as it would through msw, and
 * the fixtures themselves go through `defineFixture` for the same reason.
 *
 * What it loses is the network layer itself: headers, the app-id, and the URL
 * the client actually built. The URL is recovered — {@link apiRequests} records
 * every one — so a spec can still assert that `sellerId` was on the query and
 * that the cursor came back unchanged.
 *
 * **When handlers land in `@shopping/api-mocks`, delete this file** and move
 * these specs onto `testServer.server.use(...)` like every other screen.
 */

import type { ApiClient } from '@shopping/shared'
import { API_PATH_PREFIX, createApiClient, REQUEST_ID_HEADER } from '@shopping/shared'
import { apiErrorBody, MOCK_REQUEST_ID } from '@shopping/api-mocks'

/** What the stub does when a path is asked for. */
type Answer =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'resolved'; readonly status: number; readonly resolve: (url: URL) => unknown }
  | { readonly kind: 'network' }

const answers = new Map<string, Answer>()

const seen: string[] = []

/** The same origin the vitest preset gives the app. Unroutable by design. */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://api.test.invalid'

/** Every URL the client actually built, in order. Query strings included. */
export function apiRequests(): readonly string[] {
  return seen
}

/** The last URL asked for whose path is `path`, or `null`. */
export function lastRequestTo(path: string): string | null {
  const match = seen.filter((url) => new URL(url).pathname === `${API_PATH_PREFIX}${path}`).at(-1)

  return match ?? null
}

/** Answers `path` with `body`, parsed by whatever schema the caller declared. */
export function answerJson(path: string, body: unknown, status = 200): void {
  answers.set(path, { body, kind: 'json', status })
}

/** Answers `path` with a refusal in the shared envelope — a 403, a 404, a 500. */
export function answerFailure(path: string, status: number, code: string, message: string): void {
  answers.set(path, { body: apiErrorBody(code, message), kind: 'json', status })
}

/**
 * Answers `path` from the query string.
 *
 * What a stateful msw handler would do. The list screen needs it: a cursor only
 * means anything relative to the page that issued it, so a spec that pages
 * forward has to be able to answer the second request differently from the
 * first — and asserting that the cursor came back **unchanged** is the point of
 * that test.
 */
export function answerJsonBy(path: string, resolve: (url: URL) => unknown, status = 200): void {
  answers.set(path, { kind: 'resolved', resolve, status })
}

/** The API never answered: a stopped process, a DNS miss. */
export function answerNetworkFailure(path: string): void {
  answers.set(path, { kind: 'network' })
}

/**
 * Back to "nothing is stubbed".
 *
 * Called from each spec's `beforeEach`. An answer that survived into the next
 * test would make specs pass or fail by their order in the file, which is the
 * same reason `@shopping/api-mocks` resets its stores between tests.
 */
export function resetApiStub(): void {
  answers.clear()
  seen.length = 0
}

/**
 * The `fetch` the stub client is built with.
 *
 * Rejections rather than `throw` in an `async` function, which amount to the
 * same thing to the caller: the client's `try` around `doFetch` is what turns
 * either into an `ApiFailure` (`classifyTransportFailure`).
 */
function stubFetch(input: string, _init: RequestInit): Promise<Response> {
  seen.push(input)

  const url = new URL(input)
  const answer = answers.get(url.pathname.slice(API_PATH_PREFIX.length))

  // Unstubbed, deliberately loud. Silently answering 404 would turn "this spec
  // forgot a route" into "the screen renders its not-found copy", which reads
  // as a product bug.
  if (answer === undefined) {
    return Promise.reject(new TypeError(`No API stub for ${url.pathname}`))
  }
  // How a dead network reaches `fetch`.
  if (answer.kind === 'network') return Promise.reject(new TypeError('fetch failed'))

  const body = answer.kind === 'json' ? answer.body : answer.resolve(url)

  return Promise.resolve(
    Response.json(body, {
      headers: { [REQUEST_ID_HEADER]: MOCK_REQUEST_ID },
      status: answer.status,
    }),
  )
}

let client: ApiClient | null = null

/**
 * The client the mocked `@/lib/api` hands out.
 *
 * One instance for the whole spec file, like the app's own singleton — the
 * stub's state lives in this module rather than in the client, so nothing is
 * carried between tests by keeping it.
 */
export function stubApiClient(): ApiClient {
  client ??= createApiClient({ appId: 'seller', baseUrl: BASE_URL, fetch: stubFetch })

  return client
}
