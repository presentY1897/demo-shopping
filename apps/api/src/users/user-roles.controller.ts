import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import type { Role, UserRolesResponse } from '@shopping/shared'
import { grantRoleRequestSchema, roleSchema } from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { UserRolesService } from './user-roles.service.js'

/** Ids are UUIDv7; anything else is a bad request, not a database error. */
const userIdSchema = z.uuid()

/**
 * Granting and revoking roles (TASK-0105 2 — "역할 부여·회수 API").
 *
 * Not mounted under `/admin` even though it is an administrative action: who may
 * call it is decided by the permission table, not by the URL. `user.read:own`
 * makes the listing an account's view of its own roles, and only `ADMIN_SUPER`
 * holds `user.write`, so the two mutations are super-admin only without this
 * controller knowing anything about roles.
 */
@Controller({ path: 'users/:userId/roles', version: '1' })
export class UserRolesController {
  constructor(private readonly userRoles: UserRolesService) {}

  @Get()
  @RequirePermission('user.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Param('userId') userId: string,
  ): Promise<UserRolesResponse> {
    return this.userRoles.list(principal, parseInput(userIdSchema, userId, 'userId'))
  }

  /** 200, not 201: the answer is the account's whole role set, not a new row. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.write')
  grant(
    @Principal() principal: RequestPrincipal,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<UserRolesResponse> {
    const { role } = parseInput(grantRoleRequestSchema, body)

    return this.userRoles.grant(principal, parseInput(userIdSchema, userId, 'userId'), role)
  }

  @Delete(':role')
  @RequirePermission('user.write')
  revoke(
    @Principal() principal: RequestPrincipal,
    @Param('userId') userId: string,
    @Param('role') role: string,
  ): Promise<UserRolesResponse> {
    const parsed: Role = parseInput(roleSchema, role, 'role')

    return this.userRoles.revoke(principal, parseInput(userIdSchema, userId, 'userId'), parsed)
  }
}
