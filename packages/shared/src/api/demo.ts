import { z } from 'zod'

/**
 * Demo account issuing, as the API states it (TASK-0024).
 *
 * A visitor picks a **persona**, not a role. `BUYER | SELLER | ADMIN` are the
 * three things somebody can come here to try; which `Role` rows that turns into
 * is the server's decision and is deliberately not on the wire — the same
 * argument `auth/roles.ts` makes for there being no `DEMO_BUYER` role.
 *
 * **Nothing here carries `isDemo`.** What a screen needs to know is not whether
 * an account is a demo but **how long it has left**, and `User_demo_expiry_check`
 * makes the two questions the same one anyway. Keeping the expiry as the only
 * value that crosses the wire is what holds the containment guard of TASK-0105
 * F8 down to a single file in `apps/api` (TASK-0024 4.5).
 */

/** The three personas a visitor may ask for, one per app. */
export const demoRoles = ['BUYER', 'SELLER', 'ADMIN'] as const

export type DemoRole = (typeof demoRoles)[number]

export const demoRoleSchema = z.enum(demoRoles)

/** How long an issued account lives (DECISIONS 2 — 기본 24시간). */
export const DEMO_ACCOUNT_TTL_HOURS = 24

/**
 * How many accounts one address may be issued inside {@link DEMO_ISSUE_WINDOW_SECONDS}.
 *
 * The floor is three — somebody opening the three consoles in three tabs issues
 * three at once (TASK-0024 F7) — and the ceiling is what makes ten attempts in a
 * minute visibly refused (F6).
 */
export const DEMO_ISSUE_LIMIT = 5

export const DEMO_ISSUE_WINDOW_SECONDS = 60

/**
 * Body of `POST /api/v1/auth/demo`.
 *
 * `X-App-Id` decides which app's session is started; this says which persona was
 * asked for. They have to agree — a seller session living under the shop app's
 * cookie can never enter the seller console (D-218), so a disagreement is a
 * client bug and is answered 400 rather than obeyed (TASK-0024 4.1).
 */
export const demoIssueRequestSchema = z.object({ role: demoRoleSchema })

export type DemoIssueRequest = z.infer<typeof demoIssueRequestSchema>

/** A demo account, as every endpoint in this task answers with it. */
export const demoAccountSchema = z.object({
  role: demoRoleSchema,
  /** When the account and everything it created are deleted (TASK-0025). */
  expiresAt: z.iso.datetime(),
})

export type DemoAccount = z.infer<typeof demoAccountSchema>

/**
 * What `POST /api/v1/auth/demo` answers.
 *
 * **No access token, on purpose.** The refresh cookie is the whole of what this
 * response carries, exactly as the Google callback carries only the cookie
 * (TASK-0021 4장): the app exchanges it on its first `POST /auth/refresh`, which
 * is the code path every later renewal takes. A token here would be a second way
 * for a session to start, and there is no way to hand it to the session client
 * anyway.
 */
export const demoIssueResponseSchema = z.object({ demo: demoAccountSchema })

export type DemoIssueResponse = z.infer<typeof demoIssueResponseSchema>

/**
 * What `GET /api/v1/auth/demo` answers: the caller's own demo status.
 *
 * `null` for a real account, which is the answer the banner draws nothing for.
 * It is a separate request rather than a field on `SessionResponse` because the
 * session contract (TASK-0022) says what a *session* is; putting an account's
 * expiry in it would make all three apps' session types carry a demo concept for
 * the sake of one banner (TASK-0024 4.2).
 */
export const demoStatusResponseSchema = z.object({ demo: demoAccountSchema.nullable() })

export type DemoStatusResponse = z.infer<typeof demoStatusResponseSchema>
