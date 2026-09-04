import { describe, expect, it } from 'vitest'

import { expireCookie, readCookie, serialiseCookie } from './cookies.js'

/**
 * The cookie helpers both auth features share.
 *
 * They live here rather than in either feature because a second copy is how
 * `api-failure.ts` ended up duplicated across two apps — recorded in
 * `docs/HANDOFF.md` as something to undo later rather than something to repeat.
 */

const BASE = {
  name: 'shopping_refresh_shop',
  path: '/api/v1/auth',
  secure: false,
  sameSite: 'Lax',
} as const

describe('building a Set-Cookie value', () => {
  it('never writes a Domain', () => {
    // Omitting it keeps the cookie on the issuing host instead of spreading it
    // across demo-shopping.com (D-028). A `Domain` here would hand every
    // subdomain the refresh token.
    expect(serialiseCookie({ ...BASE, value: 'v', maxAgeSeconds: 60 })).not.toContain('Domain')
  })

  it('is HttpOnly and carries the path and lifetime it was given', () => {
    const header = serialiseCookie({ ...BASE, value: 'v', maxAgeSeconds: 60 })

    expect(header).toContain('shopping_refresh_shop=v')
    expect(header).toContain('Path=/api/v1/auth')
    expect(header).toContain('Max-Age=60')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
  })

  it('adds Secure only where the API is actually on https', () => {
    // Local development is http; a Secure cookie there is simply never sent,
    // and the failure looks like "sign-in does nothing".
    expect(serialiseCookie({ ...BASE, value: 'v', maxAgeSeconds: 60 })).not.toContain('Secure')
    expect(serialiseCookie({ ...BASE, secure: true, value: 'v', maxAgeSeconds: 60 })).toContain(
      'Secure',
    )
  })

  it('passes SameSite through', () => {
    expect(
      serialiseCookie({ ...BASE, sameSite: 'Strict', value: 'v', maxAgeSeconds: 60 }),
    ).toContain('SameSite=Strict')
  })
})

describe('expiring a cookie', () => {
  it('repeats the attributes it was set with', () => {
    // A different Path is a different cookie to a browser, and the original
    // survives — which is how a "logged out" session keeps working.
    const expired = expireCookie(BASE)

    expect(expired).toContain('Max-Age=0')
    expect(expired).toContain('Path=/api/v1/auth')
    expect(expired).toContain('HttpOnly')
    expect(expired).toContain('SameSite=Lax')
    expect(expired).toContain('shopping_refresh_shop=;')
  })
})

describe('reading one cookie out of a request', () => {
  const NAME = 'shopping_refresh_shop'

  it('finds it among the others a browser sends', () => {
    expect(readCookie(`other=1; ${NAME}=value; last=2`, NAME)).toBe('value')
  })

  it('tolerates the spacing browsers actually use', () => {
    expect(readCookie(`  ${NAME} =  value  ;other=1`, NAME)).toBe('value')
  })

  it('does not answer with a cookie whose name merely starts the same', () => {
    // Not hypothetical here. The three session cookies are `shopping_refresh_shop`,
    // `_seller` and `_admin` (D-218), and a prefix match would hand one app
    // another's session — which is the exact thing the per-app name prevents.
    const header = `shopping_refresh=wrong; ${NAME}_v2=wrong; ${NAME}=right`

    expect(readCookie(header, NAME)).toBe('right')
  })

  it('keeps a value containing an equals sign intact', () => {
    // Base64 padding. Splitting on every `=` would truncate a token.
    expect(readCookie('token=YWJj==', 'token')).toBe('YWJj==')
  })

  it('skips a fragment that is not a pair at all', () => {
    expect(readCookie(`nonsense; ${NAME}=value`, NAME)).toBe('value')
  })

  it('answers undefined when the cookie is absent or there is no header', () => {
    expect(readCookie('other=1', NAME)).toBeUndefined()
    expect(readCookie(undefined, NAME)).toBeUndefined()
  })

  it('reads back what serialiseCookie wrote', () => {
    // The two halves meeting: a browser sends back the `name=value` pair from
    // the header this module produced, and nothing else in it.
    const header = serialiseCookie({ ...BASE, value: 'round-trip', maxAgeSeconds: 60 })
    const pair = header.split(';')[0] ?? ''

    expect(readCookie(pair, BASE.name)).toBe('round-trip')
  })
})
