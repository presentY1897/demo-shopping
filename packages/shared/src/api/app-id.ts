/**
 * The three web apps that call the API.
 *
 * Each one is deployed on its own subdomain and, because their session cookies
 * are issued without a `Domain` attribute (DECISIONS 2장), none of them can read
 * another's cookie. A request therefore cannot be attributed to an app by
 * looking at the credentials it carries, so the caller states which app it is.
 */
export const appIds = ['shop', 'seller', 'admin'] as const

export type AppId = (typeof appIds)[number]

/**
 * Header carrying {@link AppId}.
 *
 * The API uses it to scope what it hands back — which cookie name to set, which
 * OAuth redirect to use, which app a log line belongs to — instead of guessing
 * from `Origin`, which is absent on server-to-server calls (a Next.js Server
 * Component fetching on behalf of the browser sends none).
 */
export const APP_ID_HEADER = 'X-App-Id'

export function isAppId(value: unknown): value is AppId {
  return typeof value === 'string' && (appIds as readonly string[]).includes(value)
}
