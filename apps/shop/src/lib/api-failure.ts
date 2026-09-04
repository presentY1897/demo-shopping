import { isApiClientError } from '@shopping/shared'

import { ApiConfigurationError } from '@/lib/api'

/**
 * A failed call, as this storefront has to render it (TASK-0112 4장).
 *
 * **The third copy, and deliberately the smallest.** `apps/seller` and
 * `apps/admin` each hold one of these, and `docs/HANDOFF.md` 3.3 tracks the
 * three as debt whose merge is a *design decision* — whether to interpolate
 * `params`, whether `hasCode` is part of the common API — with TASK-0113 · 0114
 * named as the point where it is made. This file does not pre-empt that. What
 * it does is stop `apps/shop` from reading failures by hand now that it has
 * some to read.
 *
 * | | shop (여기) | seller | admin |
 * | --- | --- | --- | --- |
 * | `apiFailure` · `quotableRequestId` | 같다 | 같다 | 같다 |
 * | `hasCode` | **있다** — 409 를 다르게 다뤄야 한다 | 없다 | 있다 |
 * | `Record<UserFacingErrorCode, string>` | **없다** | 있다 | 있다 |
 * | `params` 보간 | 없다 | 없다 | 있다 |
 *
 * **Why no exhaustive catalog.** TASK-0023 refused to give `apps/shop` one
 * because a storefront that met a single refusal would get "a fifteen line
 * catalog with one reachable sentence", which is what TASK-0117 4.7 J6 gave the
 * slice to `apps/admin` alone to avoid. The account screens raise that number to
 * four or five — not to fifteen. So the app answers the codes it actually
 * branches on and lets the server's own sentence stand for the rest, which is
 * the fallback `packages/ui`'s `serverFieldErrors` already takes and the order
 * TASK-0117 4.1 argues for: server wording beats an empty error.
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
 * The two shapes a screen treats differently.
 *
 * `transport` — nothing arrived. No code, no field, no request id, and the only
 * honest thing to say is that the request did not get through.
 *
 * `http` — the API answered and said what happened. `code` is what the screen
 * branches on, `details` is what a form places, `requestId` is what a person
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
 * True when the API answered with this code.
 *
 * The address book needs it: a `CONFLICT` on "make this the default" is not a
 * failure to report and forget but one that means **the list on screen is
 * stale**, and it is the only refusal here that changes what the screen does
 * next rather than only what it says.
 */
export function hasCode(failure: ApiFailure, code: string): boolean {
  return failure.kind === 'http' && failure.code === code
}

/**
 * What to tell the shopper.
 *
 * The catalog first, keyed by code; the server's own sentence when this app has
 * no word for it. `errors` is a **partial** record on purpose — see the class
 * comment — so an unlisted code falls through to the server's wording rather
 * than failing to compile. That is the one difference from the two consoles'
 * `failureMessage`, which take an exhaustive one.
 */
export function failureMessage(
  failure: ApiFailure,
  messages: {
    readonly errors: Readonly<Record<string, string>>
    readonly failures: Readonly<Record<ApiFailureReason, string>>
  },
): string {
  if (failure.kind === 'transport') return messages.failures[failure.reason]

  return messages.errors[failure.code] ?? failure.message
}

/**
 * The id to offer the reader, or `null` when there is nothing worth quoting.
 *
 * Two conditions, and both matter. The failure has to be one they cannot act on
 * — a 5xx; a correlation id beside "우편번호는 5자리로 입력해 주세요" is noise
 * and suggests the problem is ours when it is not. And there has to be an id: a
 * dead network produced no response, so quoting one would hand somebody a
 * number that matches nothing in any log.
 */
export function quotableRequestId(failure: ApiFailure): string | null {
  return failure.kind === 'http' && failure.status >= 500 ? failure.requestId : null
}
