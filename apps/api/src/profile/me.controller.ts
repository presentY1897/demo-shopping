import { Body, Controller, Delete, Get, Patch } from '@nestjs/common'
import type { ProfileResponse, UserPreferenceResponse, WithdrawalResponse } from '@shopping/shared'
import { profileUpdateRequestSchema, userPreferenceUpdateRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ProfileService } from './profile.service.js'

/**
 * One's own account (TASK-0111).
 *
 * **No handler here takes an identifier.** That is the design, not an omission:
 * a path with no `userId` in it cannot be pointed at somebody else's account, so
 * the most common authorization bug in an account API — trusting the id in the
 * request — is not a mistake this controller is able to make. The scope check in
 * the service is the layer above that, and it is what a role whose grant was
 * narrowed to `demo` runs into.
 *
 * **Reading is `user.read`, writing is `profile.write`.** They are different
 * capabilities and are granted differently: an operator reads accounts and may
 * not edit one, and `user.write` — administering somebody else's account — stays
 * `ADMIN_SUPER` alone (TASK-0105 4장). `profile.delete` is split off again
 * because withdrawal cannot be undone.
 */
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @RequirePermission('user.read')
  me(@Principal() principal: RequestPrincipal): Promise<ProfileResponse> {
    return this.profile.me(principal)
  }

  @Patch()
  @RequirePermission('profile.write')
  update(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ProfileResponse> {
    return this.profile.updateProfile(principal, parseInput(profileUpdateRequestSchema, body))
  }

  @Get('preferences')
  @RequirePermission('user.read')
  preferences(@Principal() principal: RequestPrincipal): Promise<UserPreferenceResponse> {
    return this.profile.preferences(principal)
  }

  /** Also the density promotion endpoint; the server tells no difference. */
  @Patch('preferences')
  @RequirePermission('profile.write')
  updatePreferences(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<UserPreferenceResponse> {
    return this.profile.updatePreferences(
      principal,
      parseInput(userPreferenceUpdateRequestSchema, body),
    )
  }

  /**
   * Withdrawal. 200 with a body rather than 204: the confirmation screen should
   * be able to say what actually happened, and a body is also what lets the
   * contract gate parse the answer at all (C3).
   */
  @Delete()
  @RequirePermission('profile.delete')
  withdraw(@Principal() principal: RequestPrincipal): Promise<WithdrawalResponse> {
    return this.profile.withdraw(principal)
  }
}
