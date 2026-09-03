import type { ApiErrorBody } from '../api-error.js'

/**
 * Why a call failed, in the coarse categories a caller can actually act on.
 *
 * - `network` — the request never produced a response (API down, DNS, CORS)
 * - `timeout` — the deadline passed before a response arrived
 * - `aborted` — the caller's own signal cancelled the request
 * - `http` — a response arrived with a non-2xx status
 * - `malformed_response` — 2xx, but the body is not what the schema describes
 *
 * The distinction matters to the UI: `http` means the API answered and its
 * message can be shown, while the others mean there is nothing to show but our
 * own copy.
 */
export const apiErrorKinds = [
  'network',
  'timeout',
  'aborted',
  'http',
  'malformed_response',
] as const

export type ApiErrorKind = (typeof apiErrorKinds)[number]

export interface ApiClientErrorInit {
  readonly kind: ApiErrorKind
  /** English, for logs. User facing copy comes from each app's message catalog. */
  readonly message: string
  readonly status?: number
  readonly body?: ApiErrorBody
  /** `x-request-id` of the response, when one arrived. */
  readonly requestId?: string
  readonly cause?: unknown
}

/**
 * Every failure `createApiClient` produces, successful or not, arrives as this
 * type — callers never have to tell a `TypeError` from `fetch` apart from a 500.
 */
export class ApiClientError extends Error {
  override readonly name = 'ApiClientError'
  readonly kind: ApiErrorKind
  /** HTTP status, present only when `kind` is `http`. */
  readonly status: number | undefined
  /** Parsed error envelope, present only when the API returned one. */
  readonly body: ApiErrorBody | undefined

  /**
   * The id of the request that failed, for a person to quote and for QA to grep.
   *
   * Read from the `x-request-id` response header, falling back to the envelope's
   * own copy. The header is the better source because it is there even when the
   * body is not — a 502 from a proxy, a truncated response, a body that failed
   * to parse — and the envelope is the better fallback because a browser only
   * sees headers the server chose to expose.
   *
   * `undefined` for a request that never produced a response: there is no id to
   * quote, and inventing one client-side would hand somebody a number that
   * matches nothing in any log.
   */
  private readonly headerRequestId: string | undefined

  constructor({ kind, message, status, body, requestId, cause }: ApiClientErrorInit) {
    super(message, cause === undefined ? undefined : { cause })
    this.kind = kind
    this.status = status
    this.body = body
    this.headerRequestId = requestId
  }

  /**
   * Domain specific code from the error envelope (`CATEGORY_SLUG_TAKEN`,
   * `AUTH_REQUIRED`, …), or `null` when the API never answered.
   */
  get code(): string | null {
    return this.body?.error.code ?? null
  }

  /** See {@link ApiClientError.headerRequestId}. */
  get requestId(): string | null {
    return this.headerRequestId ?? this.body?.error.requestId ?? null
  }

  /**
   * The `details` of the envelope, or an empty list.
   *
   * Saves every caller the `?? []`, and keeps them from reaching into `body`
   * for the one thing they all want out of it.
   */
  get details(): readonly unknown[] {
    return this.body?.error.details ?? []
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError
}
