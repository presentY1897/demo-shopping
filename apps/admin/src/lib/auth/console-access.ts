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
 * All three administrator roles enter. `DEMO_ADMIN` is `ADMIN_OPERATOR` with its
 * writes narrowed to demo-created rows (`role-permissions.ts`), so keeping it out
 * of the console would make the demo administrator a role nobody can use — which
 * is the opposite of why it exists.
 */
export const CONSOLE_ROLES: readonly Role[] = ['ADMIN_OPERATOR', 'ADMIN_SUPER', 'DEMO_ADMIN']

export const LOGIN_ROUTE = '/login'
export const NO_PERMISSION_ROUTE = '/no-permission'

/**
 * Routes the guard does not apply to.
 *
 * Administrator roles are granted by hand (TASK-0021 4장), so there is no
 * application screen to let through — unlike `apps/seller`, whose `/apply` is a
 * route the guard has to leave open.
 */
export const OPEN_ROUTES: readonly string[] = [LOGIN_ROUTE, NO_PERMISSION_ROUTE]

/** Routes that need a session but no role. There are none here. */
export const SIGNED_IN_ONLY_ROUTES: readonly string[] = []

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
