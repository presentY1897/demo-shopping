import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Param,
  Post,
} from '@nestjs/common'
import type { PaymentResponse } from '@shopping/shared'
import { paymentProviderSchema } from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { PaymentService } from './payment.service.js'
import { TOSS_WEBHOOK_ROUTE, TOSS_WEBHOOK_SIGNATURE_HEADER } from './payment-webhook.js'
import { PaymentWebhookService } from './payment-webhook.service.js'
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
 * `POST /payments/:id/toss/confirm` — 결제창이 돌아왔다 (TASK-0055).
 *
 * **금액을 받는다.** 서버가 이미 아는 값을 굳이 받는 이유는 그것을 쓰기 위해서가
 * 아니라 **대조하기 위해서**다 — 브라우저가 무엇을 들고 돌아왔는지 알아야
 * 조작을 발견할 수 있고, 받지 않으면 발견할 것 자체가 없다.
 */
const confirmTossSchema = z.object({
  /** 결제창이 돌려준 키. 토스가 이 길이를 200자까지 쓴다. */
  paymentKey: z.string().min(1).max(200),
  amount: z.int().nonnegative(),
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
    private readonly webhooks: PaymentWebhookService,
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

  /**
   * 토스 결제창에서 돌아온 뒤의 승인 (TASK-0055 F1 · F2).
   *
   * **`authorize` 와 다른 라우트인 이유**는 이 단계에만 대조할 것이 있기 때문이다.
   * 가상 카드는 결제창을 거치지 않아 브라우저가 들고 돌아오는 값이 없고, 토스는
   * 그 값을 들고 온다 — 그 값을 받는 자리가 곧 검산하는 자리다.
   */
  @Post('payments/:id/toss/confirm')
  @RequirePermission('order.write')
  confirmToss(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PaymentResponse> {
    const input = parseInput(confirmTossSchema, body)

    return this.payments.confirmToss(principal, id, input.paymentKey, input.amount)
  }

  /**
   * `POST /payments/toss/webhook` — 토스가 「확인해 보라」고 알려 온다 (TASK-0056).
   *
   * **이 라우트의 인증 수단은 서명이다.** 가드를 우회하는 것이 아니라 다른 자격을
   * 쓰는 것이고, 그래서 `@PublicEndpoint()` 로 「가드가 볼 자격이 없다」를 소리 내어
   * 말한다 — 이 저장소는 아무것도 선언하지 않은 핸들러를 거부하므로(`PermissionGuard`),
   * 침묵으로 열리는 라우트는 존재할 수 없다. 대신 서명이 없거나 틀리면 401 이고,
   * **시크릿이 설정되지 않은 배포에서는 전부 401** 이다.
   *
   * `@RequirePermission` 을 붙이지 않는 이유는 붙일 권한이 없기 때문이다. 부르는
   * 쪽이 사람이 아니라 결제사이고, 그쪽에는 우리 역할표에 들어갈 계정이 없다.
   *
   * **본문이 `Buffer` 다.** `configure-app.ts` 가 이 경로에만 원문 보존 미들웨어를
   * 걸어 두어서고, 이유는 서명이 파싱된 객체가 아니라 **바이트**에 걸려 있기
   * 때문이다 (`payment-webhook.middleware.ts`).
   *
   * **200 을 고정한다.** POST 의 기본값 201 은 「만들었다」는 뜻인데 이 라우트가
   * 만드는 것은 없고, 무엇보다 PG 가 보는 것은 2xx 인지 여부다.
   */
  @Post(TOSS_WEBHOOK_ROUTE)
  @HttpCode(200)
  @PublicEndpoint()
  async receiveTossWebhook(
    @Body() body: unknown,
    // 같은 헤더가 두 번 오면 Node 가 쉼표로 이어 붙여 하나의 문자열로 준다 — 그
    // 값은 어느 서명과도 같지 않으므로 401 이 되고, 그것이 맞는 답이다.
    @Headers(TOSS_WEBHOOK_SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!Buffer.isBuffer(body)) {
      // 여기 오는 유일한 길은 라우트 경로와 미들웨어 마운트 경로가 어긋난
      // 것이다. 조용히 401 로 접으면 「서명이 안 맞는다」로 보여 한참을 엉뚱한
      // 곳에서 찾게 되므로, 우리 쪽 배선 오류라고 말한다.
      throw new InternalServerErrorException('웹훅 원문이 보존되지 않았습니다.')
    }

    await this.webhooks.receive(body, signature)

    return { received: true }
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
