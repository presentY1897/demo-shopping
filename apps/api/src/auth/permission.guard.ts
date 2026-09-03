import type { IncomingMessage } from 'node:http'

import type { CanActivate, ExecutionContext } from '@nestjs/common'
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Permission } from '@shopping/shared'
import { canPerform } from '@shopping/shared'

import { accessDenied } from './access-denied.js'
import type { PrincipalResolver } from './principal-resolver.js'
import { PRINCIPAL_RESOLVER } from './principal-resolver.js'
import { PUBLIC_ENDPOINT } from './public-endpoint.decorator.js'
import { REQUIRED_PERMISSION } from './require-permission.decorator.js'
import { attachPrincipal } from './request-principal.js'

/**
 * The global gate in front of every endpoint.
 *
 * **Deny by default.** A handler that declares neither `@RequirePermission()`
 * nor `@PublicEndpoint()` is refused, for everyone, including an administrator.
 * The alternative — treating silence as "open" — means a forgotten decorator
 * ships an unguarded endpoint and nothing anywhere says so (TASK-0105 R1). Here
 * a forgotten decorator produces a 403 on the first call and an error in the log
 * naming the handler, and `endpoint-coverage.spec.ts` fails the build before
 * that can even happen.
 *
 * The guard answers only the first half of the question — "may this role do this
 * at all". Whether it may do it *to that particular row* needs the row, which
 * only the service has; it calls `assertResourceAccess` once it has loaded it.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name)

  constructor(
    private readonly reflector: Reflector,
    @Inject(PRINCIPAL_RESOLVER) private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    )
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ENDPOINT, targets) ?? false

    if (permission === undefined || isPublic)
      return this.withoutPermission(context, permission, isPublic)

    const request = context.switchToHttp().getRequest<IncomingMessage>()
    const principal = await this.resolver.resolve(request)

    if (principal === null) {
      throw new UnauthorizedException('인증 정보가 없어 요청을 처리할 수 없습니다.')
    }

    attachPrincipal(request, principal)

    if (!canPerform(principal, permission)) {
      throw accessDenied(permission, 'missing_permission')
    }

    return true
  }

  /**
   * Handles the three declarations that carry no permission to check.
   *
   * A handler marked public *and* given a permission is a contradiction rather
   * than a preference, so it is refused too: guessing which one was meant would
   * either open something that was supposed to be guarded or silently ignore a
   * decorator someone wrote on purpose.
   */
  private withoutPermission(
    context: ExecutionContext,
    permission: Permission | undefined,
    isPublic: boolean,
  ): boolean {
    if (isPublic && permission === undefined) return true

    const handler = `${context.getClass().name}.${context.getHandler().name}`

    if (isPublic) {
      this.logger.error(
        `${handler} 이(가) @PublicEndpoint 와 @RequirePermission 을 함께 선언했습니다.`,
      )
      throw new ForbiddenException('엔드포인트 권한 선언이 잘못되었습니다.')
    }

    this.logger.error(`${handler} 에 퍼미션 선언이 없어 요청을 차단했습니다. (기본 거부)`)
    throw new ForbiddenException('엔드포인트에 퍼미션이 선언되지 않았습니다.')
  }
}
