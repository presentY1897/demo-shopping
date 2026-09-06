import { HttpException, Injectable, Logger } from '@nestjs/common'

import { domainFailureOf } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { OrderConfirmed, OrderConfirmedEvents } from '../orders/order-confirmed-events.js'
import { PointsService } from './points.service.js'

/**
 * 구매확정이 적립금을 지급한다 (TASK-0076 F1 · F2 · F6).
 *
 * **새 방아쇠를 만들지 않는다.** TASK-0064 가 `order-confirmed-events.ts` 에 자리를
 * 비워 두었고, 그 포트는 **수동 확정과 자동 확정이 함께 지나는 유일한 자리**다
 * (`SellerOrderService.publish`). 그래서 「구매자가 누른 확정에만 적립금이 붙는」
 * 종류의 어긋남이 구조적으로 생기지 않는다.
 *
 * **배송완료만으로는 지급되지 않는다** (F2). 이 파일이 그것을 위해 하는 일은
 * 아무것도 없다는 것이 핵심이다 — `confirmationsOf` 가 `to === 'CONFIRMED'` 인
 * 사건만 고르므로 `DELIVERED` 는 여기 도착조차 하지 않는다. 이유는
 * `state-machines.md` 1장에 있다: 배송완료 직후 정산하면 반품 시 회수할 방법이 없고,
 * 확정은 「문제없음」의 표시다.
 *
 * **던지지 않는다.** 포트가 처음부터 그렇게 약속돼 있다 — 「정산 등록에 실패한 것이
 * 구매확정을 되돌릴 이유는 아니다. 사람이 확정을 눌렀고 그 판단은 이미 유효하다」
 * (`order-confirmed-events.ts`). 부르는 쪽은 커밋한 뒤에 부르므로 여기서 던지면
 * **이미 끝난 확정이 오류로 보이기만** 하고 되돌아가지도 않는다. 대신 로그에 남고,
 * 지급되지 않은 몫은 나중에 다시 만들 수 있다 — 확정된 몫은 상태로 찾을 수 있고
 * 확정 시각은 이력에 있기 때문이다.
 */
@Injectable()
export class PointsOnOrderConfirmed implements OrderConfirmedEvents {
  private readonly log = new Logger(PointsOnOrderConfirmed.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  async confirmed(events: readonly OrderConfirmed[]): Promise<void> {
    for (const event of events) await this.earnFor(event)
  }

  /**
   * 확정된 한 몫의 적립.
   *
   * 적립의 근거는 **그 판매자 몫의 실결제금액**(`SellerOrder.paidAmount`)이다.
   * 주문 전체가 아닌 이유는 확정의 단위가 판매자 몫이기 때문이다 — 한 주문의 두
   * 판매자가 각각 다른 날 확정되고, 하나만 반품될 수도 있다.
   *
   * 멱등의 열쇠는 `SellerOrder.id` 다. 전이표에 `CONFIRMED` 를 떠나는 화살표가 없어
   * 한 몫은 평생 한 번만 확정되고(`seller-order-transitions.ts`), 그래서 그 id 가
   * 곧 「이 확정」의 이름이다. 이벤트가 실어 온 `idempotencyKey` 와 같은 값이며,
   * 둘째 적립은 `PointTransaction_ref_key` 가 거절한다.
   */
  private async earnFor(event: OrderConfirmed): Promise<void> {
    try {
      const sellerOrder = await this.prisma.sellerOrder.findUnique({
        where: { id: event.sellerOrderId },
        select: { id: true, paidAmount: true, order: { select: { userId: true } } },
      })

      // 사라진 몫에 적립할 것은 없다. 확정과 이 호출 사이에 지워지는 일은 없지만,
      // 「없으면 조용히 지나간다」가 「없으면 던진다」보다 옳다 — 던져 봤자
      // 되돌릴 확정이 없다.
      if (sellerOrder === null) return

      await this.points.earn({
        userId: sellerOrder.order.userId,
        paidAmount: sellerOrder.paidAmount,
        refType: 'SELLER_ORDER',
        refId: sellerOrder.id,
      })
    } catch (error: unknown) {
      // **같은 확정이 두 번 온 것은 실패가 아니다.** 멱등이 동작했다는 뜻이고
      // (F6), 그것을 error 로 남기면 정상 동작이 매일 로그에 쌓여 진짜 실패가
      // 그 사이에 묻힌다 — `order-confirm.ts` 의 `worthLogging` 과 같은 판단이다.
      if (isAlreadyRecorded(error)) return

      this.log.error(`구매확정 적립에 실패했습니다: ${event.sellerOrderId}`, error)
    }
  }
}

/** 이 예외가 「이미 적립됐다」인가. 그것만 조용히 넘긴다. */
function isAlreadyRecorded(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false

  return domainFailureOf(error.getResponse())?.code === 'POINT_ALREADY_RECORDED'
}
