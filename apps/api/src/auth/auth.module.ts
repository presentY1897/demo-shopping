import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { AnonymousPrincipalResolver } from './anonymous-principal.resolver.js'
import { PermissionGuard } from './permission.guard.js'
import { PRINCIPAL_RESOLVER } from './principal-resolver.js'

/**
 * Wires authorization into the application.
 *
 * `APP_GUARD` is what makes the deny-by-default rule global: the guard runs for
 * every route in the process, including ones added by a module that never heard
 * of this one. Registering the guard per controller would put the rule back in
 * the hands of whoever writes the next controller.
 *
 * The resolver binding is the line TASK-0021/0022 change — from the anonymous
 * placeholder to a JWT-backed implementation — and nothing else moves.
 */
@Module({
  providers: [
    { provide: PRINCIPAL_RESOLVER, useClass: AnonymousPrincipalResolver },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PRINCIPAL_RESOLVER],
})
export class AuthModule {}
