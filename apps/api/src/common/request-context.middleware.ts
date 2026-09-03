import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { LoggerService } from '@nestjs/common'
import { REQUEST_ID_HEADER } from '@shopping/shared'

export { REQUEST_ID_HEADER }

/** Header values reach `setHeader` verbatim, so anything exotic is discarded. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

function incomingRequestId(request: IncomingMessage): string | null {
  const header = request.headers[REQUEST_ID_HEADER]
  const value = Array.isArray(header) ? header[0] : header

  return value !== undefined && SAFE_REQUEST_ID.test(value) ? value : null
}

/**
 * The id this request is known by, everywhere.
 *
 * Exported because the exception filter needs the same value the middleware
 * wrote — the number a person reads off the screen has to be the number in the
 * log line, or the number is decoration (TASK-0117 F6). Falls back to a fresh
 * id for a request that somehow reached a handler without passing through the
 * middleware, so that the envelope's `requestId` is never a placeholder.
 */
export function requestIdOf(request: IncomingMessage): string {
  const existing = incomingRequestId(request)

  if (existing !== null) return existing

  const generated = randomUUID()
  request.headers[REQUEST_ID_HEADER] = generated

  return generated
}

/**
 * Gives every request an id and logs how it ended.
 *
 * This is middleware rather than an interceptor because interceptors only run
 * once a route has matched: a 404, which is precisely the request someone is
 * trying to explain, would otherwise never be logged and would come back
 * without a correlation id.
 */
export function createRequestContextMiddleware(logger: LoggerService) {
  return function requestContext(
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void {
    const requestId = requestIdOf(request)
    response.setHeader(REQUEST_ID_HEADER, requestId)

    const startedAt = process.hrtime.bigint()

    response.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      const line = `${request.method ?? '-'} ${request.url ?? '-'} ${response.statusCode} ${elapsedMs.toFixed(1)}ms ${requestId}`

      if (response.statusCode >= 500) logger.error(line)
      else logger.log(line)
    })

    next()
  }
}
