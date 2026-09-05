import type { SellerOrderStatusChanged } from './seller-order-events.js'
import type { SellerOrderActor } from './seller-order-transitions.js'

/**
 * 구매확정 하나가 뒤에 남기는 일 — **자리만** (TASK-0064 F4 · M11 · M12).
 *
 * ## 왜 `seller-order-events.ts` 옆에 따로 있나
 *
 * 저쪽은 「상태가 옮겨졌다」를 알림(M13)에 넘기는 포트다. 여기서 넘기는 것은 알림이
 * 아니라 **돈**이다 — 정산 대상 등록(M12)과 적립금 지급(M11)이고, 받는 쪽도 실패의
 * 뜻도 다르다. 알림을 못 보낸 것은 「구매자가 모른다」이지만 정산 등록을 못 한
 * 것은 「판매자가 돈을 못 받는다」이므로, 둘을 한 포트에 묶으면 나중에 그 둘의
 * 재시도 정책을 함께 정해야 한다.
 *
 * ## 「아무것도 안 하는 구현」이 지금 무엇을 뜻하는가
 *
 * 빠지는 것은 **후속 처리뿐**이다. 확정 자체는 이미 끝났다 — 상태는 `CONFIRMED` 이고
 * 이력에 누가 언제 옮겼는지가 남아 있으며, 정산 배치(M12)가 나중에 읽어야 할 사실은
 * **전부 데이터베이스에 있다.** 즉 이 구현으로 도는 시스템에서 잘못되는 것은
 * 「정산서와 적립금이 아직 만들어지지 않는다」 하나이고, **뒤늦게 만들 수 있다** —
 * 확정된 몫은 상태로 찾을 수 있고 확정 시각은 이력에 있기 때문이다.
 *
 * **던지지 않는 것도 결정이다.** 정산 등록에 실패한 것이 구매확정을 되돌릴 이유는
 * 아니다 — 사람이 「확정」을 눌렀고 그 판단은 이미 유효하다. M11·M12 가 실제 구현을
 * 붙일 때도 이 성질은 지켜야 하고, 그래서 부르는 쪽은 **커밋한 뒤에** 부른다.
 */
export interface OrderConfirmed {
  readonly sellerOrderId: string
  /** 확정된 시각. 이력에 적힌 것과 같은 값이다. */
  readonly confirmedAt: Date
  /** 구매자가 눌렀나, D+7 이 지났나. 정산에는 같지만 문의를 받는 쪽에는 다르다. */
  readonly actor: SellerOrderActor
  /**
   * 같은 확정이 두 번 도착해도 한 번만 처리되게 하는 열쇠 (R2 — 적립금 이중 지급).
   *
   * **판매자 몫의 id 그 자체다.** 전이표에 `CONFIRMED` 를 떠나는 화살표가 없어
   * (`seller-order-transitions.ts`) 한 몫은 **평생 한 번만** 확정되고, 그래서 그
   * id 가 곧 「이 확정」의 이름이다. 시각이나 난수를 섞으면 재발행이 다른 열쇠를
   * 갖게 되어 멱등이 깨지는데, 열쇠가 막아야 하는 것이 정확히 그 경우다.
   */
  readonly idempotencyKey: string
}

/**
 * 확정된 몫을 받을 곳 (M11 · M12).
 *
 * 목록을 한 번에 받는 이유는 자동 확정 한 주기가 여러 몫을 옮기기 때문이다. 낱개로
 * 부르면 받는 쪽이 「한 주기의 결과」라는 사실을 잃는다.
 */
export interface OrderConfirmedEvents {
  confirmed: (events: readonly OrderConfirmed[]) => Promise<void>
}

/** 주입 토큰. 인터페이스에는 프로바이더를 걸 런타임 값이 없다. */
export const ORDER_CONFIRMED_EVENTS = Symbol('ORDER_CONFIRMED_EVENTS')

/**
 * 상태 전이 목록에서 **확정만** 골라낸다.
 *
 * 이 함수가 있는 덕분에 부르는 자리가 하나다 (`SellerOrderService.publish`). 수동
 * 확정도 자동 확정도 같은 문을 지나 같은 자리에서 발행되므로, 「구매자가 누른
 * 확정에만 적립금이 붙는」 종류의 어긋남이 구조적으로 생기지 않는다.
 */
export function confirmationsOf(
  events: readonly SellerOrderStatusChanged[],
): readonly OrderConfirmed[] {
  return events
    .filter((event) => event.to === 'CONFIRMED')
    .map((event) => ({
      sellerOrderId: event.sellerOrderId,
      confirmedAt: event.occurredAt,
      actor: event.actor,
      idempotencyKey: event.sellerOrderId,
    }))
}

/**
 * 지금 바인딩되는 구현. **아무것도 하지 않는다.**
 *
 * 무엇을 뜻하는지는 {@link OrderConfirmed} 에 적혀 있다. M11·M12 가 붙을 때
 * `order.module.ts` 의 한 줄만 바뀐다.
 */
export class NoopOrderConfirmedEvents implements OrderConfirmedEvents {
  confirmed(): Promise<void> {
    return Promise.resolve()
  }
}
