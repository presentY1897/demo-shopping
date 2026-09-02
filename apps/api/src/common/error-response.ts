import type { ServerResponse } from 'node:http'

import type { ApiErrorBody } from '@shopping/shared'

import { mappingForStatus } from './http-error-code.js'

/** Builds the shared envelope for a status. One place decides its shape. */
export function buildErrorBody(status: number, details: unknown[] = []): ApiErrorBody {
  const { code, message } = mappingForStatus(status)

  return { error: { code, message, details } }
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
