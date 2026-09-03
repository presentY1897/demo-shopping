import type { IncomingMessage } from 'node:http'

import type { AppId, AuthorizationSubject } from '@shopping/shared'

/**
 * The caller of one request, as the authorization layer sees them.
 *
 * **This interface is the seam that authentication plugs into.** Nothing here
 * knows about JWTs, cookies or Google: TASK-0021 and TASK-0022 implement a
 * {@link PrincipalResolver} that produces this object, and every guard, scope
 * check and controller keeps working against the same three questions — who is
 * this, what roles do they hold, which store do they own.
 *
 * It extends `AuthorizationSubject` from `@shopping/shared` so the permission
 * decision itself stays pure and testable without an HTTP request in sight.
 */
export interface RequestPrincipal extends AuthorizationSubject {
  /** Which front-end the request came from, from `X-App-Id`. */
  readonly app: AppId | null
}

/**
 * Key the resolved principal is stashed under.
 *
 * A module-private symbol rather than a property name: a symbol cannot arrive
 * in a request body or a header, cannot be reached by `JSON.parse`, and cannot
 * be set by any code that has not imported this module. A string key on the
 * request would be forgeable the day some middleware merges untrusted input
 * into it.
 */
const PRINCIPAL = Symbol('requestPrincipal')

interface PrincipalCarrier {
  [PRINCIPAL]?: RequestPrincipal
}

/** Records who the caller is, for the rest of the request to read. */
export function attachPrincipal(request: IncomingMessage, principal: RequestPrincipal): void {
  ;(request as IncomingMessage & PrincipalCarrier)[PRINCIPAL] = principal
}

/** The caller, or `null` when the request never passed an authenticated guard. */
export function principalOf(request: IncomingMessage): RequestPrincipal | null {
  return (request as IncomingMessage & PrincipalCarrier)[PRINCIPAL] ?? null
}
