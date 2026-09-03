import type { ApiErrorBody } from '@shopping/shared'
import { apiErrorSchema } from '@shopping/shared'
import type { JsonBodyType, RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from './define'
import type { MockMethod, MockPath } from './paths'

/**
 * The shared error envelope, built through the schema like any other fixture.
 *
 * Failure bodies are still contract: a screen that reads `error.code` breaks the
 * same way whether the envelope drifted in a success path or an error one.
 */
export function apiErrorBody(
  code: string,
  message: string,
  /**
   * What the API puts beside the generic message: `AllExceptionsFilter` copies
   * the thrown exception's own text here, which is the only place a caller can
   * read *why* a 409 happened — the `code` is derived from the status alone.
   */
  details: readonly string[] = [],
): ApiErrorBody {
  return defineFixture(apiErrorSchema, { error: { code, message, details: [...details] } })
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
  details: readonly string[] = [],
): RequestHandler {
  return http[method](path, () =>
    HttpResponse.json(apiErrorBody(code, message, details), { status }),
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
