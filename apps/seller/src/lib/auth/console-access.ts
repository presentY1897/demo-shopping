import type { Role } from '@shopping/shared'

/**
 * Who may open this console, and which routes are outside the guard.
 *
 * **This is the "may I enter" half of the two-layer rule** (TASK-0023 4장):
 * roles decide the app, permissions decide the action. It is stated as data
 * rather than as an `if` inside the guard so that the answer to "what does this
 * console require" is greppable, and so `docs/design/pages.md` 진입 가드 규약 and
 * the code can be read against each other.
 *
 * The role is granted only by an approved seller application (TASK-0108), which
 * is the single path to this console.
 */
export const CONSOLE_ROLES: readonly Role[] = ['SELLER_OWNER']

export const LOGIN_ROUTE = '/login'
export const NO_PERMISSION_ROUTE = '/no-permission'

/**
 * Routes the guard does not apply to.
 *
 * `/apply` is on the list without existing yet: the seller application screen is
 * TASK-0109, and it is by definition reached by somebody who has no seller role
 * — a guard that sent them to `/no-permission` would make applying impossible.
 * Listing it here is a route policy, not an API contract, so it costs nothing
 * until the screen lands (TASK-0023 9장, 2026-09-03).
 */
export const OPEN_ROUTES: readonly string[] = [LOGIN_ROUTE, NO_PERMISSION_ROUTE]

/** Routes that need a session but no role. */
export const SIGNED_IN_ONLY_ROUTES: readonly string[] = ['/apply']

/** Whether this console is one of the things the account can open. */
export function mayEnterConsole(roles: readonly Role[]): boolean {
  return roles.some((role) => CONSOLE_ROLES.includes(role))
}

/** True for a route rendered outside the console shell and outside the guard. */
export function isOpenRoute(pathname: string): boolean {
  return OPEN_ROUTES.includes(pathname)
}

/** True for a route that needs a session but not a role. */
export function isSignedInOnlyRoute(pathname: string): boolean {
  return SIGNED_IN_ONLY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
}
