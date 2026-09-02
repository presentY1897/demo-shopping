/// <reference lib="dom" />
// `dom` rather than `@types/node`: this file is the one place in the workspace
// that both a browser bundle and the Node runtime execute, and the WHATWG
// globals it needs (fetch, Response, RequestInit, AbortSignal, URL) exist in
// both. Depending on the Node types instead would tie the package to a runtime
// it must stay neutral about.

import type { z } from 'zod'

import { apiErrorSchema } from '../api-error.js'
import type { HealthResponse } from '../health.js'
import { healthResponseSchema } from '../health.js'
import { ApiClientError } from './api-client-error.js'
import type { AppId } from './app-id.js'
import { APP_ID_HEADER } from './app-id.js'

/** Every route is versioned; `v1` is the only version in existence today. */
export const API_PATH_PREFIX = '/api/v1'

/** Long enough for a cold API, short enough that a page never hangs on it. */
export const DEFAULT_TIMEOUT_MS = 5_000

/** The shape of `fetch` the client uses, so tests can pass a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ApiClientOptions {
  /** Origin of the API, e.g. `http://localhost:4000`. Path segments are ignored. */
  readonly baseUrl: string
  /** Identifies the calling app on every request. See {@link APP_ID_HEADER}. */
  readonly appId: AppId
  readonly pathPrefix?: string
  readonly timeoutMs?: number
  readonly fetch?: FetchLike
}

export interface ApiRequestOptions<TResult> {
  /** Path below the version prefix, e.g. `/health`. */
  readonly path: string
  /** Parsed against the response body; a mismatch is a `malformed_response`. */
  readonly schema: z.ZodType<TResult>
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface ApiCallOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface ApiClient {
  readonly appId: AppId
  /** Normalised origin, useful in error messages and health panels. */
  readonly baseUrl: string
  request: <TResult>(options: ApiRequestOptions<TResult>) => Promise<TResult>
  getHealth: (options?: ApiCallOptions) => Promise<HealthResponse>
}

function normaliseBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TypeError(`API base URL is not a valid absolute URL: "${baseUrl}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`API base URL must be http(s): "${baseUrl}"`)
  }
  return url.origin
}

function buildUrl(baseUrl: string, prefix: string, path: string): string {
  return `${baseUrl}${prefix}${path.startsWith('/') ? path : `/${path}`}`
}

/** Turns whatever `fetch` rejected with into one of the client's kinds. */
function classifyTransportFailure(
  error: unknown,
  url: string,
  callerAborted: boolean,
): ApiClientError {
  const name = error instanceof Error ? error.name : ''

  if (name === 'TimeoutError' || (name === 'AbortError' && !callerAborted)) {
    return new ApiClientError({
      kind: 'timeout',
      message: `Request to ${url} timed out`,
      cause: error,
    })
  }
  if (name === 'AbortError') {
    return new ApiClientError({
      kind: 'aborted',
      message: `Request to ${url} was aborted`,
      cause: error,
    })
  }
  // Includes a browser CORS rejection, which is indistinguishable from an
  // unreachable host by design.
  return new ApiClientError({ kind: 'network', message: `Cannot reach ${url}`, cause: error })
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return undefined

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new ApiClientError({
      kind: 'malformed_response',
      message: `Response from ${response.url} is not JSON`,
      status: response.status,
      cause: error,
    })
  }
}

function httpFailure(response: Response, body: unknown): ApiClientError {
  const parsed = apiErrorSchema.safeParse(body)

  return new ApiClientError({
    kind: 'http',
    message: parsed.success
      ? `${response.status} ${parsed.data.error.code}: ${parsed.data.error.message}`
      : `${response.status} ${response.statusText} from ${response.url}`,
    status: response.status,
    ...(parsed.success ? { body: parsed.data } : {}),
  })
}

/**
 * Builds the API client for one app.
 *
 * There is deliberately no module level singleton: each app constructs its own
 * with its own {@link AppId}, which is what keeps "shop, seller and admin are
 * three separate sessions" (DECISIONS 2장) true in code rather than by
 * convention. `credentials: 'include'` then sends only the cookies of the
 * origin the call was made from, so a browser tab logged into seller carries
 * nothing of shop.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = normaliseBaseUrl(options.baseUrl)
  const prefix = options.pathPrefix ?? API_PATH_PREFIX
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function request<TResult>({
    path,
    schema,
    method = 'GET',
    body,
    signal,
    timeoutMs,
  }: ApiRequestOptions<TResult>): Promise<TResult> {
    const url = buildUrl(baseUrl, prefix, path)
    const deadline = AbortSignal.timeout(timeoutMs ?? defaultTimeoutMs)
    const hasBody = body !== undefined

    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          [APP_ID_HEADER]: options.appId,
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        // Cookies are per origin and carry the session of this app alone.
        credentials: 'include',
        // Liveness data is never reused; Next.js would otherwise cache it.
        cache: 'no-store',
        signal: signal === undefined ? deadline : AbortSignal.any([deadline, signal]),
      })
    } catch (error) {
      throw classifyTransportFailure(error, url, signal?.aborted ?? false)
    }

    const payload = await readJson(response)
    if (!response.ok) throw httpFailure(response, payload)

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      throw new ApiClientError({
        kind: 'malformed_response',
        message: `Response from ${url} does not match its schema: ${parsed.error.message}`,
        status: response.status,
      })
    }
    return parsed.data
  }

  return {
    appId: options.appId,
    baseUrl,
    request,
    getHealth: (callOptions = {}) =>
      request({ path: '/health', schema: healthResponseSchema, ...callOptions }),
  }
}
