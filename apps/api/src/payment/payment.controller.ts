import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import type { PaymentResponse } from '@shopping/shared'
import { paymentProviderSchema } from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { PaymentService } from './payment.service.js'
import type { IssuedCard } from './virtual-card.service.js'
import { VirtualCardService } from './virtual-card.service.js'

/** `POST /payments` — 결제를 시작한다. */
const startPaymentSchema = z.object({
  orderId: z.uuid(),
  provider: paymentProviderSchema,
  /** 어느 수단으로. 가상 카드에서는 카드 id 다. */
  cardId: z.uuid().optional(),
})

/**
 * 결제와 카드 (TASK-0054).
 *
 * 승인과 매입이 **두 라우트**인 것이 이 화면의 모양을 정한다. 가상 카드는 그 둘
 * 사이에 아무 일도 하지 않지만(은행이 없다), 토스에는 그 구분이 있고 두 구현이 같은
 * 계약을 따라야 한다 — 부르는 쪽이 프로바이더에 따라 다른 순서를 밟게 되면 추상화가
 * 아무 일도 하지 않는 것이다 (D-031).
 */
@Controller({ version: '1' })
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly cards: VirtualCardService,
  ) {}

  /**
   * 내 카드들. 결제 화면이 고를 것을 그린다.
   *
   * 배열이 아니라 봉투다. 이 저장소의 모든 응답이 그렇고(`{ order }` · `{ payment }`),
   * 이유는 나중에 필드를 더할 자리다 — 최상위가 배열이면 「카드 목록 + 발급 가능
   * 장수」 같은 것을 붙이는 순간 응답의 모양이 바뀐다.
   */
  @Get('cards')
  @RequirePermission('user.read')
  async listCards(
    @Principal() principal: RequestPrincipal,
  ): Promise<{ cards: readonly IssuedCard[] }> {
    return { cards: await this.cards.list(principal) }
  }

  @Post('payments')
  @RequirePermission('order.write')
  start(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<PaymentResponse> {
    const input = parseInput(startPaymentSchema, body)

    return this.payments.start(principal, input.orderId, input.provider, {
      ...(input.cardId === undefined ? {} : { methodRef: input.cardId }),
    })
  }

  @Post('payments/:id/authorize')
  @RequirePermission('order.write')
  authorize(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<PaymentResponse> {
    return this.payments.authorize(principal, id)
  }

  @Post('payments/:id/capture')
  @RequirePermission('order.write')
  capture(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<PaymentResponse> {
    return this.payments.capture(principal, id)
  }

  @Get('payments/:id')
  @RequirePermission('order.read')
  get(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<PaymentResponse> {
    return this.payments.get(principal, id)
  }
}
