import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { JwtClaims } from './jwt.js'
import { signJwt, verifyJwt } from './jwt.js'

/**
 * HS256 by hand (TASK-0022 4장 「JWT 를 라이브러리 없이 만든다」).
 *
 * Two different things are held here. The first is the ordinary contract —
 * claims survive a round trip, a wrong secret is refused, an expired token is
 * refused. The second is the property the hand-written module exists for: **the
 * algorithm is not a value.** `verifyJwt` recomputes an HS256 signature and
 * never looks at the `alg` the token claims, so alg confusion is not something
 * this module can be steered into. That is said below from both sides — editing
 * the header is a forgery because the signature covers it, and a header that
 * lies about `alg` while carrying a genuine HS256 signature verifies anyway,
 * because the field is inert. In a library this is the `algorithms: ['HS256']`
 * option, and forgetting it is the accident that has no expression here.
 *
 * Every instant is a fixed `Date` passed as an argument. The module takes `now`
 * for the same reason the lint rule in `eslint.config.mjs` forbids `new Date()`:
 * time is injected, so nothing here needs a faked system clock.
 */

/** Obvious placeholders. Nothing in this file signs anything anybody holds. */
const SECRET = 'test-secret'
const OTHER_SECRET = 'another-test-secret'

const ISSUED_SECONDS = 1_000_000
/** 15 minutes later — the access token lifetime of TASK-0022 4장. */
const EXPIRY_SECONDS = ISSUED_SECONDS + 900

const CLAIMS: JwtClaims = { sub: 'usr_01HQ', iat: ISSUED_SECONDS, exp: EXPIRY_SECONDS }

/** One second before `exp`, so a token signed for `CLAIMS` is still live. */
const BEFORE_EXPIRY = new Date((EXPIRY_SECONDS - 1) * 1000)
/** The very second `exp` names. The boundary is pinned below. */
const AT_EXPIRY = new Date(EXPIRY_SECONDS * 1000)
const AFTER_EXPIRY = new Date((EXPIRY_SECONDS + 3600) * 1000)

