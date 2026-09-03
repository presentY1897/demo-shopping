import type { IncomingMessage } from 'node:http'

import type { RequestPrincipal } from './request-principal.js'

/** Injection token for {@link PrincipalResolver}. */
export const PRINCIPAL_RESOLVER = Symbol('PRINCIPAL_RESOLVER')

/**
 * Turns credentials on a request into a {@link RequestPrincipal}.
 *
 * The single place the application decides *who is calling*. Everything else —
 * the guard, the scope checks, the controllers — consumes the result, so the
 * authorization system can be finished, tested and reviewed before any of
 * authentication exists, and swapping the implementation changes exactly one
 * provider.
 *
 * Implementations must never throw for a missing or invalid credential: a
 * `null` means "anonymous", and it is the guard that decides whether anonymous
 * is good enough for the endpoint being called.
 */
export interface PrincipalResolver {
  resolve(request: IncomingMessage): Promise<RequestPrincipal | null>
}
