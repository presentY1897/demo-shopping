import { Inject, Injectable, Logger } from '@nestjs/common'
import type { PaymentProviderName, PaymentStatus } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { AuthorizeRequest, AuthorizeResult, PaymentProviderPort } from './payment-provider.js'
import { VirtualCardService } from './virtual-card.service.js'

/**
 * 재현 장치가 만드는 지연. 사람이 로딩을 인지할 만큼이다.
 *
 * 짧은 이유는 검사 때문이다 — 이 값이 길면 F4 를 재는 데 그만큼이 든다. 「끊긴다」는
 * 이 값을 늘려서 만드는 것이 아니라 `timeout` 모드가 만든다 (4.5).
 */
export const SIMULATED_DELAY_MS = 300

/**
 * 가상 카드 프로바이더 (TASK-0054).
 *
 * **실패 시나리오를 의도적으로 만들 수 있는 것이 이 구현의 핵심 가치다.** 토스
 * 테스트만으로는 실패 경로를 보여 주기 어렵고, 이 저장소가 설명하려는 것 —
 * 결제가 실패했을 때 재고 예약이 어떻게 되는가 — 은 실패를 만들 수 있어야 보인다.
 *
 * 실패에는 두 종류가 있고 **하나만 장치다.**
 *
 * | 실패 | 언제 |
 * | --- | --- |
 * | 한도 초과 · 카드 정지 · 만료 | 언제나. 정상 기능이고 운영에서도 일어난다 |
 * | 승인 지연 · 랜덤 거절 | `PAYMENT_SIMULATION` 이 켜졌을 때만 (4.4 · F8) |
 *
 * 뒤쪽이 꺼져 있으면 그 코드 경로가 **없다.** 「운영에서는 노출되지 않는다」가
 * 조건문 하나가 아니라 부재로 표현되는 편이 안전하다.
 */
@Injectable()
export class VirtualCardProvider implements PaymentProviderPort {
  readonly name: PaymentProviderName = 'VIRTUAL_CARD'

  private readonly log = new Logger(VirtualCardProvider.name)

  constructor(
    private readonly cards: VirtualCardService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 승인 — 카드의 한도를 쓴다.
   *
   * **거절을 예외가 아니라 값으로 답한다** (TASK-0052 4.3). 한도 초과는 프로그램의
   * 오류가 아니라 정상적인 대답이고, 부르는 쪽은 그 대답으로 결제를 `FAILED` 로
   * 옮긴다.
   *
   * 결제키는 카드 원장의 참조와 같은 값이다. 취소·환불이 그것으로 이 승인을 되찾는다.
   */
  async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    const cardId = cardIdOf(request)

    if (cardId === null) {
      return { approved: false, paymentKey: null, reason: '결제할 카드를 고르지 않았어요.' }
    }

    const simulated = await this.simulate()

    if (simulated !== null) return simulated

    try {
      await this.cards.charge(cardId, request.amount, request.paymentId)
    } catch (error: unknown) {
      // 카드 쪽 거절은 전부 「승인되지 않았다」로 접힌다. 그 이유가 무엇이었는지는
      // 카드 서비스가 이미 도메인 코드로 답했고, 여기서 다시 해석하면 그 코드가
      // 두 곳에서 조금씩 다르게 번역된다.
      return { approved: false, paymentKey: null, reason: reasonOf(error) }
    }

    return { approved: true, paymentKey: request.paymentId, reason: null }
  }

  /**
   * 매입 확정.
   *
   * **아무것도 하지 않는다.** 가상 카드에는 승인과 매입 사이의 은행이 없어서, 승인
   * 시점에 이미 한도가 빠져 있다. 그래도 이 메서드가 있는 이유는 토스에는 그 구분이
   * 있고, 두 구현이 같은 계약을 따라야 하기 때문이다 (D-031) — 부르는 쪽이
   * 프로바이더에 따라 다른 순서를 밟게 되면 추상화가 아무 일도 하지 않는 것이다.
   */
  capture(): Promise<void> {
    return Promise.resolve()
  }

