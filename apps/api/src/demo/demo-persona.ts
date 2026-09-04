import type { AppId, DemoRole, Role } from '@shopping/shared'

/**
 * Which persona each app issues, and what it grants (TASK-0024 4.1).
 *
 * Two tables and their inverse, with no I/O, so the pairing that decides a 400
 * and the grant that decides what a visitor may do are both reachable from a
 * unit test.
 *
 * **The app decides where the session lives; the body says what was asked for.**
 * They have to agree. A seller session issued under the shop app's cookie name
 * can never enter the seller console — the console reads only its own cookie
 * (D-218) — so obeying the mismatch would produce a visitor who is signed in and
 * can go nowhere. That failure has no error message anywhere, which is why it is
 * refused at the door instead.
 */
export const DEMO_ROLE_BY_APP: Readonly<Record<AppId, DemoRole>> = {
  shop: 'BUYER',
  seller: 'SELLER',
  admin: 'ADMIN',
}

/**
 * The roles an issued account is granted.
 *
 * **A list per persona, not one role.** The seller persona is granted
 * `SELLER_OWNER` by the store it opens (`SellerService.openDemoStore`), so this
 * table names what the issuing path grants *before* any seeder runs — which is
 * why `SELLER` maps to nothing here rather than to `SELLER_OWNER`.
 *
 * The admin persona is granted `DEMO_ADMIN` and nothing else. Adding `BUYER`
 * would hand it `seller.write:own` — the ability to apply as a seller — which is
 * not what a visitor asked for when they chose the admin console, and D-058
 * describes the demo administrator as `ADMIN_OPERATOR` narrowed, not widened.
 */
export const DEMO_GRANTS: Readonly<Record<DemoRole, readonly Role[]>> = {
  BUYER: ['BUYER'],
  SELLER: [],
  ADMIN: ['DEMO_ADMIN'],
}

/** Whether this app may issue this persona. */
export function demoRoleMatchesApp(app: AppId, role: DemoRole): boolean {
  return DEMO_ROLE_BY_APP[app] === role
}

/**
 * Which persona an account's roles say it is.
 *
 * The inverse of {@link DEMO_GRANTS}, for `GET /auth/demo`: the answer has to be
 * read back off the account rather than remembered from the issue, because the
 * banner is drawn on every page load for the next twenty-four hours and nothing
 * carries the original request that far.
 *
 * Ordered, and the order is the point. A seller demo holds `SELLER_OWNER`, an
 * admin demo holds `DEMO_ADMIN`, and anything else is a buyer — including a
 * demo account whose roles were changed after it was issued, which is a state
 * this has to answer *something* sensible for rather than fail on.
 */
export function demoRoleOfGrants(roles: readonly Role[]): DemoRole {
  if (roles.includes('DEMO_ADMIN')) return 'ADMIN'
  if (roles.includes('SELLER_OWNER')) return 'SELLER'

  return 'BUYER'
}
