import { Module } from '@nestjs/common'

import { MeController } from './me.controller.js'
import { ProfileService } from './profile.service.js'

/**
 * The `/me` family — one's own profile, settings, address book and withdrawal
 * (TASK-0111). Prisma and the clock arrive from their global modules.
 */
@Module({
  controllers: [MeController],
  providers: [ProfileService],
})
export class ProfileModule {}
