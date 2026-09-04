import { z } from 'zod'

import { appIds } from './app-id.js'

/**
 * What the OAuth callback tells an app when it sends the browser back
 * (TASK-0021 4장 「실패는 봉투가 아니라 리다이렉트로 답한다」).
 *
 * **Why this is not a `domainErrorCode`.** Those are the vocabulary of the JSON
 * error envelope, and every one of them obliges each app's message catalog to
 * grow a sentence — the catalogs are typed `Record<UserFacingErrorCode, string>`
 * and an unanswered code fails `pnpm typecheck` (TASK-0032 4.10). The callback
 * has no envelope to put a code in: a browser opens it directly, so anything but
 * a redirect shows a person raw JSON, which is exactly what F5 forbids.
 *
 * So the contract is the query string of the redirect, and this file is the one
 * place that spells it. TASK-0021 writes these values and TASK-0023 renders
 * them; neither restates the list.
 */
export const oauthOutcomes = ['ok', 'cancelled', 'error'] as const

export type OauthOutcome = (typeof oauthOutcomes)[number]

/**
 * Why a sign-in did not complete, when the reason is worth telling apart.
 *
 * Deliberately coarse. A person who could not sign in needs to know whether to
 * try again, and nothing here is actionable beyond that — the detail that helps
 * an operator goes to the server log next to the `requestId` (R4), not into a
 * URL the person is about to read.
 */
export const oauthFailureReasons = [
  /** `state` was absent, stale, replayed or did not match its cookie. */
  'state_mismatch',
  /** Google refused the authorization code, or answered something unreadable. */
  'exchange_failed',
  /** The access token was accepted but the profile could not be read. */
  'profile_failed',
  /** This deployment has no Google credentials (TASK-0021 4장 세트 검증). */
  'not_configured',
] as const

export type OauthFailureReason = (typeof oauthFailureReasons)[number]

/**
 * Something true about a sign-in that succeeded but is not what the person
 * expected.
 *
 * `no_role` is the only one so far: signing in to the seller or admin console
 * with an account that has no such role works — a `User` exists and the session
 * will be real — but the console has nothing to show. D-016 keeps role grants
 * out of the login path on purpose, so this is a normal outcome rather than a
 * failure, and it is carried separately from {@link oauthFailureReasons} for
 * that reason.
 */
export const oauthNotices = ['no_role'] as const

export type OauthNotice = (typeof oauthNotices)[number]

/** Query parameter names, so writer and reader cannot drift on a spelling. */
export const OAUTH_RESULT_PARAMS = {
  status: 'status',
  reason: 'reason',
  notice: 'notice',
} as const

export const oauthResultSchema = z.object({
  status: z.enum(oauthOutcomes),
  reason: z.enum(oauthFailureReasons).optional(),
  notice: z.enum(oauthNotices).optional(),
})

export type OauthResult = z.infer<typeof oauthResultSchema>

/** Where an app's sign-in page lives, relative to its own origin. */
export const LOGIN_PATH = '/login'

export const googleAuthorizeQuerySchema = z.object({
  app: z.enum(appIds),
})

export type GoogleAuthorizeQuery = z.infer<typeof googleAuthorizeQuerySchema>

/**
 * Builds the URL the callback redirects to.
 *
 * Takes the origin already chosen from the allow list rather than an app id: the
 * choice is what makes an open redirect impossible (TASK-0021 4장), and a helper
 * that accepted an id could be called with an origin nobody vetted.
 */
export function buildOauthRedirect(origin: string, result: OauthResult): string {
  const url = new URL(LOGIN_PATH, origin)

  url.searchParams.set(OAUTH_RESULT_PARAMS.status, result.status)
  if (result.reason !== undefined) url.searchParams.set(OAUTH_RESULT_PARAMS.reason, result.reason)
  if (result.notice !== undefined) url.searchParams.set(OAUTH_RESULT_PARAMS.notice, result.notice)

  return url.toString()
}

/**
 * Reads the contract back off a sign-in page's query string.
 *
 * Unknown values are dropped rather than refused. The page is what a person
 * lands on after a round trip through a third party, and refusing to render it
 * because a parameter was mangled would replace a recoverable state with a dead
 * end — TASK-0023 shows the generic sentence when this answers `null`.
 */
export function parseOauthResult(search: URLSearchParams): OauthResult | null {
  const parsed = oauthResultSchema.safeParse({
    status: search.get(OAUTH_RESULT_PARAMS.status) ?? undefined,
    reason: search.get(OAUTH_RESULT_PARAMS.reason) ?? undefined,
    notice: search.get(OAUTH_RESULT_PARAMS.notice) ?? undefined,
  })

  return parsed.success ? parsed.data : null
}
