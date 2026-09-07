import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { QuestionController } from './question.controller.js'
import { QuestionService } from './question.service.js'

/**
 * 상품 문의 (TASK-0088).
 *
 * 리뷰 모듈을 들여오지 않고 `maskAuthorName` 하나만 가져다 쓴다 — 이름을 가리는
 * 규칙이 두 곳에 있으면 한 화면만 이름을 다 보여 주는 날이 온다.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [QuestionController],
  providers: [QuestionService],
  exports: [QuestionService],
})
export class QuestionModule {}
