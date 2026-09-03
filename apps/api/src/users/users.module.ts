import { Module } from '@nestjs/common'

import { UserRolesController } from './user-roles.controller.js'
import { UserRolesService } from './user-roles.service.js'

/** Account administration. Prisma arrives from the global `PrismaModule`. */
@Module({
  controllers: [UserRolesController],
  providers: [UserRolesService],
})
export class UsersModule {}
