import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { PaymentProviderRegistry } from './payment-registry.js'
import { PaymentService } from './payment.service.js'

/**
 * 결제 (TASK-0052).
 *
 * **컨트롤러가 없다.** 결제를 부르는 쪽은 주문서(M08 의 화면 TASK)이고, 그전까지
 * 이것은 서비스다 — 부를 화면이 없는 REST 표면을 먼저 뚫으면 실제로 쓸 때가 되어서야
 * 모양이 안 맞는다는 것을 알게 된다 (TASK-0048 4.2 ① 이 같은 판단을 적어 뒀다).
 *
 * 레지스트리는 **비어 있는 채로** 시작한다 (4.2). 구현은 TASK-0054(가상 카드)와
 * TASK-0055(토스)가 자기 모듈에서 등록한다.
 */
@Module({
  imports: [PrismaModule],
  providers: [PaymentProviderRegistry, PaymentService],
  exports: [PaymentProviderRegistry, PaymentService],
})
export class PaymentModule {}
