import { API_PATH_PREFIX } from '@shopping/shared'

import { APP_ID, apiBaseUrl } from '@/lib/api'

/**
 * Where the Google button points (TASK-0021 4장).
 *
 * **A link, not a `fetch`.** The endpoint answers 302 to Google's consent
 * screen, and a page that fetched it would have to follow the redirect itself —
 * which it cannot, because the whole point is that the *browser* goes there and
 * comes back with a cookie. It also keeps the back button working.
 *
 * `?app=` is what tells the callback which origin to return to; the callback
 * reads it back from a signed state cookie rather than from the query, so this
 * value cannot be tampered into a redirect somewhere else.
 *
 * One of the three identical copies described in `lib/auth/session-client.ts`.
 */
export function googleSignInHref(): string {
  return `${apiBaseUrl()}${API_PATH_PREFIX}/auth/google?app=${APP_ID}`
}