  /** 취소 — 매입 전이므로 한도를 그대로 돌려준다. */
  async cancel(paymentKey: string, amount: number): Promise<void> {
    await this.releaseFor(paymentKey, amount, 'CANCEL')
  }

  /** 환불 — 매입 후. 카드가 정지·삭제됐어도 돌아간다 (TASK-0053 4.2). */
  async refund(paymentKey: string, amount: number): Promise<void> {
    await this.releaseFor(paymentKey, amount, 'REFUND')
  }

  /**
   * 대사용 조회.
   *
   * 가상 카드에는 물어볼 저쪽이 없다 — 우리가 곧 저쪽이다. 그래서 원장에 이 결제의
   * 승인이 남아 있으면 `PAID`, 없으면 `FAILED` 다. 토스는 여기서 실제 API 를 부른다.
   */
  async getStatus(paymentKey: string): Promise<PaymentStatus> {
    const charged = await this.cards.chargedFor(paymentKey)

    return charged ? 'PAID' : 'FAILED'
  }

  // ---------------------------------------------------------------- internals

  /**
   * 재현 장치. 꺼져 있으면 `null` 을 답하고 정상 경로로 간다.
   *
   * 지연을 먼저 하고 마감을 본다. 마감을 넘기면 **거절이 아니라 끊김**이고, 그 둘은
   * 부르는 쪽에 같은 결과(`FAILED`)를 주지만 이유가 다르다 — 끊긴 것은 저쪽이
   * 승인했는지 우리가 모르는 상태이고, 그 불일치는 대사가 찾는다.
   */
  private async simulate(): Promise<AuthorizeResult | null> {
    const mode = this.config.paymentSimulation

    if (mode === 'off') return null

    // 지연은 **끝난다**, 타임아웃은 **끊긴다.** 그 둘이 다른 값인 이유가 4.5 다 —
    // 지연을 아주 길게 잡는 것으로 타임아웃을 흉내 내면, 재는 것이 프로바이더가
    // 아니라 검사의 인내심이 된다.
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_DELAY_MS))

    if (mode === 'delay') return null

    this.log.warn('가상 카드 승인이 마감을 넘겨 끊겼습니다.')

    return { approved: false, paymentKey: null, reason: '승인이 시간 안에 끝나지 않았어요.' }
  }

  /** 결제키로 카드를 되찾아 한도를 돌려준다. */
  private async releaseFor(
    paymentKey: string,
    amount: number,
    kind: 'CANCEL' | 'REFUND',
  ): Promise<void> {
    const cardId = await this.cards.cardIdFor(paymentKey)

    if (cardId === null) {
      // 승인이 없는 결제키다. 던지지 않는 이유는 부르는 쪽이 이미 우리 장부에
      // 환불을 적기로 한 뒤이기 때문이다 — 여기서 던지면 그 트랜잭션이 통째로
      // 되돌아가고, 돌려줄 카드가 없다는 사실은 로그에도 안 남는다.
      this.log.warn(`승인 기록이 없는 결제키의 ${kind} 입니다: ${paymentKey}`)

      return
    }

    await this.cards.release(cardId, amount, paymentKey, kind)
  }
}

/**
 * 어느 카드로 결제하는가. 결제를 시작할 때 정해져 있다.
 *
 * 포트의 자리 이름은 `methodRef` 다 — 프로바이더마다 뜻이 다른 자리라서 그렇고,
 * 가상 카드에서 그 뜻이 카드 id 인 것을 이 함수가 말한다 (TASK-0055 4.6).
 */
function cardIdOf(request: AuthorizeRequest): string | null {
  return request.methodRef ?? null
}

/** 카드 서비스가 던진 거절의 문장. 사람이 읽을 것이므로 그대로 쓴다. */
function reasonOf(error: unknown): string {
  if (error === null || typeof error !== 'object' || !('getResponse' in error)) {
    return '결제가 승인되지 않았어요.'
  }

  const payload = (error as { getResponse: () => unknown }).getResponse()

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload

    if (typeof message === 'string') return message
  }

  return '결제가 승인되지 않았어요.'
}
