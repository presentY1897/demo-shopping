import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, Inject, Logger } from '@nestjs/common'
import type { ApiErrorBody } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { buildErrorBody, writeErrorResponse } from './error-response.js'
import { REQUEST_ID_HEADER } from './request-context.middleware.js'

const INTERNAL_SERVER_ERROR = 500

function statusOf(exception: unknown): number {
  return exception instanceof HttpException ? exception.getStatus() : INTERNAL_SERVER_ERROR
}

/**
 * Pulls the caller-facing part of an exception payload.
 *
 * Only strings are copied. Nest and future validation pipes put arbitrary
 * objects in there, and an error envelope that forwards them unfiltered is how
 * internals end up in a browser's network tab.
 */
function detailsOf(exception: unknown): unknown[] {
  if (!(exception instanceof HttpException)) return []

  const payload: unknown = exception.getResponse()
  if (typeof payload === 'string') return payload === '' ? [] : [payload]
  if (typeof payload !== 'object' || payload === null || !('message' in payload)) return []

  const { message } = payload
  if (Array.isArray(message)) return message.filter((entry) => typeof entry === 'string')

  return typeof message === 'string' && message !== '' ? [message] : []
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers[name]
  return Array.isArray(header) ? header[0] : header
}

/**
 * Converts every uncaught exception into the shared error envelope.
 *
 * Registered with `APP_FILTER`, so it also handles the framework's own 404 and
 * anything thrown outside a controller. There is no second, narrower filter: one
 * response shape means clients need exactly one error branch.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP')

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<IncomingMessage>()
    const response = http.getResponse<ServerResponse>()

    const status = statusOf(exception)
    const body = this.buildBody(exception, status)

    this.log(exception, status, request)
    writeErrorResponse(response, status, body)
  }

  /** Full context stays server side; the client gets the envelope only. */
  private log(exception: unknown, status: number, request: IncomingMessage): void {
    const requestId = headerValue(request, REQUEST_ID_HEADER) ?? '-'
    const line = `${request.method ?? '-'} ${request.url ?? '-'} ${status} ${requestId}`

    if (status >= INTERNAL_SERVER_ERROR) {
      this.logger.error(line, exception instanceof Error ? exception.stack : undefined)
    } else {
      this.logger.warn(`${line} ${describe(exception)}`)
    }
  }

  private buildBody(exception: unknown, status: number): ApiErrorBody {
    const details = detailsOf(exception)

    if (
      this.shouldExposeStack(status) &&
      exception instanceof Error &&
      exception.stack !== undefined
    ) {
      details.push({ stack: exception.stack.split('\n') })
    }

    return buildErrorBody(status, details)
  }

  /** Never outside local development, and never for a client error. */
  private shouldExposeStack(status: number): boolean {
    return this.config.nodeEnv === 'development' && status >= INTERNAL_SERVER_ERROR
  }
}

function describe(exception: unknown): string {
  if (exception instanceof HttpException) return exception.constructor.name
  return exception instanceof Error ? exception.name : 'UnknownException'
}
