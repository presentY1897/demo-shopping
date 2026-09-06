import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ClaimModule } from './claim.module.js'
import { RefundingReturnEvents } from './refund.service.js'
import { RestockingReturnEvents } from './restock.service.js'
import { RETURN_REFUND_EVENTS, RETURN_RESTOCK_EVENTS } from './return-events.js'
import { ReturnController } from './return.controller.js'
import { ReturnService } from './return.service.js'

/**
 * 반품 (TASK-0067).
 *
 * **`ClaimModule` 안이 아니라 옆이다.** 여기 있는 것은 **신청 뒤의 걸음들**(수거 ·
 * 검수)이고, 그 걸음이 만드는 사실 — 회수 운송장, 검수 기록 — 은 클레임이 알 필요가
 * 없다. 신청 자체는 저쪽 문 하나를 지난다(`ClaimService.create`): 계약이 합쳐진 뒤로
 * 취소와 반품이 같은 요청 모양을 쓰고, 부속은 신청서와 한 트랜잭션에 쓰여야 하기
 * 때문이다. 화살표는 여기서 `Return → Claim` **한 방향**으로만 흐른다.
 *
 * 배송을 모듈로 들여오지 **않는 것**도 결정이다. 회수 운송장이 쓰는 것은
 * `shipment-rules.ts` 의 **순수 함수들**(운송사 고르기 · 번호 만들기)뿐이고, 그것들은
 * 데이터베이스도 시계도 보지 않으므로 프로바이더가 필요 없다 — 반품 기간이
 * `autoConfirmWindowMsOf` 를 함수로 부르는 것과 같은 방법이다. `ShipmentService` 를
 * 들여오면 반품이 배송의 전이 문까지 알게 되는데, 회수는 그 문을 지나지 않는다.
 *
 * **환불이 붙었다** (TASK-0068). 실행기는 `ClaimModule` 이 갖는다 — 취소와 반품이
 * 끝에서 하는 일이 같기 때문이고(`claim-rules.ts` 의 `REFUNDED` 가 두 경로가 만나는
 * 유일한 자리다), 두 벌로 두면 「이미 몇 개를 환불했나」를 세는 규칙이 두 곳에 살게
 * 된다. 화살표는 여전히 `Return → Claim` 한 방향이다.
 *
 * **재입고도 붙었고, 실행기는 마찬가지로 `ClaimModule` 이 갖는다** (TASK-0069). 이유가
 * 환불과 같다 — 되돌리는 일은 끝에서 같은 일이고, 「이 항목이 이미 되돌아왔나」를
 * 묻는 열쇠가 두 곳에 살면 안 된다. 화살표는 여전히 `Return → Claim` 한 방향이고,
 * `StockModule` 은 저쪽이 들여온다.
 */
@Module({
  imports: [PrismaModule, ClaimModule],
  controllers: [ReturnController],
  providers: [
    ReturnService,
    { provide: RETURN_REFUND_EVENTS, useClass: RefundingReturnEvents },
    { provide: RETURN_RESTOCK_EVENTS, useClass: RestockingReturnEvents },
  ],
  exports: [ReturnService],
})
export class ReturnModule {}
