import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ClaimController } from './claim.controller.js'
import { ClaimService } from './claim.service.js'

/**
 * 취소 · 반품 (TASK-0065).
 *
 * **의존이 `PrismaModule` 하나다.** 클레임이 아는 것은 주문의 상태와 항목의 수량뿐
 * 이고, 그 좁음이 뒤이을 TASK 들이 여기를 순환 없이 들여올 수 있는 이유다 —
 * 실제 취소·반품 처리(TASK-0066 · 0067)는 재고와 배송을 만지고, 환불(TASK-0068)은
 * 결제를 만진다. 그 셋을 이 모듈에 미리 끌어들이면 `Order → Claim → Order` 가 되어
 * `forwardRef` 로 겨우 도는 모양이 된다 — `SellerOrderModule` 이 같은 이유로 같은
 * 모양이다.
 *
 * 반품 기간이 읽는 `autoConfirmWindowMsOf` 는 **함수**라 모듈이 필요 없다. 그것이
 * 축을 나눠 쓰는 값싼 방법이고, 축을 여기서 다시 정하지 않는 이유는
 * `claim.service.ts` 의 `returnWindowMs` 에 적혀 있다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ClaimController],
  providers: [ClaimService],
  exports: [ClaimService],
})
export class ClaimModule {}
