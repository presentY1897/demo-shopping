import { Module } from '@nestjs/common'

import { SellerOrderModule } from '../orders/seller-order.module.js'
import { PaymentModule } from '../payment/payment.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import {
  CANCEL_REFUND_EVENTS,
  CANCEL_RESTOCK_EVENTS,
  NoopCancelRestockEvents,
} from './cancel-events.js'
import { ClaimController } from './claim.controller.js'
import { ClaimService } from './claim.service.js'
import { ClaimRefundRetryService } from './refund-retry.service.js'
import { ClaimRefundService, RefundingCancelEvents } from './refund.service.js'

/**
 * 취소 · 반품 (TASK-0065 · 0066 · 0067).
 *
 * **의존이 둘이다.** `PrismaModule` 과, 취소가 판매자 몫을 닫을 때 지나는 문
 * (`SellerOrderModule`)이다. 뒤엣것이 순환을 만들지 않는 이유는 저쪽이 여전히
 * `PrismaModule` 하나만 들여오기 때문이고, 그 좁음이 저 모듈이 애초에 `OrderModule`
 * 과 갈라져 나온 이유다 — 예약 만료 스케줄러와 결제 확정이 같은 문을 지나야 했다.
 * 여기서 화살표는 `Claim → SellerOrder` **한 방향**으로만 흐른다.
 *
 * **결제가 세 번째 의존으로 들어왔다** (TASK-0068). 승인된 취소는 끝에서 돈을
 * 돌려주고, 그 일을 하는 것은 `PaymentService` 다. 걱정하던 고리 — `Order → Claim →
 * Payment → Order` — 는 생기지 않는다: 화살표가 `Claim → Payment → Order →
 * {Prisma, Reservation, SellerOrder}` 로 **한 방향**이고, 주문 쪽은 클레임을 모른다.
 *
 * 대신 고리가 **프로바이더 층에는 있다.** 환불 포트를 주입받는 것이 `ClaimService`
 * 이므로 그 포트의 구현이 `ClaimService` 를 다시 주입받으면 `forwardRef` 없이 돌지
 * 않는다. 그래서 `ClaimRefundService` 는 클레임을 `REFUNDED` 로 옮기는 일을 스스로
 * 하되 **판단은 같은 순수 함수**(`claimTransitionDecision`)에 맡긴다 —
 * `refund.service.ts` 의 `moveToRefunded` 가 그 이유를 적어 두었다.
 *
 * 재고(TASK-0069)는 여전히 여기 없다. 포트가 있고, 지금 바인딩된 구현은 아무것도 하지
 * 않는다 (`cancel-events.ts`).
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
  imports: [PrismaModule, SellerOrderModule, PaymentModule],
  controllers: [ClaimController],
  providers: [
    ClaimService,
    // 환불의 실행 (TASK-0068). 반품도 같은 것을 쓴다 — 환불은 **끝에서 같은 일**이고
    // 그 앞까지 오는 길이 다를 뿐이다 (`claim-rules.ts` 의 `REFUNDED`).
    ClaimRefundService,
    // 나가지 못한 환불을 다시 내보낸다. 부르는 쪽이 없는 것이 정상이다 — 자기 주기로
    // 돌고, 무엇을 보고 몇 건씩 도는지는 `refund-retry.ts` 가 정한다.
    ClaimRefundRetryService,
    { provide: CANCEL_REFUND_EVENTS, useClass: RefundingCancelEvents },
    // TASK-0069(재고 복원)가 붙을 때 여기 한 줄만 바뀐다. 「아무것도 안 한다」가 지금
    // 무엇을 뜻하는지는 `cancel-events.ts` 가 설명한다.
    { provide: CANCEL_RESTOCK_EVENTS, useClass: NoopCancelRestockEvents },
  ],
  exports: [ClaimService, ClaimRefundService, ClaimRefundRetryService],
})
export class ClaimModule {}
