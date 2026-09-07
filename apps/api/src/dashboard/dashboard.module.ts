import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { SearchModule } from '../search/search.module.js'
import { DashboardController } from './dashboard.controller.js'
import { DashboardService } from './dashboard.service.js'

/**
 * 관리자 대시보드 (TASK-0092).
 *
 * 도메인 모듈을 하나도 들여오지 않는다 — 세는 일에 필요한 **판단**은 전부 순수
 * 함수로 노출돼 있고(`claim-deadline.ts` · `claim-console.ts` · 각 배치의 상수),
 * 서비스를 통째로 들여오면 이 화면이 그 도메인의 쓰기 경로까지 손닿는 곳에 두게 된다.
 */
@Module({
  imports: [PrismaModule, SearchModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
