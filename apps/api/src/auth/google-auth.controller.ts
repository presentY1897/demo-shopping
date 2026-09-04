import type { IncomingMessage, ServerResponse } from 'node:http'

import { BadRequestException, Controller, Get, Query, Req, Res } from '@nestjs/common'
import { googleAuthorizeQuerySchema } from '@shopping/shared'

import { parseInput } from '../common/parse-input.js'
import { requestIdOf } from '../common/request-context.middleware.js'
import { GoogleAuthService } from './google-auth.service.js'
import { buildRefreshCookie } from './session-cookie.js'
import { SessionService } from './session.service.js'
import { readCookie } from './cookies.js'
import type { OauthState } from './oauth-state.js'
import {
  buildStateCookie,
  clearStateCookie,
  decodeOauthState,
  OAUTH_STATE_COOKIE,
} from './oauth-state.js'
import { PublicEndpoint } from './public-endpoint.decorator.js'

/**
 * Google sign-in over HTTP (TASK-0021).
 *
 * **Both endpoints are `@PublicEndpoint`.** `PermissionGuard` denies by default
 * — a handler that declares neither a permission nor this decorator answers 500
 * — and these two run before anyone is signed in, so there is no permission to
 * require. Saying it out loud is what keeps the public surface greppable.
 *
 * **Both answer with a redirect, never with the error envelope.** A browser
 * opens these addresses itself; JSON on the screen is what F5 forbids. The one
 * exception is a callback whose state cookie is unreadable — there is then no
 * app to return to, and inventing one would be the open redirect this design
 * exists to prevent.
 */
@Controller({ path: 'auth/google', version: '1' })
export class GoogleAuthController {
  constructor(
    private readonly auth: GoogleAuthService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Sends the browser on.
   *
   * Written out rather than using Express's `res.redirect`, so the types stay
   * `node:http` — the repository has no `@types/express` and adding one for two
   * calls would be a dependency to keep current forever. 302 is deliberate:
   * these are one-shot addresses that must never be cached or replayed.
   */
  private static redirect(response: ServerResponse, location: string): void {
    response.statusCode = 302
    response.setHeader('Location', location)
    response.setHeader('Cache-Control', 'no-store')
    response.end()
  }

  /**
   * Starts a sign-in.
   *
   * 302 rather than a JSON body carrying the URL: the caller is a link a person
   * clicks, and a page that has to fetch-then-navigate would break the back
   * button and add a round trip for nothing.
   */
  @Get()
  @PublicEndpoint()
  begin(
    @Req() request: IncomingMessage,
    @Query() query: unknown,
    @Res() response: ServerResponse,
  ): void {
    const { app } = parseInput(googleAuthorizeQuerySchema, query)

    // Refused before anything else happens: an app with no origin in the allow
    // list has nowhere to be sent back to (F10).
    if (this.auth.originOf(app) === null) {
      throw new BadRequestException(`${app} 앱은 이 환경에서 로그인할 수 없어요.`)
    }

    const { authorizeUrl, state } = this.auth.begin(
      app,
      this.auth.apiOriginOf(request.headers.host),
    )

    response.setHeader('Set-Cookie', buildStateCookie(state, this.auth.cookieOptions()))
    GoogleAuthController.redirect(response, authorizeUrl)
  }

  /**
   * Finishes a sign-in.
   *
   * The state cookie is read and expired before anything else, so a value can
   * never be presented twice — whether this call succeeds, fails, or was a
   * replay.
   */
  @Get('callback')
  @PublicEndpoint()
  async complete(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const cookie: OauthState | null = decodeOauthState(
      readCookie(request.headers.cookie, OAUTH_STATE_COOKIE),
    )

    response.setHeader('Set-Cookie', clearStateCookie(this.auth.cookieOptions()))

    // No cookie means no return address. Everything else in this flow answers
    // with a redirect; this is the one case where there is nowhere to redirect
    // to, and guessing an app would hand an attacker the open redirect.
    if (cookie === null) {
      throw new BadRequestException('로그인 요청이 만료됐어요. 다시 시도해 주세요.')
    }

    const outcome = await this.auth.complete({
      cookie,
      queryState: state,
      code,
      googleError: error,
      requestId: requestIdOf(request),
      apiOrigin: this.auth.apiOriginOf(request.headers.host),
    })

    // ⑤ of the flow in TASK-0021 4장, which that task left for this one. The
    // sign-in and the session are set in the *same* response: a redirect that
    // arrived without a cookie would land the browser on a login page that has
    // no way to tell it already succeeded.
    if (outcome.user !== null) {
      const session = await this.sessions.issue(
        {
          userId: outcome.user.userId,
          roles: outcome.user.roles,
          sellerId: outcome.user.sellerId,
        },
        cookie.app,
        { userAgent: headerOf(request, 'user-agent') },
      )

      response.appendHeader(
        'Set-Cookie',
        buildRefreshCookie(cookie.app, session.refreshToken, this.sessions.cookieOptions()),
      )
    }

    GoogleAuthController.redirect(response, outcome.redirectTo)
  }
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]

  return Array.isArray(value) ? value[0] : value
}
