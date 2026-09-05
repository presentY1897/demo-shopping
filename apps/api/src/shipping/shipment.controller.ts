import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import type { ShipmentResponse } from '@shopping/shared'
import { shipSellerOrderRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ShipmentService } from './shipment.service.js'

/**
 * 배송의 두 라우트 (TASK-0061).
 *
 * **판매자 몫의 하위 자원이다.** 배송은 `SellerOrder` 당 한 건이라 자기 id 로 찾을
 * 이유가 없고(`/shipments/:id` 였다면 화면이 그 id 를 어디선가 먼저 얻어야 한다),
 * 구매자도 판매자도 손에 들고 있는 것은 주문의 id 다.
 *
 * `SellerOrderController` 에 붙이지 않은 것은 소유의 문제다. 그쪽은 상태를 옮기는
 * 문(TASK-0059)이고 이쪽은 그 문이 요구하는 조건을 만드는 곳이라, 한 파일에 두면
 * 전이의 규칙과 배송의 규칙이 같은 자리에서 자란다.
 */
@Controller({ version: '1' })
export class ShipmentController {
  constructor(private readonly shipments: ShipmentService) {}

  /**
   * 발송 처리 (F1).
   *
   * **`order.write` 다.** 상태를 옮기는 요청이고, 옮길 수 없는 사람에게 열어 둘 이유가
   * 없다. 「누가 발송할 수 있는가」의 최종 판단은 상태 머신이 한다 — 이 데코레이터는
   * 퍼미션을, 서비스는 그 주문의 소유를, 전이표는 주체를 본다.
   */
  @Post('seller-orders/:id/shipment')
  @RequirePermission('order.write')
  ship(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ShipmentResponse> {
    return this.shipments.ship(principal, id, parseInput(shipSellerOrderRequestSchema, body))
  }

  /**
   * 배송 조회 (F4 · F5).
   *
   * **`order.read` 다.** 여기는 「무엇을 누를 수 있나」가 아니라 「무엇이 어디까지
   * 왔나」라, 구매확정 전의 구매자도 배송이 끝난 뒤의 구매자도 읽을 수 있어야 한다.
   * 남의 것을 읽으려는 요청은 서비스가 403 으로 답한다.
   */
  @Get('seller-orders/:id/shipment')
  @RequirePermission('order.read')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<ShipmentResponse> {
    return this.shipments.get(principal, id)
  }
}
