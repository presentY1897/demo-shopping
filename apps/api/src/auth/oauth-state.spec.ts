import { describe, expect, it } from 'vitest'

import {
  buildStateCookie,
  clearStateCookie,
  decodeOauthState,
  encodeOauthState,
  newStateToken,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  OAUTH_STATE_PATH,
  readCookie,
  statesMatch,
} from './oauth-state.js'

/**
 * The CSRF defence of TASK-0021 4장 「state 는 DB 가 아니라 httpOnly 쿠키에 둔다」.
 *
 * Two things are being checked throughout: that a callback cannot be replayed or
 * forged, and that the cookie carrying the state actually survives the round
 * trip through Google. The second is the one no unit test would normally catch —
 * a wrong `SameSite` or a stray `Domain` breaks every sign-in in a real browser
 * while a spec that sets the header itself passes happily.
 */

const STATE = 'a'.repeat(64)

/** Everything a browser matches a cookie on, which is everything but the value. */
function attributesOf(cookie: string): string[] {
  return cookie.split('; ').slice(1)
}

describe('encoding the state and the app together', () => {
  it('round trips', () => {
    expect(decodeOauthState(encodeOauthState({ state: STATE, app: 'seller' }))).toEqual({
      state: STATE,
      app: 'seller',
    })
  })

  it('splits on the first separator only, so a dot in the state survives', () => {
    // Nothing promises the state is hex forever; splitting on the last dot, or
    // on every dot, would turn a future token format into "state mismatch" on
    // every sign-in.
    expect(decodeOauthState('shop.one.two')).toEqual({ state: 'one.two', app: 'shop' })
  })

  const REJECTED: [string, string | undefined][] = [
    ['there is no cookie at all', undefined],
    ['there is no separator', 'shopdeadbeef'],
    ['the app half is empty', `.${STATE}`],
    ['the state half is empty', 'shop.'],
    ['the app is not one of ours', `buyer.${STATE}`],
  ]

  it.each(REJECTED)('refuses a state where %s', (_case, raw) => {
    // Every one of these ends as a 400 rather than a redirect: a callback whose
    // cookie does not name an app has nowhere legitimate to send the browser.
    expect(decodeOauthState(raw)).toBeNull()
  })
})

describe('comparing the two copies of the state', () => {
  it('accepts a pair that matches', () => {
    expect(statesMatch(STATE, STATE)).toBe(true)
  })

  it('rejects a pair that does not', () => {
    expect(statesMatch(STATE, 'b'.repeat(64))).toBe(false)
  })

  it('answers false for different lengths instead of throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, and the query string is
    // attacker controlled — an unguarded call would turn a forged callback into
    // a 500 rather than a refusal, which is a denial of service anybody can
    // trigger and a stack trace in the log for every attempt.
    expect(() => statesMatch(STATE, 'short')).not.toThrow()
    expect(statesMatch(STATE, 'short')).toBe(false)
    expect(statesMatch('', STATE)).toBe(false)
  })
})

