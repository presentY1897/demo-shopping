import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, Inject, Logger } from '@nestjs/common'
import type { ApiErrorBody } from '@shopping/shared'
import { isApiFieldError } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { DomainFailurePayload } from './domain-failure.js'
import { domainFailureOf } from './domain-failure.js'
import { buildErrorBody, writeErrorResponse } from './error-response.js'
import { requestIdOf } from './request-context.middleware.js'

const INTERNAL_SERVER_ERROR = 500

function statusOf(exception: unknown): number {
  return exception instanceof HttpException ? exception.getStatus() : INTERNAL_SERVER_ERROR
}

/** The payload a domain module named, or `null` for every other throw. */
function failureOf(exception: unknown): DomainFailurePayload | null {
  return exception instanceof HttpException ? domainFailureOf(exception.getResponse()) : null
}

/**
 * Pulls the caller-facing part of an exception payload.
 *
 * Two shapes are copied and nothing else: a plain string, and an entry that
 * validates as `apiFieldError`. Nest and future validation pipes put arbitrary
 * objects in there, and an error envelope that forwarded them unfiltered is how
 * internals end up in a browser's network tab — so the field-error shape is
 * admitted by *parsing* it, not by testing for a property.
 */
function detailsOf(exception: unknown): unknown[] {
  if (!(exception instanceof HttpException)) return []

  const payload: unknown = exception.getResponse()
  if (typeof payload === 'string') return payload === '' ? [] : [payload]
  if (typeof payload !== 'object' || payload === null) return []

  const failure = domainFailureOf(payload)
  if (failure !== null) return [...failure.details]

  if (!('message' in payload)) return []

  const { message } = payload
  if (Array.isArray(message)) {
    return message.filter((entry) => typeof entry === 'string' || isApiFieldError(entry))
  }

  return typeof message === 'string' && message !== '' ? [message] : []
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
    // Read once and reuse: the id in the body has to be the id in the log, or
    // the number a person quotes finds nothing (F6).
    const requestId = requestIdOf(request)
    const body = this.buildBody(exception, status, requestId)

    this.log(exception, status, request, requestId)
    writeErrorResponse(response, status, body)
  }

  /** Full context stays server side; the client gets the envelope only. */
  private log(
    exception: unknown,
    status: number,
    request: IncomingMessage,
    requestId: string,
  ): void {
    const line = `${request.method ?? '-'} ${request.url ?? '-'} ${status} ${requestId}`

    if (status >= INTERNAL_SERVER_ERROR) {
      // The sentence a 500 refuses to send the caller belongs here, where the
      // person debugging it can read it (TASK-0117 4.3).
      this.logger.error(`${line} ${describe(exception)}`, stackOf(exception))
    } else {
      this.logger.warn(`${line} ${describe(exception)}`)
    }
  }

  private buildBody(exception: unknown, status: number, requestId: string): ApiErrorBody {
    // A 500 tells the caller nothing about itself. Not a precaution about
    // *these* exceptions — a plain `throw` is not an `HttpException` and never
    // reached `details` anyway — but about the next deliberate one: `new
    // InternalServerErrorException('엔드포인트에 퍼미션이 선언되지 않았습니다.')`
    // would otherwise ship the reason straight to the browser (F8, J4).
    //
    // Exactly 500, not every 5xx. A 503 is a state, not a defect: "이미지
    // 저장소가 설정되지 않아…" is the honest answer to a caller who can do
    // nothing else with it, and emptying it would replace an explanation with a
    // shrug.
    const details = status === INTERNAL_SERVER_ERROR ? [] : detailsOf(exception)
    const failure = failureOf(exception)

    if (
      this.shouldExposeStack(status) &&
      exception instanceof Error &&
      exception.stack !== undefined
    ) {
      details.push({ stack: exception.stack.split('\n') })
    }

    return buildErrorBody({
      status,
      requestId,
      details,
      ...(failure === null ? {} : { failure }),
    })
  }

  /** Never outside local development, and never for a client error. */
  private shouldExposeStack(status: number): boolean {
    return this.config.nodeEnv === 'development' && status >= INTERNAL_SERVER_ERROR
  }
}

/**
 * What went wrong, for the log.
 *
 * An `HttpException` is named by its class and by whatever it was thrown with:
 * a domain failure's sentence, or Nest's own. Both are safe here — this string
 * never reaches a response.
 */
function describe(exception: unknown): string {
  if (exception instanceof HttpException) {
    const failure = domainFailureOf(exception.getResponse())
    const named = failure === null ? '' : ` ${failure.code} ${failure.message}`

    return `${exception.constructor.name}${named}`
  }
  if (exception instanceof Error) return `${exception.name}: ${exception.message}`

  return 'UnknownException'
}

function stackOf(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined
}
