import type { IncomingMessage } from 'node:http'

import type { ExecutionContext } from '@nestjs/common'
import { createParamDecorator } from '@nestjs/common'

import { authRequired } from './permission.guard.js'
import type { RequestPrincipal } from './request-principal.js'
import { principalOf } from './request-principal.js'

/**
 * Injects the caller into a handler parameter.
 *
 * It never returns `null`: reaching a handler means {@link PermissionGuard} has
 * already resolved and attached a principal, so a missing one is a wiring bug —
 * a controller reached through some path that skipped the guard — and failing
 * loudly beats handing a service an anonymous subject that would then quietly
 * fail every `own` check.
 */
export const Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestPrincipal => {
    const principal = principalOf(context.switchToHttp().getRequest<IncomingMessage>())

    if (principal === null) throw authRequired()

    return principal
  },
)
