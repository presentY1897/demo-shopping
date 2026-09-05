import { Inject, Injectable, Logger } from '@nestjs/common'
import type { PaymentProviderName, PaymentStatus } from '@shopping/shared'

import type { AuthorizeRequest, AuthorizeResult, PaymentProviderPort } from './payment-provider.js'
import type { TossClient } from './toss.client.js'
import { TOSS_CLIENT, TOSS_UNREACHABLE, TossError } from './toss.client.js'
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
      return { outcome: 'declined', reason: '결제창을 먼저 거쳐야 해요.' }
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
      return refusalOf(error)
    }

    if (payment.status !== 'DONE') {
      // 가상계좌처럼 「입금을 기다리는」 상태로도 승인이 끝난다. 우리 흐름은 그
      // 수단을 열지 않지만, 상태를 확인하지 않으면 입금 전에 주문이 완료된다.
      this.log.warn(`승인이 끝나지 않은 상태로 돌아왔습니다: ${payment.status}`)

      return { outcome: 'declined', reason: '결제가 아직 끝나지 않았어요.' }
    }

    return { outcome: 'approved', paymentKey: payment.paymentKey }
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

  /**
   * 끊긴 승인을 우리 결제 id 로 되찾는다 (TASK-0056 · D-220).
   *
   * 토스에게 우리 `Payment.id` 는 「주문번호」다 (4.3). 승인을 보낼 때 그것을
   * 실어 보냈으므로, 답을 못 받았어도 **그 번호로 다시 물어볼 수 있다.**
   *
   * 세 갈래로 접힌다.
   *
   * | 저쪽이 아는 것 | 우리 답 |
   * | --- | --- |
   * | 없음 (404) | 거절 — 요청이 도착조차 하지 않았다 |
   * | `DONE` | 승인 — 결제키를 이제야 받는다 |
   * | 취소·중단·만료 | 거절 — 돈이 남아 있지 않다 |
   * | 처리 중 · 입금 대기 | **여전히 모른다** — 다음 대사가 다시 묻는다 |
   */
  async recover(paymentId: string): Promise<AuthorizeResult> {
    let payment
    try {
      payment = await this.toss.getByOrderId(paymentId)
    } catch (error: unknown) {
      // 대사가 저쪽에 닿지 못한 것이다. 우리 결제는 그대로 두고 다음 주기를
      // 기다린다 — 여기서 실패로 접으면 「모른다」를 「없었다」로 바꾸게 된다.
      return refusalOf(error)
    }

    if (payment === null) {
      return { outcome: 'declined', reason: '결제사에 이 결제 요청이 도착하지 않았어요.' }
    }

    const mapped = paymentStatusFromToss(payment.status)

    if (mapped === 'PAID') return { outcome: 'approved', paymentKey: payment.paymentKey }
    // 아직 저쪽도 끝나지 않았다. 우리도 모르는 채로 둔다.
    if (mapped === 'READY') return { outcome: 'unknown', reason: '결제사가 아직 처리 중이에요.' }

    return { outcome: 'declined', reason: '결제사에서 승인이 완료되지 않았어요.' }
  }
}

/**
 * 승인이 안 된 두 방식을 가른다 (TASK-0056 4.2 · D-220).
 *
 * **닿지 못한 것과 거절당한 것은 다른 사실이다.** 거절은 저쪽이 답을 준 것이라
 * 「승인 안 됨」을 우리가 안다. 닿지 못한 것은 요청이 도착했는지조차 모르는
 * 상태이고, 저쪽에서는 승인이 나 있을 수 있다 — 그것을 `FAILED` 로 적으면 되돌릴
 * 길이 없어진다.
 *
 * 문장은 토스가 준 것을 그대로 쓴다. 「카드 한도를 초과했습니다」 같은 것은 저쪽이
 * 우리보다 정확히 알고, 다시 쓰면 번역이 두 곳에서 조금씩 달라진다.
 */
function refusalOf(error: unknown): AuthorizeResult {
  if (!(error instanceof TossError)) {
    return { outcome: 'declined', reason: '결제가 승인되지 않았어요.' }
  }

  if (error.code === TOSS_UNREACHABLE) return { outcome: 'unknown', reason: error.message }

  return { outcome: 'declined', reason: error.message }
}
