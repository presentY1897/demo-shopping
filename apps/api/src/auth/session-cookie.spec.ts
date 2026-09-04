import { appIds } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  buildRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  refreshCookieName,
  refreshCookieNames,
  REFRESH_COOKIE_PATH,
  REFRESH_MAX_AGE_SECONDS,
} from './session-cookie.js'

/**
 * The refresh cookie, one per app (D-218).
 *
 * The whole file is really about one sentence in D-028 — «세 앱의 세션은
 * 독립이다» — and about the fact that the mechanism it names is not enough.
 * None of the three consoles issues this cookie: all three call the same API,
 * so the issuing host is `api.demo-shopping.com` and one cookie on it would be
 * sent by every one of them. Locally it is starker still, because cookies ignore
 * ports and the apps and the API are all `localhost`. Omitting `Domain` stops
 * the cookie spreading across the registrable domain; only the per-app *name*
 * stops the three apps sharing a session inside one API origin.
 *
 * So the checks below are not really about string formatting. A wrong name is
 * a shop sign-in that logs somebody into the seller console, and a mismatched
 * attribute on the clear is a logout that leaves the session alive — both of
 * which look completely fine in any test that sets the `Cookie` header itself.
 */

const INSECURE = { secure: false } as const
const TOKEN = 'refresh-token-placeholder'

/** Everything a browser matches a cookie on, which is everything but the value. */
function attributesOf(cookie: string): string[] {
  return cookie.split('; ').slice(1)
}

/** The `name=value` pair a browser sends back, out of a `Set-Cookie` header. */
function pairOf(cookie: string): string {
  return cookie.split(';')[0] ?? ''
}

describe('the name of the cookie', () => {
  it('is a different one for each app', () => {
    // F5b. Three names on one origin is the entire separation mechanism; two
    // apps sharing a name is two apps sharing a session.
    expect(appIds.map(refreshCookieName)).toEqual([
      'shopping_refresh_shop',
      'shopping_refresh_seller',
      'shopping_refresh_admin',
    ])
  })

  it('lists every name it can produce', () => {
    // `logout-all` clears what it can reach, and it can only reach names it
    // knows. One missing from this list is a console that stays signed in after
    // the user asked to be signed out everywhere.
    expect(refreshCookieNames).toEqual(appIds.map(refreshCookieName))
    expect(new Set(refreshCookieNames).size).toBe(appIds.length)
  })
})

describe('one app cannot read another app session (D-218)', () => {
  it('does not answer with the cookie a different app holds', () => {
    // The property F1 rests on. A seller session sitting in the browser must be
    // invisible to a shop refresh — otherwise signing in once signs the user
    // into all three consoles, and D-028's stated benefit (three roles in three
    // tabs) is precisely what stops working.
    const sellerOnly = pairOf(buildRefreshCookie('seller', TOKEN, INSECURE))

    expect(readRefreshCookie(sellerOnly, 'seller')).toBe(TOKEN)
    expect(readRefreshCookie(sellerOnly, 'shop')).toBeUndefined()
    expect(readRefreshCookie(sellerOnly, 'admin')).toBeUndefined()
  })

  it.each([...appIds])('reads only its own when the browser sends all three (%s)', (app) => {
    // The real state of a browser with all three consoles open. Every one of
    // these cookies travels on every refresh request, because they share an
    // origin and a path — which app the API is answering is decided by the
    // `X-App-Id` header alone, never by what happens to be in the jar.
    const header = appIds.map((id) => `${refreshCookieName(id)}=${id}-token`).join('; ')

    expect(readRefreshCookie(header, app)).toBe(`${app}-token`)
  })

  it('answers undefined when this app has no cookie in the request', () => {
    // Not an error condition: an anonymous visitor and a signed-out one both
    // arrive this way, and the refresh endpoint has to tell them apart from a
    // corrupt one.
    expect(readRefreshCookie('unrelated=1', 'shop')).toBeUndefined()
    expect(readRefreshCookie(undefined, 'shop')).toBeUndefined()
  })
})

