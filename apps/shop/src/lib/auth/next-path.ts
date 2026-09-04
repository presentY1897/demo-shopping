/**
 * Where to go back to after signing in (TASK-0023 F2).
 *
 * **The value comes from a URL, so it is untrusted.** A `next` nobody checked is
 * an open redirect: `?next=https://evil.example` would send somebody straight
 * off the site from a page they reached by clicking "로그인". The OAuth callback
 * solves the same problem by choosing its origin from an allow list
 * (TASK-0021 4장); a front-end has no list, so it accepts only paths that cannot
 * name a host at all.
 *
 * One of the three identical copies described in `lib/auth/session-client.ts`.
 */

/** Query parameter carrying the path to return to. */
export const NEXT_PARAM = 'next'

/** Where a visitor lands when there is nothing to return to. */
export const HOME_PATH = '/'

/**
 * The path, or `null` when it is not one this app can safely navigate to.
 *
 * Three refusals, and each has been a real vulnerability somewhere:
 *
 * - anything not starting with `/` — an absolute URL, or a relative path that
 *   would resolve against whatever page happens to be open
 * - `//host` — protocol-relative, which browsers resolve to another origin
 * - `/\host` — the same trick with a backslash, which several browsers
 *   normalise to `/` before resolving
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null

  return raw
}

/** `/login?next=/orders`, with the path escaped exactly once. */
export function signInHref(loginPath: string, next?: string | null): string {
  const target = safeNextPath(next)

  return target === null
    ? loginPath
    : `${loginPath}?${new URLSearchParams({ [NEXT_PARAM]: target }).toString()}`
}

/**
 * Where `next` waits while the browser is at Google.
 *
 * **It cannot travel with the request.** `GET /auth/google` takes `?app=` and
 * nothing else (`googleAuthorizeQuerySchema`), zod strips what it does not
 * declare, and the callback rebuilds the return address from its own allow list
 * — `buildOauthRedirect(origin, result)` writes `status`, `reason` and `notice`
 * and no more. Sending `next` along would be a parameter no server ever reads
 * back, which is the kind of dead code that passes every test because the mock
 * echoes it.
 *
 * So the path stays on this side of the trip. `sessionStorage` and not
 * `localStorage`: it belongs to this tab and this attempt, and an abandoned
 * sign-in must not redirect a different tab a week later.
 */
const NEXT_STORAGE_KEY = 'shopping.auth.next'

/** Remembers where to come back to. Storage failures are not worth reporting. */
export function rememberNextPath(path: string): void {
  try {
    globalThis.sessionStorage?.setItem(NEXT_STORAGE_KEY, path)
  } catch {
    // Private browsing, or a browser told to block site data. The sign-in still
    // works; it just lands on the home page.
  }
}

/** Reads the remembered path and forgets it. `null` when there is none. */
export function takeNextPath(): string | null {
  try {
    const stored = globalThis.sessionStorage?.getItem(NEXT_STORAGE_KEY) ?? null
    globalThis.sessionStorage?.removeItem(NEXT_STORAGE_KEY)

    return safeNextPath(stored)
  } catch {
    return null
  }
}
