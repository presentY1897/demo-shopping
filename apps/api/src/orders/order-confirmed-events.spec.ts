import { describe, expect, it } from 'vitest'

import type { OrderConfirmedEvents } from './order-confirmed-events.js'
import { confirmationsOf, NoopOrderConfirmedEvents } from './order-confirmed-events.js'
import type { SellerOrderStatusChanged } from './seller-order-events.js'

/**
 * 확정의 후속 이벤트가 **어디서 갈라져 나오는가** (TASK-0064 F4 · R2).
 *
 * 정산(M12)과 적립금(M11)이 아직 없으므로 여기서 잴 수 있는 것은 「무엇이 그쪽으로
 * 넘어가는가」뿐이다. 그런데 그것이 정확히 나중에 조용히 틀릴 자리다 — 확정이 아닌
 * 전이가 하나 섞이면 배송 중인 주문에 적립금이 지급되고, 열쇠가 매번 달라지면 같은
 * 확정이 두 번 도착했을 때 이중 지급을 막을 것이 없다.
 */

const OCCURRED_AT = new Date('2026-09-06T00:00:00.000Z')

function changed(
  partial: Partial<SellerOrderStatusChanged> & Pick<SellerOrderStatusChanged, 'to'>,
): SellerOrderStatusChanged {
  return {
    sellerOrderId: '019596d0-1f1c-7c2e-9a0e-6a0000000001',
    from: 'DELIVERED',
    actor: 'BUYER',
    occurredAt: OCCURRED_AT,
    ...partial,
  }
}

describe('확정만 골라낸다', () => {
  it('확정이 아닌 전이는 넘기지 않는다', () => {
    const events = [
      changed({ from: 'SHIPPED', to: 'DELIVERED' }),
      changed({ from: 'PAYMENT_PENDING', to: 'PAYMENT_FAILED' }),
      changed({ from: 'DELIVERED', to: 'RETURNED' }),
    ]

    expect(confirmationsOf(events)).toEqual([])
  })

  it('빈 목록은 빈 목록이다', () => {
    expect(confirmationsOf([])).toEqual([])
  })

  it('구매자가 누른 확정과 스케줄러가 옮긴 확정을 **둘 다** 넘긴다', () => {
    // 하나라도 빠지면 「구매자가 누른 확정에만 적립금이 붙는」 어긋남이 된다. 두
    // 길이 같은 자리를 지나는 것이 그것을 막는 구조다.
    const manual = changed({ to: 'CONFIRMED', actor: 'BUYER' })
    const automatic = changed({
      sellerOrderId: '019596d0-1f1c-7c2e-9a0e-6a0000000002',
      to: 'CONFIRMED',
      actor: 'SYSTEM',
    })

    expect(confirmationsOf([manual, automatic]).map((event) => event.actor)).toEqual([
      'BUYER',
      'SYSTEM',
    ])
  })

  it('확정된 시각을 이력과 같은 값으로 넘긴다', () => {
    const [confirmed] = confirmationsOf([changed({ to: 'CONFIRMED' })])

    expect(confirmed?.confirmedAt).toEqual(OCCURRED_AT)
  })

  it('멱등 열쇠는 판매자 몫의 id 그 자체다', () => {
    // `CONFIRMED` 를 떠나는 화살표가 없어 한 몫은 평생 한 번만 확정된다. 그래서
    // 그 id 가 곧 「이 확정」의 이름이고, 재발행이 같은 열쇠를 갖는다.
    const event = changed({ to: 'CONFIRMED' })
    const [first] = confirmationsOf([event])
    const [again] = confirmationsOf([event])

    expect(first?.idempotencyKey).toBe(event.sellerOrderId)
    expect(again?.idempotencyKey).toBe(first?.idempotencyKey)
  })
})

describe('지금 바인딩되는 구현', () => {
  it('아무것도 하지 않고 던지지도 않는다', async () => {
    // 던지지 않는 것이 결정이다 — 정산 등록에 실패한 것이 구매확정을 되돌릴
    // 이유는 아니다. 인자를 받지 않는 것은 `NoopSellerOrderEvents` 와 같다: 쓰지
    // 않는 값을 받는 시늉을 하면 그 자리가 「나중에 여기서 읽는다」로 읽힌다.
    const port: OrderConfirmedEvents = new NoopOrderConfirmedEvents()

    await expect(
      port.confirmed(confirmationsOf([changed({ to: 'CONFIRMED' })])),
    ).resolves.toBeUndefined()
  })
})
