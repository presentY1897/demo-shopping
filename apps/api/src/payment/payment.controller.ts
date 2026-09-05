import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import type { PaymentResponse } from '@shopping/shared'
import { paymentProviderSchema } from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { PaymentService } from './payment.service.js'
import type { CardTransaction, IssuedCard } from './virtual-card.service.js'
import { VirtualCardService } from './virtual-card.service.js'

/**
 * `POST /cards` — 카드를 발급한다.
 *
 * 상한을 스키마가 막는 이유는 실수 때문이다. 원 단위 정수라 0을 하나 더 치면
 * 열 배가 되고, 그 카드로는 무엇을 사도 한도 초과가 나지 않아 **재현 장치로서
 * 쓸모가 없어진다.**
 */
const issueCardSchema = z.object({
  creditLimit: z.int().min(1_000).max(10_000_000),
})

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

  /**
   * 카드 발급 (TASK-0058).
   *
   * 한도는 사람이 정한다 — 이 카드가 존재하는 이유가 「한도 초과를 재현해 본다」인
   * 만큼, 낮은 한도를 일부러 고를 수 있어야 한다 (TASK-0054 4장의 표).
   */
  @Post('cards')
  @RequirePermission('profile.write')
  async issueCard(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<{ card: IssuedCard }> {
    const input = parseInput(issueCardSchema, body)

    return { card: await this.cards.issue(principal, input.creditLimit) }
  }

  /** 카드 정지. 되살릴 수 있으므로 삭제와 다르다. */
  @Post('cards/:id/suspend')
  @RequirePermission('profile.write')
  async suspendCard(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<{ card: IssuedCard }> {
    return { card: await this.cards.suspend(principal, id) }
  }

  /** 정지 해제. */
  @Post('cards/:id/activate')
  @RequirePermission('profile.write')
  async activateCard(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<{ card: IssuedCard }> {
    return { card: await this.cards.activate(principal, id) }
  }

  /** 카드 삭제. 소프트 삭제다 — 원장이 이 카드를 가리킨다. */
  @Delete('cards/:id')
  @HttpCode(204)
  @RequirePermission('profile.write')
  removeCard(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<void> {
    return this.cards.remove(principal, id)
  }

  /**
   * 카드 사용 내역 (TASK-0058 F3 · F4).
   *
   * **환불이 잘 됐는지 잔액으로 확인하는 동선이 여기서 완성된다.** 승인과 환불이
   * 시간순으로 나오고, 결제를 거친 줄은 주문번호를 들고 있어 「이 결제가 이 주문」이
   * 이어진다.
   */
  @Get('cards/:id/transactions')
  @RequirePermission('user.read')
  async cardTransactions(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<{ transactions: readonly CardTransaction[] }> {
    return { transactions: await this.cards.transactions(principal, id) }
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
