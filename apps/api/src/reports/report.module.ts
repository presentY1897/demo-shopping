import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ReportController } from './report.controller.js'
import { ReportService } from './report.service.js'

/**
 * 신고 (TASK-0091).
 *
 * 리뷰·문의 모듈을 들여오지 않고 표를 직접 읽는다. **대상마다 「가려짐」을 다르게
 * 적기** 때문이다 — 저쪽 서비스들은 각자 자기 화면의 질문에 답하도록 만들어져 있고,
 * 「가려라」는 그 질문이 아니다. 넷의 차이를 한 곳에서만 아는 편이 낫다.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
