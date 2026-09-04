import type { Role, SessionResponse } from '@shopping/shared'
import { sessionResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * Sessions, one per role a console guard has to tell apart (TASK-0023).
 *
 * **`accessExpiresAt` is a fixed far-future instant, not `Date.now() + 15m`.**
 * A fixture is parsed once at module load and frozen, so a value computed from
 * the clock would be minutes old by the time a slow spec file reached it — and
 * the client refreshes proactively before expiry, which would turn a stale
 * fixture into an extra request nobody asked for. Anything that needs an
 * *expired* token builds one itself; that is a property of the test, not of the
 * contract.
 */
const FAR_FUTURE = '2099-01-01T00:00:00.000Z'

/** UUIDv7, the id format every account row uses. */
const USER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001'
const SELLER_USER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0002'
const ADMIN_USER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0003'

/**
 * The store a `SELLER_OWNER` session resolves `own` scopes against.
 *
 * Not exported: `registry.spec.ts` requires every export of a fixture file to be
 * a fixture, and a caller that needs the id reads it off the session it already
 * has (`sessionSellerOwner.user.sellerId`) rather than from a second constant
 * that could drift from it.
 */
const SELLER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f1001'

function session(
  id: string,
  roles: readonly Role[],
  sellerId: string | null = null,
): SessionResponse {
  return defineFixture(sessionResponseSchema, {
    accessToken: `mock.access.${roles.join('-').toLowerCase() || 'none'}`,
    accessExpiresAt: FAR_FUTURE,
    user: { id, roles: [...roles], sellerId },
  })
}

/** A signed-in shopper. Enters `apps/shop`, neither console. */
export const sessionBuyer = session(USER_ID, ['BUYER'])

/**
 * Somebody who has applied to sell and has not been approved.
 *
 * A `Seller` row exists — so `sellerId` is set — but `SELLER_OWNER` is granted
 * only on approval (TASK-0108), which is what keeps them out of the console.
 * The fixture cannot say *which* non-approved state it is: the session carries
 * no `Seller.status` and TASK-0023 4장 refuses to guess.
 */
export const sessionSellerApplicant = session(SELLER_USER_ID, ['BUYER'], SELLER_ID)

/** An approved seller. Enters `apps/seller`. */
export const sessionSellerOwner = session(SELLER_USER_ID, ['BUYER', 'SELLER_OWNER'], SELLER_ID)

/**
 * The everyday operator: every `*.read`, a limited set of writes.
 *
 * The role that makes the permission hook visible — it holds `catalog.write`
 * and **not** `catalog.delete`, which is exactly what the category console's
 * delete button is gated on.
 */
export const sessionAdminOperator = session(ADMIN_USER_ID, ['ADMIN_OPERATOR'])

/** The platform owner. Everything, everywhere. */
export const sessionAdminSuper = session(ADMIN_USER_ID, ['ADMIN_SUPER'])

/** `ADMIN_OPERATOR` with its writes narrowed to demo-created rows. */
export const sessionDemoAdmin = session(ADMIN_USER_ID, ['DEMO_ADMIN'])
