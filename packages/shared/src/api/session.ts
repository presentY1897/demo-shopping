import { z } from 'zod'

import { roleSchema } from '../auth/roles.js'

/**
 * What a caller gets back when a session starts or is renewed (TASK-0022).
 *
 * **The refresh token is not in here.** It travels as an `HttpOnly` cookie and
 * is never readable by script — putting it in the body would hand it to any
 * XSS on the page, which is the whole reason for the cookie. What the body
 * carries is the access token, which lives in memory for fifteen minutes and is
 * meant to be read by the code that sends it.
 */
export const sessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  /** When the access token stops working, so a client can renew before a 401. */
  accessExpiresAt: z.iso.datetime(),
  user: z.object({
    id: z.uuid(),
    roles: z.array(roleSchema),
    /** The store this account owns, or `null`. `own` scopes resolve against it. */
    sellerId: z.string().nullable(),
  }),
})

export type SessionResponse = z.infer<typeof sessionResponseSchema>

/**
 * Why a renewal was refused.
 *
 * `reused` is the one worth telling apart: it means the session was ended on
 * purpose because a revoked token came back, and the person has to sign in
 * again rather than retry. TASK-0023 turns these into sentences.
 */
export const sessionFailureReasons = ['unknown', 'expired', 'reused'] as const

export type SessionFailureReason = (typeof sessionFailureReasons)[number]
