import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import type {
  AdjustPointsResponse,
  AdminUserDetailResponse,
  AdminUserListResponse,
} from '@shopping/shared'
import {
  adjustPointsRequestSchema,
  adminUserListQueryParamsSchema,
  suspendUserRequestSchema,
  viewUserRequestSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { AdminUserService } from './admin-user.service.js'

const userIdSchema = z.uuid()

/**
 * 질의 문자열은 전부 문자열이다.
 *
 * 참/거짓 칸을 계약에서 문자열로 두면 그 값이 서비스까지 문자열로 흘러가고, 거기서
 * `'false'` 는 참이 된다 — 「정지된 회원만」 필터가 조용히 전부를 보여 준다.
 * 계약은 `boolean` 으로 두고 **여기서** 옮긴다 (`search.controller.ts` 와 같은 모양).
 */
function readQuery(raw: Record<string, string>): Record<string, unknown> {
  return {
    ...raw,
    ...(raw.isDemo === undefined ? {} : { isDemo: raw.isDemo === 'true' }),
    ...(raw.suspended === undefined ? {} : { suspended: raw.suspended === 'true' }),
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
  }
}

/**
 * 관리자 회원 관리 (TASK-0093).
 *
 * ## 상세가 `POST` 인 이유
 *
 * 읽기인데 `GET` 이 아니다. **사유를 몸통으로 받아야 하기 때문**이고, 그것을 질의
 * 문자열에 실으면 사유가 접근 로그와 브라우저 기록에 그대로 남는다 — 개인정보를
 * 여는 이유가 개인정보만큼 조심스러울 수 있는데, 그 사유가 가장 안 지켜지는 곳에
 * 적히는 셈이다.
 *
 * 그리고 이 요청은 **부수효과가 있다.** 열람 기록 한 줄을 만든다. `GET` 이 그러면
 * 프리페치나 재시도가 조용히 기록을 늘린다.
 */
@Controller({ path: 'admin/users', version: '1' })
export class AdminUserController {
  constructor(private readonly users: AdminUserService) {}

  @Get()
  @RequirePermission('user.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: Record<string, string>,
  ): Promise<AdminUserListResponse> {
    return this.users.list(principal, parseInput(adminUserListQueryParamsSchema, readQuery(query)))
  }

  @Post(':userId/views')
  @RequirePermission('user.read')
  detail(
    @Principal() principal: RequestPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdminUserDetailResponse> {
    return this.users.detail(
      principal,
      parseInput(userIdSchema, userId, 'userId'),
      parseInput(viewUserRequestSchema, body).reason,
    )
  }

  /** 정지 (F4). `user.write` 라 데모 관리자는 여기까지 오지 못한다 (D-058). */
  @Post(':userId/suspension')
  @RequirePermission('user.write')
  @HttpCode(204)
  suspend(@Param('userId') userId: string, @Body() body: unknown): Promise<void> {
    return this.users.suspend(
      parseInput(userIdSchema, userId, 'userId'),
      parseInput(suspendUserRequestSchema, body),
    )
  }

  @Delete(':userId/suspension')
  @RequirePermission('user.write')
  @HttpCode(204)
  reinstate(@Param('userId') userId: string): Promise<void> {
    return this.users.reinstate(parseInput(userIdSchema, userId, 'userId'))
  }

  /** 적립금 수동 조정 (F5). 사유는 계약이 강제한다. */
  @Post(':userId/points')
  @RequirePermission('user.write')
  adjustPoints(
    @Principal() principal: RequestPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<AdjustPointsResponse> {
    return this.users.adjustPoints(
      principal,
      parseInput(userIdSchema, userId, 'userId'),
      parseInput(adjustPointsRequestSchema, body),
    )
  }
}
