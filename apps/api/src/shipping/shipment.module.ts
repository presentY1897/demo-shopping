import { Module } from '@nestjs/common'

import { SellerOrderModule } from '../orders/seller-order.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ShipmentController } from './shipment.controller.js'
import { ShipmentService } from './shipment.service.js'

/**
 * 배송 (TASK-0061).
 *
 * `SellerOrderModule` 을 들여오는 것이 이 모듈의 유일한 도메인 의존이다 — 발송은
 * 운송장 발급과 상태 전이가 한 트랜잭션이어야 하고, 전이는 그 문으로만 지난다.
 * `OrderModule` 이 아니라 그 문만 들여오는 것은 배송이 주문의 금액도 재고도 알 필요가
 * 없기 때문이고, 그 좁음이 순환을 만들지 않는 이유다(`SellerOrderModule` 은
 * `PrismaModule` 하나만 안다).
 */
@Module({
  imports: [PrismaModule, SellerOrderModule],
  controllers: [ShipmentController],
  providers: [ShipmentService],
  exports: [ShipmentService],
})
export class ShipmentModule {}
