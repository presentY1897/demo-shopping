import type { ApiClient } from '@shopping/shared'
import { createApiClient } from '@shopping/shared'

/**
 * This app's identity on every API call.
 *
 * The three apps are served from three origins and their session cookies carry
 * no `Domain`, so none of them can read another's (DECISIONS 2장). The API
 * therefore cannot work out who is calling from the credentials alone, and each
 * app builds its own client with its own id rather than sharing a singleton.
 */
const APP_ID = 'admin' as const

export class ApiConfigurationError extends Error {
  override readonly name = 'ApiConfigurationError'
}

let client: ApiClient | null = null

/**
 * The API base URL is resolved once, lazily.
 *
 * `scripts/web-app.mjs` derives it from this worktree's `PORT_OFFSET` before
 * handing over to Next, so nothing has to be edited per worktree; a deployment
 * sets `NEXT_PUBLIC_API_URL` explicitly and that value wins. Resolving lazily
 * keeps a missing value from taking the whole route down at import time — the
 * page reports it as one more failure state.
 */
export function getApiClient(): ApiClient {
  if (client !== null) return client

  const baseUrl = process.env.NEXT_PUBLIC_API_URL
  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new ApiConfigurationError('NEXT_PUBLIC_API_URL is not set')
  }

  client = createApiClient({ baseUrl, appId: APP_ID })
  return client
}