describe('the Set-Cookie the API writes', () => {
  const cookie = buildRefreshCookie('shop', TOKEN, INSECURE)

  it('carries the token under this app name', () => {
    expect(pairOf(cookie)).toBe(`shopping_refresh_shop=${TOKEN}`)
  })

  it('carries no Domain (D-028)', () => {
    // Omitting it keeps the cookie on the host that issued it instead of
    // spreading it across demo-shopping.com. Necessary, and — since the issuing
    // host is the one API all three apps call — not sufficient on its own, which
    // is why the name above does the rest.
    expect(cookie).not.toContain('Domain')
  })

  it('is SameSite=Lax, which is the CSRF defence', () => {
    // The three apps are subdomains of the same registrable domain as the API,
    // so their refresh calls are same-site and `Lax` sends the cookie — `fetch`
    // included. A page on someone else's domain making the same call is
    // cross-site, the cookie is withheld, and the refresh simply fails.
    // `None` would send it from anywhere, which is exactly what makes that
    // attack work. The known cost is recorded in session-cookie.ts: an app
    // served from a different site than the API — a Vercel preview URL — cannot
    // refresh at all (TASK-0021 R3).
    expect(attributesOf(cookie)).toContain('SameSite=Lax')
    expect(cookie).not.toContain('SameSite=None')
  })

  it('is HttpOnly, because no script has any business reading it', () => {
    // The reason the refresh token is in a cookie rather than in the app: script
    // that can read it can keep a fourteen-day credential.
    expect(attributesOf(cookie)).toContain('HttpOnly')
  })

  it('is scoped to the endpoints that use it', () => {
    // Refresh and logout are the only callers. On `/` this fourteen-day
    // credential would ride along on every catalogue request — a longer-lived
    // secret travelling far more often than it needs to.
    expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth')
    expect(attributesOf(cookie)).toContain('Path=/api/v1/auth')
  })

  it('lives fourteen days', () => {
    // The refresh lifetime of TASK-0022 4장, in the seconds `Max-Age` wants.
    // Written as a literal as well as a constant: a wrong unit here is a session
    // that ends after twenty minutes, and the constant would agree with itself.
    expect(REFRESH_MAX_AGE_SECONDS).toBe(1_209_600)
    expect(attributesOf(cookie)).toContain('Max-Age=1209600')
  })

  it('adds Secure only where the API is actually on https', () => {
    // Local development is http, and a Secure cookie there is never stored or
    // sent — the symptom is a sign-in that appears to do nothing (R1).
    expect(cookie).not.toContain('Secure')
    expect(attributesOf(buildRefreshCookie('shop', TOKEN, { secure: true }))).toContain('Secure')
  })
})

describe('the Set-Cookie a logout writes', () => {
  it('expires the value immediately', () => {
    const cleared = clearRefreshCookie('shop', INSECURE)

    expect(pairOf(cleared)).toBe('shopping_refresh_shop=')
    expect(attributesOf(cleared)).toContain('Max-Age=0')
  })

  it.each([true, false])(
    'matches the set cookie attribute for attribute (secure: %s)',
    (secure) => {
      // A browser keys a cookie on name, domain and path. Clearing it with even
      // one of those different deletes nothing and leaves the original in place —
      // so the response says `Set-Cookie` and the browser keeps refreshing with
      // the token that was supposedly revoked. Logging out would look like it
      // worked (F6).
      const withoutMaxAge = (parts: string[]): string[] =>
        parts.filter((part) => !part.startsWith('Max-Age='))

      const set = attributesOf(buildRefreshCookie('admin', TOKEN, { secure }))
      const cleared = attributesOf(clearRefreshCookie('admin', { secure }))

      expect(withoutMaxAge(cleared)).toEqual(withoutMaxAge(set))
    },
  )
})

describe('the two halves meeting', () => {
  it.each([...appIds])('reads back the token it wrote (%s)', (app) => {
    // What actually happens across a round trip: the API writes a `Set-Cookie`,
    // the browser sends back the pair from it, and the refresh endpoint reads
    // that. Each half is checked above; this is the only test that fails if they
    // ever stop agreeing on the name.
    const header = pairOf(buildRefreshCookie(app, TOKEN, INSECURE))

    expect(readRefreshCookie(header, app)).toBe(TOKEN)
  })
})
