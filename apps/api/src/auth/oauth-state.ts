import { randomBytes, timingSafeEqual } from 'node:crypto'

import type { AppId } from '@shopping/shared'
import { isAppId } from '@shopping/shared'

/**
 * The one-time value that ties a callback to the browser that started it
 * (TASK-0021 4장 「state 는 DB 가 아니라 httpOnly 쿠키에 둔다」).
 *
 * **Why a cookie and not a table.** `schema.prisma` belongs to TASK-0020/0032
 * and this task changes no schema; a table would also need an expiry sweep for
 * rows nobody will ever read again. A cookie expires by itself.
 *
 * **Why it is safe without a signature.** The check is a double submit: the
 * value arrives once in the query, put there by Google from what we sent, and
 * once in a cookie only this origin can set. An attacker who could write the
 * victim's cookie could equally write the query parameter, so signing would
 * defend against nobody — what does the work is that the cookie is `HttpOnly`
 * and carries no `Domain`.
 */
export const OAUTH_STATE_COOKIE = 'shopping_oauth_state'

/**
 * Scoped to the two endpoints that read it.
 *
 * A cookie on `/` would ride along on every API call for ten minutes, which is
 * ten minutes of a value nothing else has any use for.
 */
export const OAUTH_STATE_PATH = '/api/v1/auth/google'

/** Long enough to read a consent screen, short enough that a stale tab fails. */
export const OAUTH_STATE_MAX_AGE_SECONDS = 600

/** 256 bits, hex encoded. Guessing is not a threat model this has to survive. */
const STATE_BYTES = 32

export interface OauthState {
  readonly state: string
  /**
   * Which app the sign-in started from.
   *
   * **Kept here rather than in the callback's query string.** The callback URL
   * is a single API address shared by all three apps, so something has to say
   * where to return to — and if that something were a query parameter, an
   * attacker could hand a person a link that completed a real sign-in and then
   * bounced them to a different console. Carrying it in the cookie means the
   * return address is whatever *this browser* asked for.
   */
  readonly app: AppId
}

export function newStateToken(): string {
  return randomBytes(STATE_BYTES).toString('hex')
}

/** `<app>.<state>`; neither half can contain the separator. */
export function encodeOauthState({ state, app }: OauthState): string {
  return `${app}.${state}`
}

export function decodeOauthState(raw: string | undefined): OauthState | null {
  if (raw === undefined) return null

  const separator = raw.indexOf('.')
  if (separator <= 0) return null

  const app = raw.slice(0, separator)
  const state = raw.slice(separator + 1)

  if (!isAppId(app) || state === '') return null

  return { app, state }
}

/**
 * Compares two state values without leaking where they first differ.
 *
 * A mismatched length answers `false` without comparing, which does leak the
 * length — of a value this process generated at a fixed length, so there is
 * nothing to learn.
 */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  return left.length === right.length && timingSafeEqual(left, right)
}

export interface CookieOptions {
  /** `true` outside development, where the API is not on https. */
  readonly secure: boolean
}

function serialise(value: string, maxAgeSeconds: number, { secure }: CookieOptions): string {
  const parts = [
    `${OAUTH_STATE_COOKIE}=${value}`,
    `Path=${OAUTH_STATE_PATH}`,
    `Max-Age=${String(maxAgeSeconds)}`,
    'HttpOnly',
    // Lax, not Strict. The callback is a top-level cross-site GET — the browser
    // arrives from accounts.google.com — and `Strict` withholds cookies on
    // exactly that navigation. Every sign-in would then fail as a state
    // mismatch, and it would fail only in a real browser: a spec that sets the
    // header itself would pass (TASK-0021 4장).
    'SameSite=Lax',
  ]

  if (secure) parts.push('Secure')

  // No `Domain`: D-028 keeps the three apps' cookies unshareable, and this one
  // follows the same rule so that nothing on a sibling subdomain can read it.
  return parts.join('; ')
}

export function buildStateCookie(value: OauthState, options: CookieOptions): string {
  return serialise(encodeOauthState(value), OAUTH_STATE_MAX_AGE_SECONDS, options)
}

/**
 * Expires the cookie.
 *
 * Sent on **every** callback, successful or not, so a state can never be
 * replayed. The attributes have to match the ones it was set with or the
 * browser treats it as a different cookie and keeps the original.
 */
export function clearStateCookie(options: CookieOptions): string {
  return serialise('', 0, options)
}

/**
 * Reads one cookie out of a `Cookie` header.
 *
 * Hand-rolled rather than adding `cookie-parser`: the API has no cookie
 * middleware and this is the first thing in the repository that needs to read
 * one. A dependency and a global middleware for a single header, parsed in one
 * place, would be more moving parts than the parsing.
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
