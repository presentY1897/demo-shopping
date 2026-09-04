import { appIds } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { WebPorts } from './app-origins.js'
import { resolveAppOrigins } from './app-origins.js'

/**
 * The function that decides where a completed sign-in sends a browser
 * (TASK-0021 4장 「복귀 주소는 새 환경변수를 만들지 않는다」).
 *
 * Every case below is really one question asked twice: can any input produce an
 * origin that is not in the list it was handed? An open redirect on the sign-in
 * callback is a phishing page that shows a genuine Google consent screen first,
 * so `null` — an app that cannot start a sign-in — is the correct answer far
 * more often than a best guess would be.
 */

/** What `derived-env.ts` derives locally: BASE_PORTS shifted by PORT_OFFSET. */
const LOCAL_PORTS: WebPorts = { shop: 3040, seller: 3041, admin: 3042 }

/** Both loopback spellings, in the order `buildCorsOrigins` emits them. */
const LOCAL_ORIGINS = [
  'http://localhost:3040',
  'http://localhost:3041',
  'http://localhost:3042',
  'http://127.0.0.1:3040',
  'http://127.0.0.1:3041',
  'http://127.0.0.1:3042',
]

/** What `render.yaml` sets CORS_ORIGINS to. */
const DEPLOYED_ORIGINS = [
  'https://shop.demo-shopping.com',
  'https://seller.demo-shopping.com',
  'https://admin.demo-shopping.com',
]

describe('a deployment, where the app is in the host name', () => {
  it('gives each app the origin whose first label is its name', () => {
    expect(resolveAppOrigins(DEPLOYED_ORIGINS, null)).toEqual({
      shop: 'https://shop.demo-shopping.com',
      seller: 'https://seller.demo-shopping.com',
      admin: 'https://admin.demo-shopping.com',
    })
  })

  it('reads the label, not the domain, so a renamed domain needs no code change', () => {
    expect(resolveAppOrigins(['https://seller.example.test'], null).seller).toBe(
      'https://seller.example.test',
    )
  })
})

describe('a local checkout, where the apps differ only by port', () => {
  it('gives each app the origin on its own derived port', () => {
    expect(resolveAppOrigins(LOCAL_ORIGINS, LOCAL_PORTS)).toEqual({
      shop: 'http://localhost:3040',
      seller: 'http://localhost:3041',
      admin: 'http://localhost:3042',
    })
  })

  it('prefers localhost when both spellings are allowed', () => {
    // Both are in CORS_ORIGINS because a browser may be pointed at either, but a
    // `Location` header has to name one — and localhost is what the dev scripts
    // print and what a person has in their address bar.
    const reversed = [...LOCAL_ORIGINS].reverse()

    expect(resolveAppOrigins(reversed, LOCAL_PORTS).shop).toBe('http://localhost:3040')
  })

  it('falls back to 127.0.0.1 when that is the only spelling allowed', () => {
    expect(resolveAppOrigins(['http://127.0.0.1:3041'], LOCAL_PORTS).seller).toBe(
      'http://127.0.0.1:3041',
    )
  })

  it('will not hand an app an origin on a different port', () => {
    // The ports are one apart, so an off-by-one here would send a seller into
    // the shop after a sign-in that otherwise looked perfect.
    expect(resolveAppOrigins(['http://localhost:3041'], LOCAL_PORTS).shop).toBeNull()
  })
})

describe('which of the two rules wins', () => {
  it('takes the label ahead of the port, so a deployment is never at the mercy of one', () => {
    const mixed = ['http://localhost:3041', 'https://seller.demo-shopping.com']

    expect(resolveAppOrigins(mixed, LOCAL_PORTS).seller).toBe('https://seller.demo-shopping.com')
  })

  it('matches a custom local domain, which no port rule could', () => {
    // `seller.localhost` is a hostname the port rule rejects outright; the label
    // rule running first is the only reason this configuration works at all.
    expect(resolveAppOrigins(['http://seller.localhost:3041'], LOCAL_PORTS).seller).toBe(
      'http://seller.localhost:3041',
    )
  })
})

describe('an app this deployment cannot reach', () => {
  it('answers null rather than another app origin, which is the whole defence (F10)', () => {
    // The failure this forbids is silent: sending a seller to the shop looks
    // like a broken sign-in, and sending anybody to an address the operator
    // never listed is the open redirect itself.
    expect(resolveAppOrigins(['https://shop.demo-shopping.com'], null)).toEqual({
      shop: 'https://shop.demo-shopping.com',
      seller: null,
      admin: null,
    })
  })

  it('answers null for every app when nothing matches and no ports were derived', () => {
    // Production never derives ports, so a deployment that forgot CORS_ORIGINS
    // gets three refusals instead of three guesses.
    expect(resolveAppOrigins(['https://cdn.demo-shopping.com'], null)).toEqual({
      shop: null,
      seller: null,
      admin: null,
    })
  })

  it('answers null when the list is empty', () => {
    expect(resolveAppOrigins([], LOCAL_PORTS)).toEqual({ shop: null, seller: null, admin: null })
  })

  it('still names all three apps, so a caller reads null instead of undefined', () => {
    // `appOrigins[app] === null` is what turns into the 400; a missing key would
    // be `undefined` and would slip past a `=== null` check.
    expect(Object.keys(resolveAppOrigins([], null)).sort()).toEqual([...appIds].sort())
  })
})

describe('entries that are not origins at all', () => {
  it('skips what it cannot parse instead of throwing', () => {
    // CORS_ORIGINS is a hand-edited string in a deployment dashboard. A throw
    // here would be a process that refuses to boot over a stray character in a
    // list where every other entry is fine.
    const messy = ['not a url', 'http://localhost:3040', '://', 'https://admin.demo-shopping.com']

    expect(resolveAppOrigins(messy, LOCAL_PORTS)).toEqual({
      shop: 'http://localhost:3040',
      seller: null,
      admin: 'https://admin.demo-shopping.com',
    })
  })
})
