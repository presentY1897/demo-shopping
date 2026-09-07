import { Injectable } from '@nestjs/common'
import type { OrderStatus } from '@shopping/shared'

import type { SellerOrderEvents, SellerOrderStatusChanged } from '../orders/seller-order-events.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { NotificationDraft } from './notification.service.js'
import { NotificationService } from './notification.service.js'

/**
 * 상태가 바뀌면 산 사람에게 알린다 (TASK-0090 F1 · F2).
 *
 * TASK-0059 가 남겨 둔 포트(`SellerOrderEvents`)의 실제 구현이다. 그 파일의 주석이
 * 「부르는 자리는 지금 정해야 한다 — 전이가 일어나는 곳이 여기뿐인 동안에 자리를
 * 잡아야, 나중에 상태를 바꾸는 코드 전부를 찾아 알림을 끼워 넣는 작업이 되지
 * 않는다」고 적어 두었고, 그 예상이 맞았다: 여기 한 곳을 채우는 것으로 발송 ·
 * 배송완료 · 취소 · 확정이 전부 알림을 갖는다.
 *
 * **던지지 않는다.** 알림을 못 보낸 것이 전이를 되돌릴 이유는 아니다 — 물건은 이미
 * 떠났는데 상태가 되감기면 그쪽이 훨씬 나쁘다. 그 성질은 `NotificationService.send`
 * 가 지킨다.
 */
@Injectable()
export class OrderStatusNotifier implements SellerOrderEvents {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async statusChanged(events: readonly SellerOrderStatusChanged[]): Promise<void> {
    const notable = events.filter((event) => NOTABLE[event.to] !== undefined)

    if (notable.length === 0) return

    // 한 결제가 판매자 몫 셋을 동시에 옮긴다 — 그래서 한 번에 읽는다. 낱개로 물으면
    // 조회가 몫 수만큼 늘어나고, 그 비용은 결제 응답에 얹힌다.
    const rows = await this.prisma.sellerOrder.findMany({
      where: { id: { in: notable.map((event) => event.sellerOrderId) } },
      select: {
        id: true,
        brandName: true,
        order: { select: { id: true, orderNumber: true, userId: true } },
      },
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const drafts: NotificationDraft[] = []

    for (const event of notable) {
      const row = byId.get(event.sellerOrderId)
      const text = NOTABLE[event.to]

      if (row === undefined || text === undefined) continue

      drafts.push({
        userId: row.order.userId,
        type: 'ORDER_STATUS',
        title: text.title,
        body: `${row.brandName} · ${text.body}`,
        // **앱 안의 경로다.** 도메인을 여기 실으면 배포마다 달라지는 값이 데이터에
        // 굳고, 도메인을 옮기는 날 지난 알림이 전부 남의 사이트를 가리킨다.
        link: `/mypage/orders/${row.order.id}`,
      })
    }

    await this.notifications.sendMany(drafts)
  }
}

/**
 * 알릴 만한 전이와 그때 하는 말.
 *
 * **전부에 알리지 않는다.** `PAID` 는 사람이 방금 결제 버튼을 누른 결과라 알림이
 * 「방금 한 일」을 다시 말하는 것이 되고, `PREPARING` 은 판매자의 내부 상태라
 * 구매자에게는 아직 아무 일도 일어나지 않은 것과 같다. 배지를 올리는 알림은 **읽을
 * 이유가 있어야** 한다.
 */
const NOTABLE: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  SHIPPED: { title: '상품이 발송됐어요', body: '운송장 번호를 확인해 보세요.' },
  DELIVERED: { title: '상품이 도착했어요', body: '받으신 상품을 확인해 주세요.' },
  CONFIRMED: { title: '구매가 확정됐어요', body: '적립금이 지급되고 리뷰를 쓸 수 있어요.' },
  CANCELED: { title: '주문이 취소됐어요', body: '환불 내역을 확인해 보세요.' },
  RETURNED: { title: '반품이 처리됐어요', body: '환불 내역을 확인해 보세요.' },
}
