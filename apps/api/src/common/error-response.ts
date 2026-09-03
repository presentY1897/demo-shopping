import type { ServerResponse } from 'node:http'

import type { ApiErrorBody } from '@shopping/shared'

import { mappingForStatus } from './http-error-code.js'

export interface ErrorBodyInit {
  readonly status: number
  /**
   * The id `request-context.middleware.ts` put on the request and the response
   * header. Required rather than optional: an envelope without one is an error
   * nobody can look up, and an optional field is one every call site forgets.
   */
  readonly requestId: string
  readonly details?: readonly unknown[]
  /**
   * Code and sentence from a domain failure, when the thrower named one.
   *
   * Overrides what the status alone would say — which is the whole point of
   * TASK-0117: three different 409s stop being one `CONFLICT`.
   */
  readonly failure?: { readonly code: string; readonly message: string }
}

/** Builds the shared envelope. One place decides its shape. */
export function buildErrorBody({
  status,
  requestId,
  details = [],
  failure,
}: ErrorBodyInit): ApiErrorBody {
  const { code, message } = failure ?? mappingForStatus(status)

  return { error: { code, message, details: [...details], requestId } }
}

/**
 * Writes an error envelope on the raw response.
 *
 * Deliberately platform neutral (`node:http` rather than Express) so the same
 * code serves the exception filter and the terminal 404 handler, and so a later
 * switch of HTTP adapter does not silently change the error format.
 */
export function writeErrorResponse(
  response: ServerResponse,
  status: number,
  body: ApiErrorBody,
): void {
  // A streamed response cannot be rewritten; closing it is all that is left.
  if (response.headersSent) {
    response.end()
    return
  }

  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
