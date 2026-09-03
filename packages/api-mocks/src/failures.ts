import type { ApiErrorBody } from '@shopping/shared'
import { apiErrorSchema, REQUEST_ID_HEADER } from '@shopping/shared'
import type { JsonBodyType, RequestHandler } from 'msw'
import { delay, http, HttpResponse } from 'msw'

import { defineFixture } from './define'
import type { MockMethod, MockPath } from './paths'

/**
 * The correlation id every mocked failure carries.
 *
 * Fixed rather than random: a screen that shows it can then be asserted against
 * a literal, which is what makes "the number the user is asked to quote is the
 * number the API sent" checkable instead of merely plausible. The real API
 * issues a fresh UUID per request; nothing a screen does depends on that.
 */
export const MOCK_REQUEST_ID = '0192f0c1-4e2b-7a10-9c33-8f2b6d0a41c7'

/** Headers the real API puts on every response, mocked responses included. */
export const mockResponseHeaders = { [REQUEST_ID_HEADER]: MOCK_REQUEST_ID }

/**
 * The shared error envelope, built through the schema like any other fixture.
 *
 * Failure bodies are still contract: a screen that reads `error.code` breaks the
 * same way whether the envelope drifted in a success path or an error one — and
 * since TASK-0117 there is more of it to drift, because `details` may now carry
 * `{ field, message, code }` objects beside the plain strings.
 */
export function apiErrorBody(
  code: string,
  message: string,
  /**
   * What the API puts beside the envelope's own sentence: one entry per input
   * that failed, or a plain string for a refusal that names no input. Both
   * shapes on purpose — endpoints adopt codes one at a time (TASK-0117 R4).
   */
  details: readonly unknown[] = [],
  requestId: string = MOCK_REQUEST_ID,
): ApiErrorBody {
  return defineFixture(apiErrorSchema, {
    error: { code, message, details: [...details], requestId },
  })
}

/** Answers `path` with a non-2xx status and a well formed envelope. */
export function httpFailure(path: MockPath, status: number, code: string, message: string) {
  return httpFailureOn('get', path, status, code, message)
}

/**
 * The same, for a verb other than `GET`.
 *
 * Mutations are where a screen meets 409 and 400, and a helper that could only
 * build a failing `GET` meant every such spec reached for `http.post` directly —
 * which is the "no `msw` import outside this package" rule (TASK-0107 F3) worn
 * away one spec at a time.
 */
export function httpFailureOn(
  method: MockMethod,
  path: MockPath,
  status: number,
  code: string,
  message: string,
  details: readonly unknown[] = [],
): RequestHandler {
  return http[method](path, () =>
    HttpResponse.json(apiErrorBody(code, message, details), {
      status,
      headers: mockResponseHeaders,
    }),
  )
}

/**
 * Answers `path` with a transport failure — the API is unreachable, the way a
 * stopped process or a DNS miss looks to `fetch`.
 */
export function networkFailure(path: MockPath): RequestHandler {
  return networkFailureOn('get', path)
}

/** {@link networkFailure} for a verb other than `GET`. */
export function networkFailureOn(method: MockMethod, path: MockPath): RequestHandler {
  return http[method](path, () => HttpResponse.error())
}

/**
 * Fails, but only after `ms`.
 *
 * The delay is the point. A screen that draws an optimistic frame and undoes it
 * on failure would, against an instant failure, finish both inside one `await` —
 * and a spec could then never tell "it moved and came back" from "it never
 * moved". Holding the failure open leaves the optimistic frame observable.
 */
export function networkFailureAfterOn(
  method: MockMethod,
  path: MockPath,
  ms: number,
): RequestHandler {
  return http[method](path, async () => {
    await delay(ms)

    return HttpResponse.error()
  })
}

/**
 * Answers `path` with 200 and a body that does not match its schema.
 *
 * **The one place in this package where response data does not go through
 * `defineFixture`**, which is why it lives in this file and not in `fixtures/`:
 * the value has to be wrong for the test to mean anything. `registry.spec.ts`
 * scans `fixtures/` only, so this exception cannot spread.
 */
export function malformedResponse(path: MockPath, body: JsonBodyType): RequestHandler {
  return http.get(path, () => HttpResponse.json(body))
}

/**
 * A health payload after the drift QUALITY-GATES 5장 describes: the API renamed
 * `database` to `db` and nobody followed. Deliberately not a fixture.
 *
 * Used from both sides of the contract — the client spec here proves the rename
 * surfaces as `malformed_response`, and the app specs prove the screen says so.
 */
export const driftedHealthPayload = {
  status: 'ok',
  db: 'ok',
  search: 'ok',
  uptime: 12,
  version: '0.0.0',
}
