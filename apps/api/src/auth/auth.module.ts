import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { AnonymousPrincipalResolver } from './anonymous-principal.resolver.js'
import { GoogleAuthController } from './google-auth.controller.js'
import { GoogleAuthService } from './google-auth.service.js'
import { createGoogleOAuthClient, GOOGLE_OAUTH } from './google-oauth.client.js'
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
  controllers: [GoogleAuthController],
  providers: [
    { provide: PRINCIPAL_RESOLVER, useClass: AnonymousPrincipalResolver },
    { provide: APP_GUARD, useClass: PermissionGuard },
    GoogleAuthService,
    {
      // Bound from the validated configuration, so "Google is not set up here"
      // is decided once at boot rather than checked on every request — the same
      // shape `StorageModule` uses for R2 (TASK-0011 4.5).
      provide: GOOGLE_OAUTH,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createGoogleOAuthClient(config.googleOAuth),
    },
  ],
  exports: [PRINCIPAL_RESOLVER, GOOGLE_OAUTH],
})
export class AuthModule {}
