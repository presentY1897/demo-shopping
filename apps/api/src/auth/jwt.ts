import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HS256 JSON Web Tokens, by hand (TASK-0022 4장 「JWT 를 라이브러리 없이 만든다」).
 *
 * **Why not `@nestjs/jwt`.** The surface actually used here is two functions —
 * one signature, one verification. The refresh token is not a JWT at all: the
 * schema stores a digest of an opaque value because rotation and reuse
 * detection have to consult the database anyway, and a self-contained token
 * has no way to express "revoked". `jsonwebtoken` would bring twelve to fifteen
 * packages, seven of them lodash micro-modules, to serve that. This repository
 * already hand-writes AWS SigV4 signing (`storage/sigv4.ts`, 259 lines), which
 * is harder crypto than this file.
 *
 * **The algorithm is not a value.** The header is constructed here, never read
 * back, and {@link verifyJwt} recomputes the signature the only way it knows
 * how. There is no input that makes this module verify anything but HS256 —
 * which is the class of mistake `algorithms: ['HS256']` exists to prevent in
 * libraries that do read the header.
 */

/** The only header this module produces, and the only one it will accept. */
const HEADER = { alg: 'HS256', typ: 'JWT' } as const

/** Claims every token carries. Anything else is the caller's business. */
export interface JwtClaims {
  /** Subject — the user id. */
  readonly sub: string
  /** Expiry, seconds since the epoch (the JWT spec's unit, not milliseconds). */
  readonly exp: number
  /** Issued at, seconds since the epoch. */
  readonly iat: number
  readonly [claim: string]: unknown
}

export type JwtFailure =
  /** Not three dot-separated segments, or a segment is not base64url JSON. */
  | 'malformed'
  /** The signature does not match — a different secret, or a forged token. */
  | 'bad_signature'
  /** Well-formed and correctly signed, but `exp` has passed. */
  | 'expired'

export type JwtVerification =
  | { readonly ok: true; readonly claims: JwtClaims }
  | { readonly ok: false; readonly reason: JwtFailure }

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signingInput(header: string, payload: string): string {
  return `${header}.${payload}`
}

function signature(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('base64url')
}

/**
 * Signs a set of claims.
 *
 * `exp` and `iat` are the caller's to supply: the time comes from the `Clock`
 * port, and a token module that read the system clock would be the one place in
 * `apps/api` that could not be tested at a fixed instant.
 */
export function signJwt(claims: JwtClaims, secret: string): string {
  const input = signingInput(encode(HEADER), encode(claims))

  return `${input}.${signature(input, secret)}`
}

/**
 * Compares two signatures without leaking where they first differ.
 *
 * A length mismatch answers `false` rather than throwing, which `timingSafeEqual`
 * does when its arguments differ in size — and a forged token is exactly the
 * input that produces one.
 */
function signatureMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)

  return left.length === right.length && timingSafeEqual(left, right)
}

function decodeClaims(segment: string): JwtClaims | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const claims = parsed as Record<string, unknown>
  if (typeof claims.sub !== 'string' || claims.sub === '') return null
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') return null

  return claims as unknown as JwtClaims
}

/**
 * Verifies a token and returns its claims.
 *
 * Answers a value rather than throwing: the caller is a resolver that has to
 * distinguish "no credentials" from "bad credentials" without either becoming a
 * stack trace, and an exception for the ordinary case of an expired token would
 * be control flow dressed as an error.
 *
 * **The signature is checked before the claims are read.** An expired-but-forged
 * token is a forgery, and reporting it as `expired` would tell an attacker their
 * signature was accepted.
 */
export function verifyJwt(token: string, secret: string, now: Date): JwtVerification {
  const segments = token.split('.')
  if (segments.length !== 3) return { ok: false, reason: 'malformed' }

  const [header, payload, provided] = segments as [string, string, string]

  if (!signatureMatches(signature(signingInput(header, payload), secret), provided)) {
    return { ok: false, reason: 'bad_signature' }
  }

  const claims = decodeClaims(payload)
  if (claims === null) return { ok: false, reason: 'malformed' }

  // RFC 7519: the current time must be *before* `exp`, so the second `exp`
  // names is already too late. Seconds, floored, because that is the unit the
  // claim is in — comparing against milliseconds would keep every token alive
  // for a thousand times its lifetime.
  if (claims.exp <= Math.floor(now.getTime() / 1000)) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, claims }
}
