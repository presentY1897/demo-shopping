import { isApiClientError } from '@shopping/shared'

import { ApiConfigurationError } from '@/lib/api'
import type { ErrorMessages } from '@/lib/errors'
import { errorMessage } from '@/lib/errors'

/**
 * A failed API call, as a value a screen can render (TASK-0117 4.1).
 *
 * **There are three of these** — here, `apps/admin/src/lib/api-failure.ts` and
 * `apps/shop/src/lib/api-failure.ts` — and `docs/HANDOFF.md` 3.3 tracks them as
 * debt whose merge is a *design decision* rather than a file move. TASK-0114
 * was named as the point where that decision is made. It was made, and the
 * answer was **not yet**; the reasoning is in that task's 7.1 and the short
 * version is:
 *
 * - the two open questions are settled — `hasCode` **is** part of the common
 *   API (this file gains it below, with the signature the other two already
 *   have), and the seller catalog needs no `params` interpolation because its
 *   one sentence with a `params` imports the constant instead (`lib/errors.ts`);
 * - but the only correct home is `packages/shared/src/api/`, which TASK-0114
 *   does not own — `packages/ui` is ruled out by its own `server-errors.ts`
 *   header (no REST client in a component library), and a new package would
 *   have to edit `apps/shop`, which TASK-0024 has open;
 * - and merging two of the three would leave the third free to diverge, which
 *   is exactly the half-move this comment used to warn against.
 *
 * What is left of the difference: each app's own `ApiConfigurationError`, and
 * whether `failureMessage` takes an exhaustive catalog or a partial one. Both
 * are arguments, so the move is mechanical once there is somewhere to move to.
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
 * True when the API answered with this code.
 *
 * The editor needs it (TASK-0114 4장): a lost optimistic lock goes to a banner
 * with 「다시 불러오기」, a taken SKU goes above the variant table with no such
 * offer — re-reading does not fix that one — and the store's own state goes to
 * a banner with the opposite advice from an ownership 403. Three different
 * next actions behind three codes and one status apiece.
 */
export function hasCode(failure: ApiFailure, code: string): boolean {
  return failure.kind === 'http' && failure.code === code
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
