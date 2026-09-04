import { isApiClientError } from '@shopping/shared'

import { ApiConfigurationError } from '@/lib/api'
import type { ErrorMessages } from '@/lib/errors'
import { errorMessage } from '@/lib/errors'

/**
 * A failed API call, as a value a screen can render (TASK-0117 4.1).
 *
 * **`apps/admin/src/lib/api-failure.ts` is the twin of this file**, and the
 * duplication is deliberate rather than overlooked. The two differ in one
 * import — each app's own `ApiConfigurationError` — and the honest fix is to
 * lift both into a place both can import. That change has to edit `apps/admin`,
 * which this branch does not own (TASK-0033 4.9), and shipping a half-move
 * would leave the shared copy and the admin copy free to disagree. So: one more
 * copy now, one removal later, recorded here so the later one is findable.
 *
 * This version carries no `params` interpolation. See `lib/errors.ts`.
 */

/**
 * Every way a call can fail **before the API answers**.
 *
 * Deliberately short. A refusal that arrived carries `error.code`, and the
 * vocabulary for those is `domainErrorCodes` in `@shopping/shared`. What is left
 * here is the set of failures where there is no answer to read.
 */
export const apiFailureReasons = [
  'network',
  'timeout',
  'aborted',
  'malformed_response',
  'configuration',
  'unknown',
] as const

export type ApiFailureReason = (typeof apiFailureReasons)[number]

/**
 * The two shapes a screen has to treat differently.
 *
 * `transport` — nothing arrived. No code, no field, no request id, and the only
 * honest thing to say is that the request did not get through.
 *
 * `http` — the API answered and said what happened.
 */
export type ApiFailure =
  | { readonly kind: 'transport'; readonly reason: ApiFailureReason }
  | {
      readonly kind: 'http'
      readonly status: number
      readonly code: string
      /** The server's own sentence — the last resort for an unknown code. */
      readonly message: string
      readonly details: readonly unknown[]
      readonly requestId: string | null
    }

/** Turns anything thrown by an API call into a value a screen can render. */
export function apiFailure(error: unknown): ApiFailure {
  if (error instanceof ApiConfigurationError) return { kind: 'transport', reason: 'configuration' }
  if (!isApiClientError(error)) return { kind: 'transport', reason: 'unknown' }

  const body = error.body

  // `http` without a parsed envelope is a response we could not read — a proxy's
  // HTML error page, say. There is no code to branch on, so it is transport.
  if (error.kind !== 'http' || body === undefined) {
    return { kind: 'transport', reason: error.kind === 'http' ? 'malformed_response' : error.kind }
  }

  return {
    code: body.error.code,
    details: body.error.details,
    kind: 'http',
    message: body.error.message,
    requestId: error.requestId,
    status: error.status ?? 0,
  }
}

/**
 * What to tell the seller.
 *
 * The catalog first, keyed by code; the server's own sentence only when this
 * console has never heard of the code. That order keeps internal words — `slug`,
 * `sellerId`, the name of an endpoint — off the screen while still guaranteeing
 * that *something* is shown.
 */
export function failureMessage(
  failure: ApiFailure,
  messages: {
    readonly errors: ErrorMessages
    readonly failures: Readonly<Record<ApiFailureReason, string>>
  },
): string {
  if (failure.kind === 'transport') return messages.failures[failure.reason]

  return errorMessage(messages.errors, failure.code) ?? failure.message
}

/**
 * The id to offer the reader, or `null` when there is nothing worth quoting.
 *
 * Two conditions, and both matter. The failure has to be one they cannot act on
 * — a 5xx; a correlation id beside "다른 파일을 선택해 주세요" is noise. And
 * there has to be an id: a dead network produced no response, so quoting one
 * would hand somebody a number that matches nothing in any log.
 */
export function quotableRequestId(failure: ApiFailure): string | null {
  return failure.kind === 'http' && failure.status >= 500 ? failure.requestId : null
}
