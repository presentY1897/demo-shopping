import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  ProfileResponse,
  ProfileUpdateRequest,
  Role,
  UserPreference,
  UserPreferenceResponse,
  UserPreferenceUpdateRequest,
  WithdrawalResponse,
} from '@shopping/shared'
import { DEFAULT_USER_PREFERENCE, roles as roleOrder } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'

/** The settings columns, named once so read and write cannot select differently. */
const PREFERENCE_SELECT = {
  density: true,
  locale: true,
  currency: true,
  notifyOrder: true,
  notifyClaim: true,
  notifyMarketing: true,
} as const

/**
 * `accountOwnershipSelect` first, so the row can be handed to the ownership
 * mapper without this service ever naming what is in it (TASK-0105 F8).
 */
const ACCOUNT_SELECT = {
  ...accountOwnershipSelect,
  email: true,
  name: true,
  avatarUrl: true,
  roles: { select: { role: true } },
  preference: { select: PREFERENCE_SELECT },
} as const

interface AccountDetail extends AccountRow {
  readonly email: string
  readonly name: string
  readonly avatarUrl: string | null
  readonly roles: readonly { readonly role: Role }[]
  readonly preference: UserPreference | null
}

/** Canonical order, so a response never depends on insertion order. */
function ordered(granted: readonly { readonly role: Role }[]): Role[] {
  const held = new Set<Role>(granted.map((entry) => entry.role))

  return roleOrder.filter((role) => held.has(role))
}

/**
 * The account's settings, or the defaults when it has no row yet.
 *
 * **A read never creates the row.** `UserPreference` is written on first change
 * and not at sign-in, so most accounts have none; making `GET` insert one would
 * break the moment this endpoint runs against a read replica or a narrowed
 * grant, and would turn "look at my settings" into a write in the audit trail.
 */
function settingsOf(stored: UserPreference | null): UserPreference {
  return stored ?? DEFAULT_USER_PREFERENCE
}

/**
 * One's own account: profile, settings and withdrawal (TASK-0111).
 *
 * **Every method resolves the account as `principal.userId` and never from the
 * request.** That is what `/me` means: there is no identifier in any of these
 * paths, so asking for somebody else's profile is not a request this API can
 * express. The `assertResourceAccess` calls are the second line of defence —
 * they decide whether the grant's scope reaches this account at all, which is
 * what stops a role whose `profile.write` was narrowed to `demo` from editing a
 * real one.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async me(principal: RequestPrincipal): Promise<ProfileResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'user.read', accountOwnership(account))

    return present(account)
  }

  async updateProfile(
    principal: RequestPrincipal,
    body: ProfileUpdateRequest,
  ): Promise<ProfileResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'profile.write', accountOwnership(account))

    const { name, avatarUrl } = body

    // An empty body is a no-op rather than an error: a form that submits only
    // what changed sends `{}` when nothing did, and bumping `updatedAt` for it
    // would make "when did this account last change" untrue.
    if (name === undefined && avatarUrl === undefined) return present(account)

    const updated = await this.prisma.user.update({
      where: { id: account.id },
      data: { name, avatarUrl },
      select: ACCOUNT_SELECT,
    })

    return present(updated)
  }

  async preferences(principal: RequestPrincipal): Promise<UserPreferenceResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'user.read', accountOwnership(account))

    return { preference: settingsOf(account.preference) }
  }

  /**
   * Saves settings, creating the row if this is the first change.
   *
   * This is also where a signed-out visitor's stored density lands when they
   * sign in (TASK-0111 4장 — 밀도 승격). The server does not distinguish that
   * from any other change: doing so would mean trusting a flag the client sent,
   * and the answer would still be "whoever wrote last wins".
   *
   * The `create` branch names no defaults of its own — the columns' own defaults
   * fill in whatever the caller omitted, which is the same set of values
   * `DEFAULT_USER_PREFERENCE` answers a read with.
   */
  async updatePreferences(
    principal: RequestPrincipal,
    body: UserPreferenceUpdateRequest,
  ): Promise<UserPreferenceResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'profile.write', accountOwnership(account))

    const stored = await this.prisma.userPreference.upsert({
      where: { userId: account.id },
      create: { userId: account.id, ...body },
      update: { ...body },
      select: PREFERENCE_SELECT,
    })

    return { preference: stored }
  }

  /**
   * Withdrawal: the account is tombstoned, the address book is really deleted.
   *
   * Three different treatments, and each is a decision (`erd.md` 1장,
   * TASK-0111 4장).
   *
   * - **`User` keeps its row.** Orders, reviews and settlements point at it, and
   *   `StockLedger.actorId` already does today with an `onDelete: Restrict` edge
   *   — a hard delete would either be refused or take history with it.
   * - **`Address` is erased.** It is the exception to the soft-delete rule: an
   *   order snapshots its recipient, so nothing references these rows, and the
   *   personal data in them has to be removable for real.
   * - **`RefreshToken` is revoked *and expired*.** Setting only `revokedAt`
   *   would leave the token inside the ten second reuse grace window that
   *   `SessionService.refresh` honours, where it still rotates; expiry is
   *   checked first, so writing both is what ends the session immediately.
   *
   * `googleSub` is deliberately left alone. The partial index
   * `User_googleSub_active_key` (`WHERE "deletedAt" IS NULL`) releases the
   * identity the moment the tombstone is written, so the same person can sign up
   * again — as a **new** account, with this one's history left behind. Scrubbing
   * the value itself is TASK-0025's destruction schedule.
   *
   * One transaction, because a half-applied withdrawal is an account that cannot
   * sign in and still has its addresses on file.
   */
  async withdraw(principal: RequestPrincipal): Promise<WithdrawalResponse> {
    const account = await this.account(principal.userId)
    assertResourceAccess(principal, 'profile.delete', accountOwnership(account))

    const now = this.clock.now()

    return this.prisma.$transaction(async (tx) => {
      const erased = await tx.address.deleteMany({ where: { userId: account.id } })
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: account.id, revokedAt: null },
        data: { revokedAt: now, expiresAt: now },
      })

      await tx.user.update({ where: { id: account.id }, data: { deletedAt: now } })

      return {
        userId: account.id,
        deletedAt: now.toISOString(),
        deletedAddresses: erased.count,
        revokedSessions: revoked.count,
      }
    })
  }

  /**
   * The caller's own account.
   *
   * Withdrawn accounts are invisible here, exactly as they are to login and to
   * role administration — so a second `DELETE /me` is a 404 rather than a second
   * tombstone, and a still-valid access token issued before the withdrawal
   * stops working at the next call rather than at its own expiry.
   */
  private async account(userId: string): Promise<AccountDetail> {
    const account = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: ACCOUNT_SELECT,
    })

    if (account === null) throw new NotFoundException('사용자를 찾을 수 없습니다.')

    return account
  }
}

function present(account: AccountDetail): ProfileResponse {
  return {
    profile: {
      id: account.id,
      email: account.email,
      name: account.name,
      avatarUrl: account.avatarUrl,
      roles: ordered(account.roles),
    },
    preference: settingsOf(account.preference),
  }
}
