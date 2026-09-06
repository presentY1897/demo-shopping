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

/**
 * 같은 값을, **없어도 되는 자리**에 (TASK-0084).
 *
 * `@PublicEndpoint` 인 라우트가 로그인한 사람에게만 한 칸 더 답할 때 쓴다 — 리뷰
 * 목록의 「내가 도움돼요를 눌렀는가」가 그런 칸이다. {@link Principal} 은 없으면
 * 던지고, 그것이 옳다: 퍼미션을 요구하는 라우트에서 주체가 비어 있는 것은 배선
 * 사고다. 공개 라우트에서는 비어 있는 것이 **정상**이라 두 자리가 같은 데코레이터를
 * 쓸 수 없다.
 *
 * 나누지 않고 「없으면 null」 하나로 두는 길도 있었지만, 그러면 퍼미션 라우트의
 * 배선 사고가 조용히 익명 주체로 흘러 `own` 검사를 전부 실패시킨다 — 증상이 403 이라
 * 원인을 찾는 데 오래 걸린다.
 */
export const OptionalPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestPrincipal | null =>
    principalOf(context.switchToHttp().getRequest<IncomingMessage>()),
)
