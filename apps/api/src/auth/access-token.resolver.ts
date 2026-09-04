import type { IncomingMessage } from 'node:http'

import { Inject, Injectable } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { verifyJwt } from './jwt.js'
import type { PrincipalResolver } from './principal-resolver.js'
import type { RequestPrincipal } from './request-principal.js'
import { principalFromClaims } from './session.service.js'

const BEARER = /^Bearer (.+)$/

/**
 * Who is calling, according to the access token (TASK-0022).
 *
 * Replaces `AnonymousPrincipalResolver`, which is the one provider TASK-0021
 * and this task were always going to change (`auth.module.ts`). Nothing else
 * moves: `PermissionGuard`, `assertResourceAccess` and every controller keep
 * reading the same {@link RequestPrincipal}, which is now filled in.
 *
 * **It never throws and never answers 401.** A missing, malformed, expired or
 * forged token all resolve to `null` — anonymous — and the guard decides
 * whether anonymous is good enough for the endpoint being called. That is what
 * lets a `@PublicEndpoint` keep working for a signed-out visitor whose browser
 * still holds a stale token, and it is stated as a contract on
 * {@link PrincipalResolver} rather than left to each implementation.
 *
 * **No database query.** The claims carry the roles and the store, which is the
 * whole reason the access token is self-contained; a lookup here would put a
 * query back on every authorised request and make the JWT pointless.
 */
@Injectable()
export class AccessTokenPrincipalResolver implements PrincipalResolver {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  resolve(request: IncomingMessage): Promise<RequestPrincipal | null> {
    return Promise.resolve(this.read(request))
  }

  private read(request: IncomingMessage): RequestPrincipal | null {
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1]
    if (token === undefined) return null

    const verified = verifyJwt(token, this.config.auth.jwtSecret, this.clock.now())
    if (!verified.ok) return null

    return principalFromClaims(verified.claims)
  }
}
