/**
 * Reading and writing cookies, without a dependency.
 *
 * The API has no cookie middleware. `cookie-parser` plus a global middleware
 * would be more moving parts than the parsing, and only two features need it —
 * the OAuth state (TASK-0021) and the refresh session (TASK-0022). This module
 * exists so those two do not each grow their own copy: `api-failure.ts` is
 * already duplicated across two apps and the cost of that is recorded in
 * `docs/HANDOFF.md`.
 */

export interface CookieAttributes {
  readonly name: string
  readonly value: string
  readonly path: string
  readonly maxAgeSeconds: number
  /** `true` wherever the API is actually on https. Local development is not. */
  readonly secure: boolean
  /**
   * `Lax` for anything a top-level cross-site navigation has to carry.
   *
   * The OAuth callback arrives from `accounts.google.com`, and `Strict`
   * withholds cookies on exactly that navigation (TASK-0021 4장).
   */
  readonly sameSite: 'Lax' | 'Strict'
}

/**
 * Builds a `Set-Cookie` value.
 *
 * **No `Domain`, ever.** Omitting it keeps a cookie on the host that issued it
 * rather than spreading it across `demo-shopping.com` (D-028). That is
 * necessary and — for session cookies — not sufficient: the issuing host is the
 * one API all three apps call, so app separation comes from the *name* as well
 * (D-218). The parameter is absent rather than defaulted so that nobody can add
 * one without reading this.
 */
export function serialiseCookie(attributes: CookieAttributes): string {
  const parts = [
    `${attributes.name}=${attributes.value}`,
    `Path=${attributes.path}`,
    `Max-Age=${String(attributes.maxAgeSeconds)}`,
    'HttpOnly',
    `SameSite=${attributes.sameSite}`,
  ]

  if (attributes.secure) parts.push('Secure')

  return parts.join('; ')
}

/**
 * Expires a cookie.
 *
 * The attributes have to match the ones it was set with — a browser treats a
 * different `Path` as a different cookie and keeps the original.
 */
export function expireCookie(
  attributes: Omit<CookieAttributes, 'value' | 'maxAgeSeconds'>,
): string {
  return serialiseCookie({ ...attributes, value: '', maxAgeSeconds: 0 })
}

/**
 * Reads one cookie out of a `Cookie` header.
 *
 * Matches the whole name: a header carrying `shopping_refresh_shop` must not
 * answer a lookup for `shopping_refresh` — with per-app names (D-218) those
 * prefixes really do overlap.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue

    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }

  return undefined
}
