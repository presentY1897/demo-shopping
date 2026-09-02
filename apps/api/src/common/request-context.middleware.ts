import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { LoggerService } from '@nestjs/common'

export const REQUEST_ID_HEADER = 'x-request-id'

/** Header values reach `setHeader` verbatim, so anything exotic is discarded. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

function incomingRequestId(request: IncomingMessage): string | null {
  const header = request.headers[REQUEST_ID_HEADER]
  const value = Array.isArray(header) ? header[0] : header

  return value !== undefined && SAFE_REQUEST_ID.test(value) ? value : null
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
    const requestId = incomingRequestId(request) ?? randomUUID()
    request.headers[REQUEST_ID_HEADER] = requestId
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
