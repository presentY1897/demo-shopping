import type { HealthResponse } from '@shopping/shared'
import { ApiConfigurationError, isApiClientError } from '@shopping/shared'

import { getApiClient } from './api'

/** Every way the health call can fail, as one closed set the catalog covers. */
export type HealthFailureReason =
  'network' | 'timeout' | 'aborted' | 'http' | 'malformed_response' | 'configuration' | 'unknown'

export type HealthResult =
  | { readonly ok: true; readonly endpoint: string; readonly response: HealthResponse }
  | { readonly ok: false; readonly endpoint: string; readonly reason: HealthFailureReason }

export interface HealthRequestOptions {
  /**
   * Deadline for this call.
   *
   * The client's own default is 5 seconds, which a cold instance cannot meet —
   * the measured spin-up is about 90 (TASK-0101 4.1). The wake-up sequence
   * raises it per attempt instead of changing the shared default, because every
   * other call in the app still wants to fail fast.
   */
  readonly timeoutMs?: number
  /** Cancels the call when the component that started it goes away. */
  readonly signal?: AbortSignal
}

function reasonOf(error: unknown): HealthFailureReason {
  if (error instanceof ApiConfigurationError) return 'configuration'
  if (isApiClientError(error)) return error.kind

  return 'unknown'
}

/**
 * Reads `GET /api/v1/health` and never throws.
 *
 * A dead API is an expected state here, not an exception: the page has to keep
 * rendering and say so (TASK-0006 F3), so the failure is returned as data.
 */
export async function loadHealth(options: HealthRequestOptions = {}): Promise<HealthResult> {
  let endpoint = process.env.NEXT_PUBLIC_API_URL ?? '(미설정)'

  try {
    const client = getApiClient()
    endpoint = client.baseUrl
    return { ok: true, endpoint, response: await client.getHealth(options) }
  } catch (error) {
    return { ok: false, endpoint, reason: reasonOf(error) }
  }
}
