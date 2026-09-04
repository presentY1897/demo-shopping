import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { AppId, DemoIssueResponse, DemoStatusResponse } from '@shopping/shared'
import { APP_ID_HEADER, demoIssueRequestSchema, isAppId } from '@shopping/shared'
import { z } from 'zod'

import { domainFailure } from '../common/domain-failure.js'
import { parseInput } from '../common/parse-input.js'
import { Principal } from '../auth/principal.decorator.js'
import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { buildRefreshCookie } from '../auth/session-cookie.js'
import { DemoCleanupService } from './demo-cleanup.service.js'
import { demoRoleMatchesApp, DEMO_ROLE_BY_APP } from './demo-persona.js'
import { DemoService } from './demo.service.js'

/** The path parameter, validated the way every other id on this API is. */
const demoUserIdSchema = z.uuid()

/**
 * Getting a demo account, and asking how long one has left (TASK-0024).
 *
 * **The issue endpoint is `@PublicEndpoint`.** Its entire purpose is to be
 * callable by somebody who has no account, which is the definition of anonymous;
 * `PermissionGuard` denies by default, so saying it out loud is what keeps the
 * open surface greppable.
 *
 * **The status endpoint is not.** It answers a question about the caller's own
 * account, so it takes `user.read` and resolves against the principal — there is
 * no id in the URL to get wrong.
 *
 * **Only the refresh cookie travels.** The response body has no access token, in
 * the shape and for the reason `GoogleAuthController` documents: a token in the
 * body would be a second way for a session to begin, and the app already knows
 * how to turn the cookie into one.
 */
@Controller({ path: 'auth/demo', version: '1' })
export class DemoController {
  constructor(
    private readonly demo: DemoService,
    private readonly cleanup: DemoCleanupService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @PublicEndpoint()
  async issue(
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<DemoIssueResponse> {
    const app = appOf(request)
    const { role } = parseInput(demoIssueRequestSchema, await readJsonBody(request))

    // The app decides where the session lives and the body says what was asked
    // for; a disagreement produces a session that can never enter the console it
    // was meant for, so it is refused rather than obeyed (TASK-0024 4.1).
    if (!demoRoleMatchesApp(app, role)) {
      throw new BadRequestException(
        domainFailure(
          'INVALID',
          `${app} 앱에서는 ${DEMO_ROLE_BY_APP[app]} 데모만 발급할 수 있어요.`,
          { field: 'role', params: { app, expected: DEMO_ROLE_BY_APP[app] } },
        ),
      )
    }

    const issued = await this.demo.issue(role, app, metaOf(request))

    response.setHeader(
      'Set-Cookie',
      buildRefreshCookie(app, issued.refreshToken, this.demo.cookieOptions()),
    )

    return { demo: issued.demo }
  }

  @Get()
  @RequirePermission('user.read')
  async status(@Principal() principal: RequestPrincipal): Promise<DemoStatusResponse> {
    return { demo: await this.demo.statusOf(principal.userId) }
  }

  /**
   * Brings a demo account's expiry forward to now (TASK-0025 F7).
   *
   * It does not delete anything — it makes the account **collectable**, and the
   * sweep that runs every fifteen minutes does the rest. Two paths into the same
   * deletion would be two places for the deletion rules to drift, and the rules
   * are the part of this task that loses data when they are wrong.
   *
   * `demo.manage` because this ends somebody else's session. The screen that
   * calls it is M14; the endpoint exists now because the sweep it feeds does.
   */
  @Post(':userId/expire')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('demo.manage')
  async expire(@Param('userId') userId: string): Promise<DemoStatusResponse> {
    const id = parseInput(demoUserIdSchema, userId, 'userId')

    // A plain 404, the way every other missing row on this API answers: the
    // status-derived `NOT_FOUND` is what the console's catalog looks up, and a
    // domain code here would be one nobody branches on.
    if (!(await this.cleanup.expireNow(id))) {
      throw new NotFoundException('만료시킬 데모 계정을 찾지 못했습니다.')
    }

    return { demo: await this.demo.statusOf(id) }
  }
}

/**
 * Which app is asking.
 *
 * From `X-App-Id` and not the URL, exactly as `SessionController` reads it: the
 * three consoles share one API and the header is what selects the cookie name,
 * which is what keeps their sessions apart (D-218).
 */
function appOf(request: IncomingMessage): AppId {
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
 * The parsed body, as Express already read it.
 *
 * Taken off the request rather than through `@Body()` so that this controller
 * keeps its `node:http` types — the repository has no `@types/express` and
 * `GoogleAuthController` avoided adding one for the same kind of reason.
 */
function readJsonBody(request: IncomingMessage): unknown {
  return (request as IncomingMessage & { body?: unknown }).body
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
