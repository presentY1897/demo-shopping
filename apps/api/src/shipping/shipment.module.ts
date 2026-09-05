import { Module } from '@nestjs/common'

import { SellerOrderModule } from '../orders/seller-order.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { DeliverySimulatorService } from './delivery-simulator.service.js'
import { ShipmentController } from './shipment.controller.js'
import { ShipmentService } from './shipment.service.js'

/**
 * 배송 (TASK-0061 · TASK-0062).
 *
 * `SellerOrderModule` 을 들여오는 것이 이 모듈의 유일한 도메인 의존이다 — 발송은
 * 운송장 발급과 상태 전이가 한 트랜잭션이어야 하고, 전이는 그 문으로만 지난다.
 * `OrderModule` 이 아니라 그 문만 들여오는 것은 배송이 주문의 금액도 재고도 알 필요가
 * 없기 때문이고, 그 좁음이 순환을 만들지 않는 이유다(`SellerOrderModule` 은
 * `PrismaModule` 하나만 안다).
 *
 * 시뮬레이터(TASK-0062)가 여기 사는 것도 같은 성질이다. 그것이 아는 것은
 * {@link ShipmentService} 하나뿐이고 — 시간에 맞춰 그 문을 두드리는 것이 전부다 —
 * 주문에 대해서는 그 문 너머의 아무것도 모른다. 헬스 지표는 이 모듈을 들여오지
 * 않고 `AppMeta` 행을 읽으므로(`health/delivery-simulator.health-indicator.ts`)
 * 여기서 내보낼 것도 늘지 않는다.
 */
@Module({
  imports: [PrismaModule, SellerOrderModule],
  controllers: [ShipmentController],
  providers: [ShipmentService, DeliverySimulatorService],
  exports: [ShipmentService, DeliverySimulatorService],
})
export class ShipmentModule {}
