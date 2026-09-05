import type { OnModuleInit } from '@nestjs/common'
import { Module } from '@nestjs/common'

import { OrderModule } from '../orders/order.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { PaymentController } from './payment.controller.js'
import { PaymentProviderRegistry } from './payment-registry.js'
import { PaymentService } from './payment.service.js'
import { VirtualCardProvider } from './virtual-card.provider.js'
import { VirtualCardService } from './virtual-card.service.js'

/**
 * 결제 (TASK-0052).
 *
 * 주문서의 결제 영역이 부를 라우트가 생겼다 (TASK-0054). 승인과 매입이 두 라우트인
 * 것은 가상 카드의 사정이 아니라 **계약**이다 — 토스에는 그 사이에 은행이 있고, 두
 * 구현이 같은 순서를 따라야 추상화가 값을 한다.
 *
 * 레지스트리는 비어 있는 채로 태어나고, **모듈이 자기 구현을 등록한다.** 가상
 * 카드는 여기서(TASK-0054), 토스는 자기 모듈에서(TASK-0055) — 그래야 키가 없는
 * 환경에서 토스만 빠지고 나머지가 그대로 돈다.
 */
@Module({
  imports: [OrderModule, PrismaModule],
  controllers: [PaymentController],
  providers: [PaymentProviderRegistry, PaymentService, VirtualCardService, VirtualCardProvider],
  exports: [PaymentProviderRegistry, PaymentService, VirtualCardService],
})
export class PaymentModule implements OnModuleInit {
  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly virtualCard: VirtualCardProvider,
  ) {}

  /**
   * 가상 카드를 레지스트리에 등록한다 (TASK-0054).
   *
   * 모듈이 스스로 등록하는 이유는 레지스트리가 **비어 있는 채로 태어나기**
   * 때문이다(TASK-0052 4.2). 토스는 자기 모듈에서 같은 일을 한다 — 그래야 키가
   * 없는 환경에서 토스만 빠지고 나머지가 그대로 돈다.
   */
  onModuleInit(): void {
    this.registry.register(this.virtualCard)
  }
}