describe('the token itself', () => {
  it('is a fixed length hex string', () => {
    // Fixed length is what makes the length comparison above leak nothing.
    expect(newStateToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is different every time', () => {
    expect(newStateToken()).not.toBe(newStateToken())
  })
})

describe('the cookie the sign-in sets', () => {
  const cookie = buildStateCookie({ state: STATE, app: 'admin' }, { secure: false })

  it('carries the encoded state under the expected name', () => {
    expect(cookie.split('; ')[0]).toBe(`${OAUTH_STATE_COOKIE}=admin.${STATE}`)
  })

  it('is SameSite=Lax, without which no sign-in would ever complete', () => {
    // The callback is a top-level cross-site GET — the browser arrives from
    // accounts.google.com — and `Strict` withholds the cookie on exactly that
    // navigation. Every sign-in would fail as a state mismatch, and only in a
    // real browser: a spec that sets the Cookie header itself cannot see it.
    expect(attributesOf(cookie)).toContain('SameSite=Lax')
    expect(cookie).not.toContain('SameSite=Strict')
  })

  it('is HttpOnly, because nothing in a page has any use for it', () => {
    expect(attributesOf(cookie)).toContain('HttpOnly')
  })

  it('carries no Domain, so a sibling subdomain cannot read it (D-028)', () => {
    // A `Domain` would share this cookie across shop, seller and admin, which is
    // the same rule that lets the three consoles be open in three tabs at once.
    expect(cookie).not.toContain('Domain')
  })

  it('is scoped to the two endpoints that read it', () => {
    expect(attributesOf(cookie)).toContain(`Path=${OAUTH_STATE_PATH}`)
  })

  it('expires on its own, so a stale tab fails instead of lingering', () => {
    expect(attributesOf(cookie)).toContain(`Max-Age=${String(OAUTH_STATE_MAX_AGE_SECONDS)}`)
  })

  it('adds Secure only where the API is on https', () => {
    // Local development is http, so an unconditional `Secure` would mean the
    // cookie is never stored and every local sign-in fails.
    expect(cookie).not.toContain('Secure')
    expect(
      attributesOf(buildStateCookie({ state: STATE, app: 'shop' }, { secure: true })),
    ).toContain('Secure')
  })
})

describe('the cookie the callback sends back', () => {
  it('expires the value immediately, which is what makes a state single use', () => {
    const cleared = clearStateCookie({ secure: false })

    expect(cleared.split('; ')[0]).toBe(`${OAUTH_STATE_COOKIE}=`)
    expect(attributesOf(cleared)).toContain('Max-Age=0')
  })

  it.each([true, false])(
    'matches the set cookie attribute for attribute (secure: %s)',
    (secure) => {
      // A browser keys a cookie on name, domain and path. Clearing it with even
      // one attribute different deletes nothing and leaves the original in place —
      // a state that can then be replayed, which is the attack the clear exists to
      // prevent.
      const set = attributesOf(buildStateCookie({ state: STATE, app: 'shop' }, { secure }))
      const cleared = attributesOf(clearStateCookie({ secure }))
      const withoutMaxAge = (parts: string[]): string[] =>
        parts.filter((part) => !part.startsWith('Max-Age='))

      expect(withoutMaxAge(cleared)).toEqual(withoutMaxAge(set))
    },
  )
})

describe('reading one cookie out of a request', () => {
  it('finds it among the others a browser sends', () => {
    expect(
      readCookie(`other=1; ${OAUTH_STATE_COOKIE}=shop.${STATE}; last=2`, OAUTH_STATE_COOKIE),
    ).toBe(`shop.${STATE}`)
  })

  it('tolerates the spacing browsers actually use', () => {
    expect(readCookie(`  ${OAUTH_STATE_COOKIE} =  value  ;other=1`, OAUTH_STATE_COOKIE)).toBe(
      'value',
    )
  })

  it('does not answer with a cookie whose name merely starts the same', () => {
    // `shopping_oauth_state_v2` next to `shopping_oauth_state` is not a
    // hypothetical: a rename that ships alongside the old name would otherwise
    // make every sign-in compare the wrong value.
    const header = `${OAUTH_STATE_COOKIE}_v2=wrong; ${OAUTH_STATE_COOKIE}=right`

    expect(readCookie(header, OAUTH_STATE_COOKIE)).toBe('right')
  })

  it('keeps a value containing an equals sign intact', () => {
    expect(readCookie('token=YWJj==', 'token')).toBe('YWJj==')
  })

  it('skips a fragment that is not a pair at all', () => {
    expect(readCookie(`nonsense; ${OAUTH_STATE_COOKIE}=value`, OAUTH_STATE_COOKIE)).toBe('value')
  })

  it('answers undefined when the cookie is absent or there is no header', () => {
    expect(readCookie('other=1', OAUTH_STATE_COOKIE)).toBeUndefined()
    expect(readCookie(undefined, OAUTH_STATE_COOKIE)).toBeUndefined()
  })

  it('reads back what the sign-in wrote', () => {
    // The two halves meeting: what `buildStateCookie` serialises is what a
    // browser sends back on the callback, and it has to decode to the app the
    // sign-in started from.
    const value = encodeOauthState({ state: STATE, app: 'seller' })

    expect(
      decodeOauthState(readCookie(`${OAUTH_STATE_COOKIE}=${value}`, OAUTH_STATE_COOKIE)),
    ).toEqual({ state: STATE, app: 'seller' })
  })
})
