import { Module } from '@nestjs/common'

import { PointsModule } from '../points/points.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminUserController } from './admin-user.controller.js'
import { AdminUserService } from './admin-user.service.js'

/**
 * 관리자 콘솔의 도메인 없는 화면들 (M14).
 *
 * 적립금은 **서비스를 들여온다** — 원장의 규칙을 여기서 다시 쓰지 않기 위해서다
 * (`points.service.ts` 의 `adjustByAdmin`).
 */
@Module({
  imports: [PrismaModule, PointsModule],
  controllers: [AdminUserController],
  providers: [AdminUserService],
})
export class AdminModule {}
