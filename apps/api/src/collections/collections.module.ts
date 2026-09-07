import { FollowConsistencyService } from './follow-consistency.service.js'
import { Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { CollectionsController } from './collections.controller.js'
import { CollectionsService } from './collections.service.js'

/**
 * 찜 · 최근 본 상품 · 팔로우 (M13).
 *
 * 셋을 한 모듈에 두는 이유는 **같은 모양의 일**이기 때문이다 — 사람이 무엇을
 * 가리키고, 그 가리킴을 켜고 끄고, 목록으로 읽는다. 셋으로 나누면 토글의 규칙이
 * 세 벌이 되고, 세 벌은 갈라진다.
 *
 * `CollectionsService` 를 내보내는 이유는 **상품 상세가 「본 것」을 적기** 때문이다
 * (TASK-0087 F1). 반대 방향은 없다.
 */
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [CollectionsController],
  providers: [FollowConsistencyService, CollectionsService],
  exports: [CollectionsService, FollowConsistencyService],
})
export class CollectionsModule {}