/** base64url, so the JSON a case is about stays readable in the case itself. */
function encode(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * A token made of exactly these two segments, with a real signature over them.
 *
 * The signature has to be real: `verifyJwt` checks it before it reads anything,
 * so a case about the *payload* only reaches the code it is about once the
 * signature has passed.
 */
function signed(header: string, payload: string): string {
  const input = `${header}.${payload}`
  const signature = createHmac('sha256', SECRET).update(input, 'utf8').digest('base64url')

  return `${input}.${signature}`
}

const HEADER = encode('{"alg":"HS256","typ":"JWT"}')

/** Replaces one segment of a token, leaving the other two exactly as they were. */
function withSegment(token: string, index: 0 | 1 | 2, replacement: string): string {
  const segments = token.split('.')
  segments[index] = replacement

  return segments.join('.')
}

describe('signing and verifying', () => {
  it('round trips the claims it was given', () => {
    expect(verifyJwt(signJwt(CLAIMS, SECRET), SECRET, BEFORE_EXPIRY)).toEqual({
      ok: true,
      claims: CLAIMS,
    })
  })

  it('carries any other claim through untouched', () => {
    // The resolver this feeds reads more than `sub` — the app a session belongs
    // to and the roles the PermissionGuard checks ride here too (TASK-0105).
    // A module that kept only the claims it knows about would silently drop them
    // and every authorised request would come back as an unprivileged one.
    const extended: JwtClaims = { ...CLAIMS, app: 'seller', roles: ['seller', 'buyer'] }

    expect(verifyJwt(signJwt(extended, SECRET), SECRET, BEFORE_EXPIRY)).toEqual({
      ok: true,
      claims: extended,
    })
  })

  it('writes one fixed header, so there is no alg to negotiate', () => {
    // Constructed here and never read back. Pinned byte for byte because this is
    // the half of «the algorithm is not a value» that lives on the signing side.
    expect(signJwt(CLAIMS, SECRET).split('.')[0]).toBe(HEADER)
  })
})

describe('the signature', () => {
  it('refuses a token signed with a different secret', () => {
    expect(verifyJwt(signJwt(CLAIMS, OTHER_SECRET), SECRET, BEFORE_EXPIRY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('refuses a payload edited after signing', () => {
    // One claim rewritten — `usr_01HQ` becomes somebody else — with the original
    // signature left in place. If this passed, any holder of any token could
    // issue themselves any subject and any role, and nothing downstream would
    // ever ask a second question: the whole point of a self-contained token is
    // that no request checks the database.
    const impersonated = withSegment(
      signJwt(CLAIMS, SECRET),
      1,
      encode(JSON.stringify({ ...CLAIMS, sub: 'usr_VICTIM' })),
    )

    expect(verifyJwt(impersonated, SECRET, BEFORE_EXPIRY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('answers rather than throwing when the signature is a different length', () => {
    // `timingSafeEqual` throws on a length mismatch, and the token is attacker
    // controlled — an unguarded call would turn every truncated or emptied
    // signature into a 500 and a stack trace in the log, which is a denial of
    // service anybody can trigger by sending nonsense.
    const emptied = withSegment(signJwt(CLAIMS, SECRET), 2, '')

    expect(() => verifyJwt(emptied, SECRET, BEFORE_EXPIRY)).not.toThrow()
    expect(verifyJwt(emptied, SECRET, BEFORE_EXPIRY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })
})

describe('the algorithm is not a value', () => {
  it('refuses a header rewritten to alg none with the signature emptied', () => {
    // The shape of the classic attack: claim there is no algorithm and send no
    // signature. It fails twice over — the header is covered by the signature,
    // and there is no code path that skips the comparison.
    const unsigned = `${encode('{"alg":"none"}')}.${encode(JSON.stringify(CLAIMS))}.`

    expect(verifyJwt(unsigned, SECRET, BEFORE_EXPIRY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('refuses a header rewritten to HS512, because the signature covers it', () => {
    const swapped = withSegment(signJwt(CLAIMS, SECRET), 0, encode('{"alg":"HS512","typ":"JWT"}'))

    expect(verifyJwt(swapped, SECRET, BEFORE_EXPIRY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it.each([
    ['none', '{"alg":"none"}'],
    ['HS512', '{"alg":"HS512","typ":"JWT"}'],
  ])('never reads the alg a token claims (%s)', (_case, headerJson) => {
    // The same property from the other side, and the reason the two refusals
    // above are structural rather than lucky. These tokens *say* something other
    // than HS256 and are accepted, because verification recomputes an HS256
    // signature and never consults the field. So `alg` steers nothing: rewriting
    // it cannot select a weaker check, cannot select "no check", and cannot make
    // a public key be read as an HMAC secret. A library reaches the same place
    // only by being told `algorithms: ['HS256']`, and the failure mode of
    // forgetting that option is not expressible here.
    const token = signed(encode(headerJson), encode(JSON.stringify(CLAIMS)))

    expect(verifyJwt(token, SECRET, BEFORE_EXPIRY)).toEqual({ ok: true, claims: CLAIMS })
  })
})

describe('strings that are not tokens', () => {
  const NOT_THREE_SEGMENTS: [string, string][] = [
    ['is empty', ''],
    ['is a single segment', 'not-a-token'],
    ['has one dot', `${HEADER}.${encode(JSON.stringify(CLAIMS))}`],
    ['has three dots', `${signJwt(CLAIMS, SECRET)}.extra`],
  ]

  it.each(NOT_THREE_SEGMENTS)('is malformed when the token %s', (_case, token) => {
    // Refused before any HMAC is computed. A parser that indexed into the split
    // anyway would hash `undefined` and answer `bad_signature`, which reads as
    // "someone is forging tokens" in a log where the truth is a truncated header.
    expect(verifyJwt(token, SECRET, BEFORE_EXPIRY)).toEqual({ ok: false, reason: 'malformed' })
  })

  const REFUSED_PAYLOADS: [string, string][] = [
    ['is not base64url, so it decodes to nothing', '!!!'],
    ['is JSON but not an object', encode('"a string"')],
    ['is JSON null', encode('null')],
    ['is an array rather than a claim set', encode('[]')],
    ['has no sub', encode(JSON.stringify({ iat: ISSUED_SECONDS, exp: EXPIRY_SECONDS }))],
    ['has an empty sub', encode(JSON.stringify({ ...CLAIMS, sub: '' }))],
    ['has an exp that is not a number', encode(JSON.stringify({ ...CLAIMS, exp: '1000900' }))],
    ['has an iat that is not a number', encode(JSON.stringify({ ...CLAIMS, iat: '1000000' }))],
  ]

  it.each(REFUSED_PAYLOADS)('is malformed when the payload %s', (_case, payload) => {
    // Every one of these is correctly signed, so the refusal comes from reading
    // the claims and not from the HMAC. That matters because the caller is our
    // own issuer: these are the shapes a token could take if something upstream
    // went wrong, and the guards are what stop `principal.userId` from becoming
    // `undefined` — an authenticated request belonging to nobody, which reaches
    // ownership checks (`assertResourceAccess`) as a value they compare against.
    expect(verifyJwt(signed(HEADER, payload), SECRET, BEFORE_EXPIRY)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('expiry', () => {
  const token = signJwt(CLAIMS, SECRET)

  it('accepts a token whose exp has not arrived', () => {
    expect(verifyJwt(token, SECRET, BEFORE_EXPIRY)).toEqual({ ok: true, claims: CLAIMS })
  })

  it('treats the exp second itself as expired', () => {
    // The boundary, pinned: the comparison is `<=`, so a token is dead for the
    // whole of the second it names rather than live for it. Fifteen minutes
    // either way is not a decision anybody argues about, but an implementation
    // that drifted to `<` would flip this test and nothing else — which is
    // exactly why the edge is written down instead of left to be re-derived.
    expect(verifyJwt(token, SECRET, AT_EXPIRY)).toEqual({ ok: false, reason: 'expired' })
  })

  it('reads the clock in whole seconds', () => {
    // `exp` is seconds since the epoch and `Date` is milliseconds; the module
    // floors. Without that, the 999 milliseconds after `exp` compare as a
    // fraction and a token stays valid for a second past its own expiry.
    expect(verifyJwt(token, SECRET, new Date(EXPIRY_SECONDS * 1000 - 1))).toEqual({
      ok: true,
      claims: CLAIMS,
    })
    expect(verifyJwt(token, SECRET, new Date(EXPIRY_SECONDS * 1000 + 999))).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('refuses a token whose exp is long past', () => {
    expect(verifyJwt(token, SECRET, AFTER_EXPIRY)).toEqual({ ok: false, reason: 'expired' })
  })

  it('reports a forgery as a forgery even when it is also expired', () => {
    // Order, and it is a disclosure rather than a preference. Answering
    // `expired` here would tell whoever sent this that their signature was
    // accepted and only the clock stopped them — which turns the module into an
    // oracle for guessing the secret: the forger learns from the *reason* that
    // they are one working token away. The signature is checked first, so a
    // forgery is indistinguishable from any other forgery.
    expect(verifyJwt(signJwt(CLAIMS, OTHER_SECRET), SECRET, AFTER_EXPIRY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })
})
