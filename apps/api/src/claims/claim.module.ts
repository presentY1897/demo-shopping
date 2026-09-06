import { Module } from '@nestjs/common'

import { SellerOrderModule } from '../orders/seller-order.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import {
  CANCEL_REFUND_EVENTS,
  CANCEL_RESTOCK_EVENTS,
  NoopCancelRefundEvents,
  NoopCancelRestockEvents,
} from './cancel-events.js'
import { ClaimController } from './claim.controller.js'
import { ClaimService } from './claim.service.js'

/**
 * 취소 · 반품 (TASK-0065 · 0066 · 0067).
 *
 * **의존이 둘이다.** `PrismaModule` 과, 취소가 판매자 몫을 닫을 때 지나는 문
 * (`SellerOrderModule`)이다. 뒤엣것이 순환을 만들지 않는 이유는 저쪽이 여전히
 * `PrismaModule` 하나만 들여오기 때문이고, 그 좁음이 저 모듈이 애초에 `OrderModule`
 * 과 갈라져 나온 이유다 — 예약 만료 스케줄러와 결제 확정이 같은 문을 지나야 했다.
 * 여기서 화살표는 `Claim → SellerOrder` **한 방향**으로만 흐른다.
 *
 * 실제 취소 처리가 만지는 나머지 둘 — 결제(TASK-0068)와 재고(TASK-0069) — 은 여전히
 * 여기 없다. 대신 포트가 있고, 지금 바인딩된 구현은 아무것도 하지 않는다
 * (`cancel-events.ts`). 그 둘을 지금 모듈로 끌어들이면 `Order → Claim → Payment →
 * Order` 가 되어 `forwardRef` 로 겨우 도는 모양이 되고, 그때는 **취소를 붙이는
 * TASK 가 아니라 순환을 푸는 TASK** 가 된다.
 *
 * 반품 기간이 읽는 `autoConfirmWindowMsOf` 는 **함수**라 모듈이 필요 없다. 그것이
 * 축을 나눠 쓰는 값싼 방법이고, 축을 여기서 다시 정하지 않는 이유는
 * `claim.service.ts` 의 `returnWindowMs` 에 적혀 있다.
 *
 * **반품의 부속(`ReturnDetail`)을 이 모듈이 쓴다** (TASK-0067). 신청의 계약이 하나가
 * 된 뒤로 `POST /claims` 도 완전한 반품을 만들고, 부속은 신청서와 **한 트랜잭션**에
 * 쓰여야 하기 때문이다. 그래도 모듈이 늘지 않는 것은 그것이 표 하나일 뿐이고 —
 * 판단은 전부 `return-rules.ts` 의 순수 함수다 — `ReturnModule` 을 들여올 이유가
 * 없기 때문이다. 화살표는 여전히 `Return → Claim` 한 방향이다.
 */
@Module({
  imports: [PrismaModule, SellerOrderModule],
  controllers: [ClaimController],
  providers: [
    ClaimService,
    // TASK-0068(환불)·0069(재고 복원)가 붙을 때 여기 두 줄만 바뀐다. 「아무것도 안
    // 한다」가 지금 무엇을 뜻하는지는 `cancel-events.ts` 가 설명한다.
    { provide: CANCEL_REFUND_EVENTS, useClass: NoopCancelRefundEvents },
    { provide: CANCEL_RESTOCK_EVENTS, useClass: NoopCancelRestockEvents },
  ],
  exports: [ClaimService],
})
export class ClaimModule {}
