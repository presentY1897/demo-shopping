import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { PointController } from './point.controller.js'
import { PointExpiryService } from './point-expiry.service.js'
import { PointSummaryService } from './point-summary.service.js'
import { PointsOnOrderConfirmed } from './points-order-confirmed.js'
import { PointsService } from './points.service.js'

/**
 * 적립금 (TASK-0076). Prisma·시계·설정은 전역 모듈에서 온다.
 *
 * **의존이 `PrismaModule` 하나다.** 적립금은 주문의 금액도 재고도 모르고, 아는 것은
 * 잔액과 원장뿐이다 — 그 좁음 덕분에 구매확정 쪽(`SellerOrderModule`)이 이 모듈을
 * 들여오기만 하면 되고, 방향이 **한쪽으로만** 흐른다. 반대로 여기서 주문 서비스를
 * 들여오면 `Order → SellerOrder → Points → Order` 가 되어 `forwardRef` 로 겨우 도는
 * 모양이 된다 (`SellerOrderModule` 이 같은 이유로 `OrderModule` 과 갈라져 있다).
 *
 * `PointsOnOrderConfirmed` 를 여기서 내보내고 저쪽 모듈이 토큰에 묶는다. 구현이
 * 어디에 사는지와 어느 포트에 꽂히는지를 나눠 두면, 나중에 정산(M12)이 같은 포트에
 * 붙을 때 바뀌는 것이 저쪽 한 줄뿐이다.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PointController],
  providers: [
    PointsService,
    // 화면이 묻는 둘 — 「곧 들어올 것」과 「곧 사라질 것」 (TASK-0077). 원장에 아직
    // 행이 없는 값이라 원장을 쓰는 서비스와 나눠 두었다.
    PointSummaryService,
    PointExpiryService,
    PointsOnOrderConfirmed,
  ],
  exports: [PointsService, PointSummaryService, PointExpiryService, PointsOnOrderConfirmed],
})
export class PointsModule {}
