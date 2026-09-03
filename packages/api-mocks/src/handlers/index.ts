import type { RequestHandler } from 'msw'

import { healthHandlers } from './health'
import { userRolesHandlers } from './user-roles'

/**
 * What every front-end test starts from: the success answer for each endpoint
 * we mock.
 *
 * Anything else — a 500, an unreachable API, a stale payload — is declared by
 * the one spec that wants it via `server.use(...)`, so a test that says nothing
 * about failures is a test of the happy path and cannot become one by accident.
 */
export const defaultHandlers: readonly RequestHandler[] = [...healthHandlers, ...userRolesHandlers]

export { healthHandlers, userRolesHandlers }
