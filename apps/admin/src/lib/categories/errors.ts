import type { ApiErrorBody } from '@shopping/shared'
import { isApiClientError } from '@shopping/shared'

import { ApiConfigurationError } from '@/lib/api'

/**
 * Every way a category call can fail, as one closed set the catalog covers.
 *
 * The transport kinds come from `ApiClientError`; `forbidden`, `not_found`,
 * `conflict` and `invalid` split the `http` kind by status, because a console
 * has to say something different for each and "API 가 오류를 응답했습니다" is
 * not an answer an operator can act on.
 */
export const categoryFailureReasons = [
  'network',
  'timeout',
  'aborted',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'invalid',
  'server',
  'malformed_response',
  'configuration',
  'unknown',
] as const

export type CategoryFailureReason = (typeof categoryFailureReasons)[number]

export interface CategoryFailure {
  readonly reason: CategoryFailureReason
  readonly status?: number
  /**
   * The API's own sentence, from `details[0]`.
   *
   * It is the only place the reason for a 409 exists — `error.code` is derived
   * from the status, so every conflict shares one code. Shown beside the
   * catalog's own line rather than instead of it: the catalog says what kind of
   * failure it was, this says what the server refused (U6).
   */
  readonly detail?: string
}

const STATUS_REASONS: Readonly<Record<number, CategoryFailureReason>> = {
  400: 'invalid',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'invalid',
}

/** The server's own explanation, when it sent one that is a plain string. */
function detailOf(body: ApiErrorBody | undefined): string | undefined {
  const [first] = body?.error.details ?? []

  return typeof first === 'string' && first !== '' ? first : undefined
}

/** Turns anything thrown by a category call into a value the screen can render. */
export function categoryFailure(error: unknown): CategoryFailure {
  if (error instanceof ApiConfigurationError) return { reason: 'configuration' }
  if (!isApiClientError(error)) return { reason: 'unknown' }
  if (error.kind !== 'http') return { reason: error.kind }

  const status = error.status ?? 0
  const reason = STATUS_REASONS[status] ?? (status >= 500 ? 'server' : 'unknown')
  const detail = detailOf(error.body)

  return detail === undefined ? { reason, status } : { reason, status, detail }
}

/** A refusal the screen has a dedicated answer for (TASK-0029 4장). */
export function isConflict(failure: CategoryFailure): boolean {
  return failure.reason === 'conflict'
}
