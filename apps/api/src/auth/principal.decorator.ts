import type { IncomingMessage } from 'node:http'

import type { ExecutionContext } from '@nestjs/common'
import { createParamDecorator, UnauthorizedException } from '@nestjs/common'

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

    if (principal === null) {
      throw new UnauthorizedException('인증 정보가 없어 요청을 처리할 수 없습니다.')
    }

    return principal
  },
)
