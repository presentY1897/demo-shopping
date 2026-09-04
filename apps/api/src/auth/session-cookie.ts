import type { AppId } from '@shopping/shared'
import { appIds } from '@shopping/shared'

import { expireCookie, readCookie, serialiseCookie } from './cookies.js'

/**
 * The refresh cookie, one per app (D-218).
 *
 * **Why the name carries the app.** D-028 asks for sessions that do not leak
 * between the three consoles, and its stated mechanism — omitting `Domain` — is
 * necessary but not sufficient here. None of the apps issues this cookie: all
 * three call the same API, so the issuing host is `api.demo-shopping.com` and a
 * single cookie on it would be sent by every one of them. Locally it is starker
 * still, because cookies ignore ports and the apps and the API are all
 * `localhost`.
 *
 * Three names on one origin, and the API reads only the one `X-App-Id` names.
 */
const PREFIX = 'shopping_refresh_'

export function refreshCookieName(app: AppId): string {
  return `${PREFIX}${app}`
}

/** Every name this module can produce, for a logout that clears all of them. */
export const refreshCookieNames = appIds.map(refreshCookieName)

/**
 * Scoped to the endpoints that use it.
 *
 * Refresh and logout are the only callers. A cookie on `/` would attach a
 * fourteen-day credential to every catalogue request, which is a longer-lived
 * secret travelling far more often than it needs to.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

/** 14 days (TASK-0022 4장). */
export const REFRESH_MAX_AGE_SECONDS = 14 * 24 * 60 * 60

export interface SessionCookieOptions {
  /** `true` wherever the API is on https. Local development is not. */
  readonly secure: boolean
}

/**
 * `Lax`, and that is the CSRF defence.
 *
 * The three apps live on subdomains of the same registrable domain as the API,
 * so a call from `shop.demo-shopping.com` to `api.demo-shopping.com` is
 * **same-site** and `Lax` sends the cookie — including on `fetch`. A page on
 * some other domain doing the same call is cross-site, so the cookie is
 * withheld and the refresh simply fails; CORS then stops it reading anything
 * even if it did.
 *
 * `None` would work from anywhere and is exactly what makes that attack
 * possible, so it is not used. The cost is real and already recorded: an app
 * served from a **different** site than the API — a Vercel preview URL, say —
 * cannot refresh at all. That is one more face of TASK-0021 R3, which is open
 * for the same underlying reason (there is no preview API).
 */
const SAME_SITE = 'Lax' as const

function attributes(app: AppId, { secure }: SessionCookieOptions) {
  return {
    name: refreshCookieName(app),
    path: REFRESH_COOKIE_PATH,
    secure,
    sameSite: SAME_SITE,
  }
}

export function buildRefreshCookie(
  app: AppId,
  token: string,
  options: SessionCookieOptions,
): string {
  return serialiseCookie({
    ...attributes(app, options),
    value: token,
    maxAgeSeconds: REFRESH_MAX_AGE_SECONDS,
  })
}

export function clearRefreshCookie(app: AppId, options: SessionCookieOptions): string {
  return expireCookie(attributes(app, options))
}

/** The refresh token this browser holds **for this app**, if any. */
export function readRefreshCookie(header: string | undefined, app: AppId): string | undefined {
  return readCookie(header, refreshCookieName(app))
}
