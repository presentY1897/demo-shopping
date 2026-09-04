import type { ApiClient } from '@shopping/shared'
import { createApiClient } from '@shopping/shared'

import type { SessionClient } from '@/lib/auth/session-client'
import { authenticatedFetch, createSessionClient } from '@/lib/auth/session-client'

/**
 * This app's identity on every API call.
 *
 * The three apps are served from three origins and their session cookies carry
 * no `Domain` (DECISIONS 2장), and the refresh cookie's *name* carries the app
 * (D-218). The API therefore cannot work out who is calling from the credentials
 * alone, and each app builds its own client with its own id rather than sharing
 * a singleton.
 */
export const APP_ID = 'seller' as const

export class ApiConfigurationError extends Error {
  override readonly name = 'ApiConfigurationError'
}

/**
 * The API origin, resolved lazily.
 *
 * `scripts/web-app.mjs` derives it from this worktree's `PORT_OFFSET` before
 * handing over to Next, so nothing has to be edited per worktree; a deployment
 * sets `NEXT_PUBLIC_API_URL` explicitly and that value wins. Resolving lazily
 * keeps a missing value from taking the whole route down at import time — the
 * page reports it as one more failure state.
 */
export function apiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL

  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new ApiConfigurationError('NEXT_PUBLIC_API_URL is not set')
  }

  return baseUrl
}

let session: SessionClient | null = null

/**
 * The session, as one object for the whole tab.
 *
 * A singleton on purpose: the access token lives in it, and two of these would
 * mean two tokens, two renewals and a rotation race with itself. `AuthProvider`
 * takes it as a prop so a spec can hand over its own.
 */
export function getSessionClient(): SessionClient {
  session ??= createSessionClient({ appId: APP_ID, baseUrl: apiBaseUrl() })

  return session
}

let client: ApiClient | null = null

/**
 * The API client, with the session attached.
 *
 * The token is added by the injected `fetch` rather than by every call site —
 * `ApiClientOptions.fetch` is the seam `packages/shared` already provides, and
 * using it keeps the shared client free of any idea of what a session is
 * (TASK-0023 4장).
 */
export function getApiClient(): ApiClient {
  if (client !== null) return client

  client = createApiClient({
    appId: APP_ID,
    baseUrl: apiBaseUrl(),
    fetch: authenticatedFetch(getSessionClient()),
  })

  return client
}
