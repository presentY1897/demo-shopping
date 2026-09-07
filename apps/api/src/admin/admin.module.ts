import { Module } from '@nestjs/common'

import { DemoModule } from '../demo/demo.module.js'
import { PointsModule } from '../points/points.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { SearchModule } from '../search/search.module.js'
import { AdminCatalogService } from './admin-catalog.service.js'
import { AdminConsoleController } from './admin-console.controller.js'
import { AdminDemoService } from './admin-demo.service.js'
import { AdminSellerService } from './admin-seller.service.js'
import { AdminUserController } from './admin-user.controller.js'
import { AdminUserService } from './admin-user.service.js'

/**
 * 관리자 콘솔의 도메인 없는 화면들 (M14).
 *
 * 적립금은 **서비스를 들여온다** — 원장의 규칙을 여기서 다시 쓰지 않기 위해서다
 * (`points.service.ts` 의 `adjustByAdmin`).
 */
@Module({
  imports: [PrismaModule, PointsModule, SearchModule, DemoModule],
  controllers: [AdminUserController, AdminConsoleController],
  providers: [AdminUserService, AdminSellerService, AdminCatalogService, AdminDemoService],
})
export class AdminModule {}
