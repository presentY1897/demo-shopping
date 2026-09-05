import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import type { SellerOrderDeliveryResponse, ShipmentResponse } from '@shopping/shared'
import { shipSellerOrderRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { DeliverySimulatorService } from './delivery-simulator.service.js'
import { ShipmentService } from './shipment.service.js'

/**
 * 배송의 네 라우트 (TASK-0061 · TASK-0060 · TASK-0062).
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
  constructor(
    private readonly shipments: ShipmentService,
    private readonly simulator: DeliverySimulatorService,
  ) {}

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

  /**
   * 배송완료 처리 — 판매자가 흐름을 직접 이어 간다 (TASK-0060 4.3).
   *
   * **전이 라우트가 아니라 여기인 이유는 배송 표 때문이다.** 전이만 찍으면 주문은
   * `DELIVERED` 인데 `Shipment.status` 는 그대로라 구매자의 추적 화면이 「이동 중」에
   * 남는다 — TASK-0061 4.4 가 넘긴 문제이고, 서비스의 주석이 그 판단을 자세히 적는다.
   *
   * **본문이 없다.** 이 라우트가 일으키는 사건은 하나뿐이고, 종류를 요청이 고르게
   * 두면 그것은 곧 TASK-0061 이 열지 않기로 한 「사람이 배송 사실을 주장하는」
   * 라우트가 된다.
   */
  @Post('seller-orders/:id/delivery')
  @RequirePermission('order.write')
  markDelivered(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SellerOrderDeliveryResponse> {
    return this.shipments.markDelivered(principal, id)
  }

  /**
   * 수동 진행 — 다음 단계로 즉시 (TASK-0062 4장).
   *
   * **시연할 때 2분도 기다리기 어렵다.** 시뮬레이터가 시간에 맞춰 두드리는 문을
   * 사람이 지금 두드리는 자리이고, 만드는 사건과 그 사건이 일으키는 일은 배치가
   * 만드는 것과 **같다**.
   *
   * **본문이 없다.** 다음 단계는 지금 상태의 함수이므로 요청이 고를 것이 없고,
   * 고르게 두는 순간 이 라우트는 TASK-0061 이 열지 않기로 한 「사람이 임의의 배송
   * 사실을 주장하는」 문이 된다 — 바로 위 `markDelivered` 가 본문을 받지 않는 것과
   * 같은 이유다. 남는 이력이 왜 거짓이 아닌지는 서비스의 주석이 적는다.
   *
   * **`order.write` 다.** 배송 표와 (마지막 단계에서는) 주문 상태를 옮기는 요청이라
   * 발송·배송완료와 같은 문 앞에 선다. 자기 스토어인지는 서비스가 보고, 관리자는
   * 주체가 `ADMIN` 으로 남는다.
   */
  @Post('seller-orders/:id/shipment/advance')
  @RequirePermission('order.write')
  advance(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<ShipmentResponse> {
    return this.simulator.advance(principal, id)
  }
}
