import { Global, Module } from '@nestjs/common'

import { ClockModule } from '../common/clock.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { NotificationController } from './notification.controller.js'
import { NotificationService } from './notification.service.js'
import { OrderStatusNotifier } from './order-status.notifier.js'
import { RestockNotifier } from './restock.service.js'

/**
 * 알림 (TASK-0090).
 *
 * **`@Global` 이다.** 알림을 보내는 자리가 도메인 전체에 흩어져 있기 때문이다 —
 * 주문 상태 변경, 클레임 처리, 리뷰 답변, 문의 답변, 재입고, 신상품, 정산, 입점
 * 신청. 그 모듈마다 이 모듈을 `imports` 에 적으면 여덟 곳이 같은 줄을 갖게 되고,
 * 빠뜨린 한 곳은 **알림이 안 오는 것으로만** 나타난다.
 *
 * 전역이 위험한 것은 그것이 상태를 갖거나 순환을 만들 때인데, 이 서비스는 둘 다
 * 아니다 — 아무도 들여오지 않는 잎이고, 던지지도 않는다.
 */
@Global()
@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [NotificationController],
  providers: [NotificationService, OrderStatusNotifier, RestockNotifier],
  exports: [NotificationService, OrderStatusNotifier],
})
export class NotificationModule {}
