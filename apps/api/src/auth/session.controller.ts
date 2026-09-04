import type { IncomingMessage, ServerResponse } from 'node:http'

import { Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import type { AppId, SessionFailureReason, SessionResponse } from '@shopping/shared'
import { APP_ID_HEADER, isAppId } from '@shopping/shared'

import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import { domainFailure } from '../common/domain-failure.js'
import { readCookie } from './cookies.js'
import { PublicEndpoint } from './public-endpoint.decorator.js'
import { buildRefreshCookie, clearRefreshCookie, refreshCookieName } from './session-cookie.js'
import type { IssuedSession } from './session.service.js'
import { SessionService } from './session.service.js'

/**
 * Renewing and ending a session (TASK-0022).
 *
 * **Which app is asking comes from `X-App-Id`, not from the URL.** The three
 * consoles share one API, so the header is what selects the cookie name — and
 * the cookie name is what keeps their sessions apart (D-218). A request without
 * it cannot be served, because there is no cookie to read.
 *
 * `refresh` is `@PublicEndpoint`: its whole purpose is to be callable when the
 * access token has expired, which is exactly when the caller is anonymous. The
 * credential it checks is the cookie, not the bearer token.
 */
@Controller({ path: 'auth', version: '1' })
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @PublicEndpoint()
  async refresh(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionResponse> {
    const app = this.appOf(request)
    const presented = readCookie(request.headers.cookie, refreshCookieName(app))

    if (presented === undefined) throw this.refused('unknown')

    const outcome = await this.sessions.refresh(app, presented, metaOf(request))

    if (!outcome.ok) {
      // The cookie is cleared on every failure, including a replay: leaving a
      // dead credential in the browser makes the next call fail the same way
      // and turns one refusal into a loop.
      response.setHeader('Set-Cookie', clearRefreshCookie(app, this.sessions.cookieOptions()))
      throw this.refused(outcome.reason)
    }

    return this.respond(response, app, outcome.session)
  }

  /** Ends this app's session. Other apps keep theirs (D-218). */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PublicEndpoint()
  async logout(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const app = this.appOf(request)

    await this.sessions.logout(app, readCookie(request.headers.cookie, refreshCookieName(app)))

    response.setHeader('Set-Cookie', clearRefreshCookie(app, this.sessions.cookieOptions()))
  }

  /**
   * Ends every app's session for this account.
   *
   * **The credential is the cookie, not the access token.** Signing out
   * everywhere is most wanted precisely when something has gone wrong — a lost
   * laptop, a shared machine — and requiring a live access token would refuse
   * the request in the fifteen-minute window where it matters most. It is also
   * why this needs no permission: the caller proves who they are by holding a
   * refresh token, exactly as `logout` does.
   *
   * Only this app's cookie can be cleared — the other two are different names
   * and this response cannot touch them. They stop working anyway: their rows
   * are revoked, so the next renewal fails and the browser is told to drop them
   * then (TASK-0022 4장).
   */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PublicEndpoint()
  async logoutAll(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const app = this.appOf(request)

    await this.sessions.logoutEverywhere(
      app,
      readCookie(request.headers.cookie, refreshCookieName(app)),
    )

    response.setHeader('Set-Cookie', clearRefreshCookie(app, this.sessions.cookieOptions()))
  }

  private appOf(request: IncomingMessage): AppId {
    const header = request.headers[APP_ID_HEADER.toLowerCase()]
    const value = Array.isArray(header) ? header[0] : header

    if (!isAppId(value)) {
      throw new BadRequestException(
        domainFailure('INVALID', '어느 앱에서 온 요청인지 알 수 없어요.', { field: 'app' }),
      )
    }

    return value
  }

  /**
   * The 401 a failed renewal answers.
   *
   * `AUTH_REQUIRED` and not a new domain code: the vocabulary already has the
   * one that means "sign in again", and adding another would oblige each app's
   * message catalog to grow a sentence (TASK-0032 4.10). Which of the three
   * things went wrong travels on `details[].message`, where TASK-0023 can read
   * it without the envelope's code having to fork.
   */
  private refused(reason: SessionFailureReason): UnauthorizedException {
    return new UnauthorizedException(
      domainFailure(
        'AUTH_REQUIRED',
        reason === 'reused'
          ? '보안을 위해 로그아웃했어요. 다시 로그인해 주세요.'
          : '다시 로그인해 주세요.',
        { field: 'session', params: { reason } },
      ),
    )
  }

  private respond(response: ServerResponse, app: AppId, session: IssuedSession): SessionResponse {
    response.setHeader(
      'Set-Cookie',
      buildRefreshCookie(app, session.refreshToken, this.sessions.cookieOptions()),
    )

    return {
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt.toISOString(),
      user: {
        id: session.owner.userId,
        roles: [...session.owner.roles],
        sellerId: session.owner.sellerId,
      },
    }
  }
}

function metaOf(request: IncomingMessage): { userAgent?: string; ipAddress?: string } {
  const userAgent = request.headers['user-agent']
  const forwarded = request.headers['x-forwarded-for']
  const ipAddress = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded ?? request.socket.remoteAddress)

  return {
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof ipAddress === 'string' ? { ipAddress: ipAddress.split(',')[0]?.trim() } : {}),
  }
}
