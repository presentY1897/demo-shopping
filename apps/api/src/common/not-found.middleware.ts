import type { IncomingMessage, ServerResponse } from 'node:http'

import { buildErrorBody, writeErrorResponse } from './error-response.js'

const NOT_FOUND = 404

/**
 * Terminal handler for requests that match nothing.
 *
 * Nest mounts its own 404 handler *under* the global prefix, so a request to a
 * path outside `/api` would fall through to Express's HTML error page — a
 * second error format, carrying the framework's own branding, that every client
 * would have to be prepared to parse.
 *
 * Must be registered after `app.init()` so that it sits behind every real route.
 */
export function createNotFoundFallback() {
  return function notFoundFallback(request: IncomingMessage, response: ServerResponse): void {
    const details = [`Cannot ${request.method ?? '-'} ${request.url ?? '-'}`]

    writeErrorResponse(response, NOT_FOUND, buildErrorBody(NOT_FOUND, details))
  }
}
