import { isApiClientError } from '@shopping/shared'

import { ApiConfigurationError } from '@/lib/api'
import type { ErrorMessages } from '@/lib/errors'
import { errorMessage, paramsOf } from '@/lib/errors'

/**
 * Every way a call can fail **before the API answers**.
 *
 * Short, and deliberately so. Until TASK-0117 this list also carried
 * `forbidden`, `not_found`, `conflict`, `invalid` and `server` — the `http` kind
 * split by status, because a status was the most a screen could learn about a
 * refusal. It could not tell three different 409s apart, so the console read the
 * Korean sentence, or guessed from the HTTP method it had used.
 *
 * Now a refusal carries `error.code`, and the vocabulary for "what the API
 * refused" is `domainErrorCodes` in `@shopping/shared`. What is left here is the
 * set of failures where **there is no answer to read**.
 *
 * **This module used to be `lib/categories/errors.ts`** (TASK-0029) and moved
 * here when the attribute console needed the same four functions (TASK-0031
 * 4.9). Nothing in it ever knew anything about categories: it reads an envelope,
 * looks a code up in a catalog, and decides whether a reference is worth
 * showing. A second copy under `lib/attributes/` would have been two answers to
 * one question, with only one of them getting fixed.
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
 * A failed call, in the two shapes a screen has to treat differently.
 *
 * `transport` — nothing arrived. There is no code, no field and no request id,
 * and the only honest thing to say is that the request did not get through.
 *
 * `http` — the API answered and said what happened. `code` is what the screen
 * branches on, `details` is what a form places, and `requestId` is what a person
 * quotes when the failure is not theirs to fix.
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
    return {
      kind: 'transport',
      reason: error.kind === 'http' ? 'malformed_response' : error.kind,
    }
  }

  return {
    kind: 'http',
    status: error.status ?? 0,
    code: body.error.code,
    message: body.error.message,
    details: body.error.details,
    requestId: error.requestId,
  }
}

/** True when the API answered with this code. */
export function hasCode(failure: ApiFailure, code: string): boolean {
  return failure.kind === 'http' && failure.code === code
}

/**
 * What to tell the operator.
 *
 * The catalog first, keyed by code; the server's own sentence only when this
 * console has never heard of the code. That order is what keeps internal words
 * — 슬러그, orderedIds, 엔드포인트 — off the screen while still guaranteeing
 * that *something* is shown (TASK-0117 4.1).
 *
 * The `failures` record is passed in rather than read from a fixed slice: the
 * screen knows which part of its catalog describes a dead network in *its*
 * words, and this function has no business knowing there is a category console.
 */
export function failureMessage(
  failure: ApiFailure,
  messages: {
    readonly errors: ErrorMessages
    readonly failures: Readonly<Record<ApiFailureReason, string>>
  },
): string {
  if (failure.kind === 'transport') return messages.failures[failure.reason]

  return errorMessage(messages.errors, failure.code, paramsOf(failure.details)) ?? failure.message
}

/**
 * The id to offer the reader, or `null` when there is nothing worth quoting.
 *
 * Two conditions, and both matter.
 *
 * **The failure has to be one they cannot act on** — a 5xx. A correlation id
 * beside "다른 주소를 입력해 주세요" is noise: the next action is already on
 * screen, and a UUID suggests the problem is ours when it is not (4.4, R2).
 *
 * **There has to be an id.** A dead network produced no response and therefore
 * no id, so there is nothing to quote and nothing for QA to look up; showing the
 * 문의 번호 panel there would be an empty ceremony over a failure whose real
 * answer is "try again". Those keep the toast they had.
 */
export function quotableRequestId(failure: ApiFailure): string | null {
  return failure.kind === 'http' && failure.status >= 500 ? failure.requestId : null
}
