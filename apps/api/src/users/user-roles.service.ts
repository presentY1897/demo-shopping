import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Role, UserRolesResponse } from '@shopping/shared'
import { roles as roleOrder } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * `AccountRow` carries whatever the ownership mapper needs, so this service
 * never names those columns — see `demo-containment.spec.ts`.
 */
interface AccountWithRoles extends AccountRow {
  readonly roles: readonly { readonly role: Role }[]
}

/** Canonical order, so a response never depends on insertion order. */
function ordered(granted: readonly { readonly role: Role }[]): Role[] {
  const held = new Set<Role>(granted.map((entry) => entry.role))

  return roleOrder.filter((role) => held.has(role))
}

/**
 * Granting and revoking roles.
 *
 * Note what this service does *not* contain: no role hierarchy, no check for
 * who the caller is beyond the two `assertResourceAccess` calls, and no mention
 * of demo accounts. Whether the caller may touch this account at all was decided
 * by `user.write` in the permission table, and which accounts they may touch is
 * decided by the scope on that grant.
 */
@Injectable()
export class UserRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: RequestPrincipal, userId: string): Promise<UserRolesResponse> {
    const account = await this.account(userId)
    assertResourceAccess(principal, 'user.read', accountOwnership(account))

    return { userId: account.id, roles: ordered(account.roles) }
  }

  /**
   * Idempotent: granting a role the account already holds returns the same set
   * instead of failing on `UserRole(userId, role)`. A console that double-clicks
   * should not see an error about a database constraint.
   */
  async grant(principal: RequestPrincipal, userId: string, role: Role): Promise<UserRolesResponse> {
    const account = await this.account(userId)
    assertResourceAccess(principal, 'user.write', accountOwnership(account))

    await this.prisma.userRole.createMany({
      data: [{ userId: account.id, role }],
      skipDuplicates: true,
    })

    return this.currentRoles(account.id)
  }

  async revoke(
    principal: RequestPrincipal,
    userId: string,
    role: Role,
  ): Promise<UserRolesResponse> {
    const account = await this.account(userId)
    assertResourceAccess(principal, 'user.write', accountOwnership(account))

    // The one rule that is not a permission: an administrator cannot lock the
    // platform out of its own console. Nothing else can restore this role — the
    // endpoint that grants it needs someone who still holds it.
    if (principal.userId === account.id && role === 'ADMIN_SUPER') {
      throw new ConflictException('본인의 ADMIN_SUPER 역할은 회수할 수 없습니다.')
    }

    await this.prisma.userRole.deleteMany({ where: { userId: account.id, role } })

    return this.currentRoles(account.id)
  }

  /** Withdrawn accounts are invisible here, exactly as they are to login. */
  private async account(userId: string): Promise<AccountWithRoles> {
    const account = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { ...accountOwnershipSelect, roles: { select: { role: true } } },
    })

    if (account === null) throw new NotFoundException('사용자를 찾을 수 없습니다.')

    return account
  }

  private async currentRoles(userId: string): Promise<UserRolesResponse> {
    const granted = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: true },
    })

    return { userId, roles: ordered(granted) }
  }
}
