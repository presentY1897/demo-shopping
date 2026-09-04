import { Module } from '@nestjs/common'

import { AddressController } from './address.controller.js'
import { AddressService } from './address.service.js'
import { MeController } from './me.controller.js'
import { ProfileService } from './profile.service.js'

/**
 * The `/me` family — one's own profile, settings, address book and withdrawal
 * (TASK-0111). Prisma and the clock arrive from their global modules.
 *
 * `MeController` is listed first so that `/me` and `/me/preferences` are matched
 * before `me/addresses`'s routes are consulted; the two sets do not overlap, but
 * declaring the narrower prefix second keeps it that way if one ever gains a
 * parameter.
 */
@Module({
  controllers: [MeController, AddressController],
  providers: [ProfileService, AddressService],
})
export class ProfileModule {}
