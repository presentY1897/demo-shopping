import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ReviewController } from './review.controller.js'
import { ReviewService } from './review.service.js'

/**
 * 리뷰 (M13).
 *
 * 다른 모듈을 들여오지 않는다. **구매 검증이 스키마에 있어서** 주문 모듈에 물어볼
 * 것이 없기 때문이다 — 리뷰가 아는 것은 주문 항목 id 하나이고, 그 항목이 이 사람의
 * 것인지도 조회 한 번이 답한다.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
