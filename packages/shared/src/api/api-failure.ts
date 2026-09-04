/**
 * A failed API call, as a value a screen can render (TASK-0117 4.1).
 *
 * **This was three files.** `apps/shop`, `apps/seller` and `apps/admin` each
 * held a copy, and `docs/HANDOFF.md` 3.3 tracked them as debt whose merge was a
 * *design decision* rather than a file move. TASK-0114 7.1 answered the two
 * questions — `hasCode` **is** part of the common API, and the seller catalog
 * needs no `params` of its own — but could not do the move: the only correct
 * home was this package, and that was outside its ownership. D-219 settles the
 * ownership and the last difference. Nothing here is new behaviour; every branch
 * below was already in `apps/admin`'s copy, which was the superset.
 *
 * Why this package and not `packages/ui`: everything this module reads lives
 * here — `ApiClientError` for transport failures, `ApiErrorBody` for the
 * envelope, `UserFacingErrorCode` for the vocabulary. `packages/ui`'s own
 * `server-errors.ts` header refuses the alternative in as many words: no REST
 * client inside a component library.
 */

import { ApiConfigurationError, isApiClientError } from './api-client-error.js'
import { errorMessage, paramsOf } from './error-messages.js'

/**
 * Every way a call can fail **before the API answers**.
 *
 * Short, and deliberately so. Until TASK-0117 this list also carried
 * `forbidden`, `not_found`, `conflict`, `invalid` and `server` — the `http` kind
 * split by status, because a status was the most a screen could learn about a
 * refusal. It could not tell three different 409s apart, so a console read the
 * Korean sentence, or guessed from the HTTP method it had used.
 *
 * Now a refusal carries `error.code`, and the vocabulary for "what the API
 * refused" is `domainErrorCodes`. What is left here is the set of failures where
 * **there is no answer to read**.
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
 * The screens that need it are the ones where a refusal changes what happens
 * next rather than only what is said: a lost optimistic lock goes to a banner
 * with 「다시 불러오기」, a taken SKU goes above the variant table with no such
 * offer — re-reading does not fix that one — and a `CONFLICT` on "make this the
 * default address" means **the list on screen is stale**.
 */
export function hasCode(failure: ApiFailure, code: string): boolean {
  return failure.kind === 'http' && failure.code === code
}

/**
 * What to tell the reader.
 *
 * The app's catalog first, keyed by code; the server's own sentence only when
 * the app has never heard of the code. That order is what keeps internal words
 * — 슬러그, `orderedIds`, the name of an endpoint — off the screen while still
 * guaranteeing that *something* is shown (TASK-0117 4.1).
 *
 * **`errors` is a `Record<string, string>`, not an exhaustive catalog.** Both
 * shapes are accepted on purpose: the two consoles declare theirs as
 * {@link ErrorMessages} so a new code fails their typecheck, and `apps/shop`
 * keeps a partial one because a storefront with one reachable sentence out of
 * fifteen is what TASK-0023 refused it. Neither has to cast.
 *
 * **The `failures` record is passed in rather than read from a fixed slice**:
 * the screen knows which part of its catalog describes a dead network in *its*
 * words, and this function has no business knowing there is a category console.
 *
 * **Interpolation is unconditional** (D-219). A template with no `{자리}` comes
 * back unchanged, so this is the identity function for the two catalogs that
 * carry none; making it an argument instead would mean one forgotten parameter
 * ships `카테고리는 {max}단계까지만` to an operator, and compiles.
 */
export function failureMessage(
  failure: ApiFailure,
  messages: {
    readonly errors: Readonly<Record<string, string>>
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
 * beside "우편번호는 5자리로 입력해 주세요" is noise: the next action is already
 * on screen, and a UUID suggests the problem is ours when it is not (TASK-0117
 * 4.4, R2).
 *
 * **There has to be an id.** A dead network produced no response and therefore
 * no id, so there is nothing to quote and nothing for QA to look up; showing the
 * 문의 번호 panel there would be an empty ceremony over a failure whose real
 * answer is "try again". Those keep the toast they had.
 */
export function quotableRequestId(failure: ApiFailure): string | null {
  return failure.kind === 'http' && failure.status >= 500 ? failure.requestId : null
}
