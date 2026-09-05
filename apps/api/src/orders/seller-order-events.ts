import type { OrderStatus } from '@shopping/shared'

import type { SellerOrderActor } from './seller-order-transitions.js'

/**
 * 상태가 옮겨졌다는 사실 하나 (TASK-0059 ⑥ · M13 연결점).
 *
 * **이미 일어난 일이다.** 이 객체가 만들어졌다는 것은 행이 바뀌었고 이력이 남았고
 * 트랜잭션이 커밋됐다는 뜻이라, 받는 쪽은 「해도 되는가」를 다시 묻지 않는다.
 */
export interface SellerOrderStatusChanged {
  readonly sellerOrderId: string
  readonly from: OrderStatus
  readonly to: OrderStatus
  readonly actor: SellerOrderActor
  readonly occurredAt: Date
}

/**
 * 상태가 바뀌었을 때 알릴 곳 (M13).
 *
 * **왜 지금 포트만 두는가.** 알림은 M13 의 일이고 여기서 구현하면 두 TASK 가 같은
 * 것을 만든다. 그런데 **부르는 자리는 지금 정해야 한다** — 전이가 일어나는 곳이
 * 여기뿐인 동안에 자리를 잡아야, 나중에 「상태를 바꾸는 코드 전부를 찾아 알림을
 * 끼워 넣는」 작업이 되지 않는다.
 *
 * 목록을 한 번에 받는 이유는 한 결제가 판매자 몫 셋을 동시에 옮기기 때문이다
 * (`OrderService.markPaid`). 낱개로 부르면 받는 쪽이 「같은 주문의 셋」이라는 사실을
 * 잃는다.
 */
export interface SellerOrderEvents {
  statusChanged: (events: readonly SellerOrderStatusChanged[]) => Promise<void>
}

/** 주입 토큰. 인터페이스에는 프로바이더를 걸 런타임 값이 없다. */
export const SELLER_ORDER_EVENTS = Symbol('SELLER_ORDER_EVENTS')

/**
 * 지금 바인딩되는 구현. **아무것도 하지 않는다.**
 *
 * 「아무것도 안 한다」가 무엇을 뜻하는지 적어 둔다. 빠지는 것은 **알림뿐**이다 —
 * 상태는 이미 옮겨졌고 이력도 남았으며 정산·클레임이 읽는 사실은 전부 데이터베이스에
 * 있다. 즉 이 구현으로 도는 시스템에서 잘못되는 것은 「구매자가 배송 시작을 모른다」
 * 하나이고, 주문이 잘못된 상태로 가거나 돈이 어긋나는 일은 없다.
 *
 * **던지지 않는 것도 결정이다.** 알림을 못 보낸 것이 전이를 되돌릴 이유는 아니다 —
 * 물건은 이미 떠났는데 상태가 되감기면 그쪽이 훨씬 나쁘다. M13 이 실제 발행을 붙일
 * 때도 이 성질은 지켜야 하고, 그래서 부르는 쪽은 **커밋한 뒤에** 부른다.
 */
export class NoopSellerOrderEvents implements SellerOrderEvents {
  statusChanged(): Promise<void> {
    return Promise.resolve()
  }
}
