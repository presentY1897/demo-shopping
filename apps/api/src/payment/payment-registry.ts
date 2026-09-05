import { Injectable, InternalServerErrorException } from '@nestjs/common'
import type { PaymentProviderName } from '@shopping/shared'

import type { PaymentProviderPort } from './payment-provider.js'

/**
 * 결제수단에 따라 구현을 고른다 (F1).
 *
 * **비어 있는 채로 시작한다.** 구현은 TASK-0054(가상 카드)와 TASK-0055(토스)가
 * 넣고, 이 TASK 는 고르는 자리만 만든다 — 그것이 「제외」에 적힌 대로다.
 *
 * 없는 프로바이더를 물으면 **던진다.** 조용히 아무것도 안 하는 것이 최악인데,
 * 결제에서 그 모양은 「돈이 안 빠졌는데 주문은 됐다」이기 때문이다. 500 인 이유는
 * 이것이 사용자의 잘못이 아니라 **배선이 빠진 것**이라서다 — 요청을 고쳐도 낫지
 * 않는다.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<PaymentProviderName, PaymentProviderPort>()

  register(provider: PaymentProviderPort): void {
    this.providers.set(provider.name, provider)
  }

  resolve(name: PaymentProviderName): PaymentProviderPort {
    const provider = this.providers.get(name)

    if (provider === undefined) {
      throw new InternalServerErrorException(`결제수단 구현이 등록되지 않았습니다: ${name}`)
    }

    return provider
  }

  /** 지금 등록된 것들. 헬스체크와 검사가 읽는다. */
  registered(): readonly PaymentProviderName[] {
    return [...this.providers.keys()]
  }
}
