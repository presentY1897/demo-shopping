import { Inject, Injectable, Logger } from '@nestjs/common'
import type { PaymentProviderName, PaymentStatus } from '@shopping/shared'

import type { AuthorizeRequest, AuthorizeResult, PaymentProviderPort } from './payment-provider.js'
import type { TossClient } from './toss.client.js'
import { TOSS_CLIENT, TossError } from './toss.client.js'
import { paymentStatusFromToss } from './toss-rules.js'

/**
 * 토스페이먼츠 (TASK-0055).
 *
 * **두 번째 구현이 있어야 추상화가 값을 한다** (D-031). 가상 카드는 우리가 만든
 * 것이라 계약을 우리 편한 대로 맞출 수 있지만, 이쪽은 남이 만든 것이라 맞출 수
 * 없다 — 그 차이가 포트의 모양을 검증한다.
 *
 * 실제로 하나가 어긋났고, 그것이 이 TASK 의 유일한 포트 변경이다(4.6):
 * `AuthorizeRequest.cardId` 는 가상 카드의 이름이었다. 토스가 이 자리에 넣는 것은
 * 카드가 아니라 **결제창이 돌려준 결제키**라서, 이름을 `methodRef` 로 바꿨다.
 */
@Injectable()
export class TossProvider implements PaymentProviderPort {
  readonly name: PaymentProviderName = 'TOSS'

  private readonly log = new Logger(TossProvider.name)

  constructor(@Inject(TOSS_CLIENT) private readonly toss: TossClient) {}

  /**
   * 승인 — 결제창이 돌려준 키로 토스의 승인 API 를 부른다.
   *
   * **여기 오기 전에 금액이 이미 대조됐다** (`PaymentService.confirmToss`). 이
   * 프로바이더가 받는 `amount` 는 결제창이 돌려준 숫자가 아니라 **DB 의 승인액**이고,
   * 그래서 토스에도 그 값을 보낸다 — 토스는 자기가 아는 금액과 다르면 거절하므로,
   * 대조가 두 겹이 된다.
   */
  async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    const paymentKey = request.methodRef ?? null

    if (paymentKey === null) {
      // 결제창을 거치지 않고 승인 라우트를 직접 부른 경우다. 토스는 결제키 없이
      // 승인할 수 없으므로 거절이지 오류가 아니다.
      return { approved: false, paymentKey: null, reason: '결제창을 먼저 거쳐야 해요.' }
    }

    let payment
    try {
      payment = await this.toss.confirm({
        paymentKey,
        // 토스가 「주문번호」라 부르는 자리에 **결제 id** 를 준다 (4.3).
        orderId: request.paymentId,
        amount: request.amount,
      })
    } catch (error: unknown) {
      return { approved: false, paymentKey: null, reason: reasonOf(error) }
    }

    if (payment.status !== 'DONE') {
      // 가상계좌처럼 「입금을 기다리는」 상태로도 승인이 끝난다. 우리 흐름은 그
      // 수단을 열지 않지만, 상태를 확인하지 않으면 입금 전에 주문이 완료된다.
      this.log.warn(`승인이 끝나지 않은 상태로 돌아왔습니다: ${payment.status}`)

      return { approved: false, paymentKey: null, reason: '결제가 아직 끝나지 않았어요.' }
    }

    return { approved: true, paymentKey: payment.paymentKey, reason: null }
  }

  /**
   * 매입 확정 — **아무것도 하지 않는다.**
   *
   * 토스의 승인 한 번이 승인과 매입 둘 다이기 때문이다(카드사 기준으로 매입까지
   * 한 번에 간다). 가상 카드도 같은 이유로 비어 있지만 **이유가 다르다** — 저쪽은
   * 은행이 없어서고 이쪽은 이미 끝나서다.
   *
   * 그래도 계약에 이 단계가 남아 있는 것이 옳다. 이 단계는 승인과 매입을 나누는
   * 결제사가 있는 한 필요하고, 없애면 그런 결제사를 붙일 때 부르는 쪽을 전부 고쳐야
   * 한다 — 추상화가 가장 엄격한 쪽에 맞춰져 있어야 하는 이유다.
   */
  capture(): Promise<void> {
    return Promise.resolve()
  }

  /** 취소 — 매입 전. 토스는 취소와 환불을 같은 API 로 받는다. */
  async cancel(paymentKey: string, amount: number, reason: string): Promise<void> {
    await this.toss.cancel(paymentKey, reason, amount)
  }

  /**
   * 환불 — 매입 후. 부르는 API 는 취소와 같다.
   *
   * 둘을 나누는 것은 **우리 장부**다. 토스에게는 같은 요청이지만 우리 쪽에서는
   * 매입 전인지 후인지에 따라 상태 전이가 다르고, 그 판단은 `payment-rules.ts` 가
   * 이미 했다.
   */
  async refund(paymentKey: string, amount: number, reason: string): Promise<void> {
    await this.toss.cancel(paymentKey, reason, amount)
  }

  /** 대사용 조회. 우리가 아는 상태와 저쪽이 아는 상태가 같은지 물어본다. */
  async getStatus(paymentKey: string): Promise<PaymentStatus> {
    const payment = await this.toss.get(paymentKey)

    return paymentStatusFromToss(payment.status)
  }
}

/**
 * 토스가 준 문장을 그대로 쓴다.
 *
 * 「카드 한도를 초과했습니다」 같은 것은 저쪽이 우리보다 정확히 안다. 다시 쓰면
 * 번역이 두 곳에서 조금씩 달라지고, 사용자에게는 그 차이가 그냥 혼란이다.
 */
function reasonOf(error: unknown): string {
  return error instanceof TossError ? error.message : '결제가 승인되지 않았어요.'
}
