import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { SearchModule } from '../search/search.module.js'
import { ReviewController } from './review.controller.js'
import { ReviewListService } from './review-list.service.js'
import { ReviewService } from './review.service.js'

/**
 * 리뷰 (M13).
 *
 * **주문 모듈을 들여오지 않는다.** 구매 검증이 스키마에 있어서 물어볼 것이 없기
 * 때문이다 — 리뷰가 아는 것은 주문 항목 id 하나이고, 그 항목이 이 사람의 것인지도
 * 조회 한 번이 답한다.
 *
 * `SearchModule` 은 반대 방향이 없는 의존이다 (TASK-0084 F4). 리뷰가 바뀌면 상품의
 * 평점이 바뀌고, 평점이 바뀌면 그 상품의 검색 문서가 낡는다 — 그 사건을 **리뷰의
 * 트랜잭션 안에서** 남기므로 롤백되면 사건도 함께 사라진다.
 */
@Module({
  imports: [PrismaModule, ClockModule, SearchModule],
  controllers: [ReviewController],
  providers: [ReviewService, ReviewListService],
  exports: [ReviewService],
})
export class ReviewModule {}
