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

  constructor({ kind, message, status, body, cause }: ApiClientErrorInit) {
    super(message, cause === undefined ? undefined : { cause })
    this.kind = kind
    this.status = status
    this.body = body
  }

  /**
   * Domain specific code from the error envelope (`VALIDATION_FAILED`,
   * `OUT_OF_STOCK`, …), or `null` when the API never answered.
   */
  get code(): string | null {
    return this.body?.error.code ?? null
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError
}
