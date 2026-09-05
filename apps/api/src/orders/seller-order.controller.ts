import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import type { SellerOrderActionsResponse, SellerOrderTransitionResponse } from '@shopping/shared'
import { sellerOrderTransitionRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerOrderService } from './seller-order.service.js'

/**
 * 판매자 몫의 상태를 옮기는 두 라우트 (TASK-0059).
 *
 * **판매자 전용이 아니다.** 발송은 판매자가, 구매확정은 구매자가, 클레임의 결론은
 * 관리자가 일으킨다 — 셋이 같은 문을 지나는 것이 이 TASK 의 요점이라 라우트도 하나다.
 * 누가 무엇을 할 수 있는지는 상태 머신이 답하고, 요청한 사람이 그 주문의 **무엇인지**는
 * 서비스가 확인해서 정한다(요청이 주장하지 않는다).
 *
 * `GET /seller-orders/:id` 는 `OrderController` 에 그대로 있다. 그쪽은 「이 몫이
 * 무엇인가」이고 여기는 「이 몫에 무엇을 할 수 있는가」다.
 */
@Controller({ version: '1' })
export class SellerOrderController {
  constructor(private readonly sellerOrders: SellerOrderService) {}

  /**
   * 다음 상태로 옮긴다 (F1 · F2 · F3 · F4).
   *
   * 멱등이다. 이미 그 상태면 성공으로 답하고 `changed: false` 를 싣는다 — 재시도한
   * 화면에 오류를 보이는 것은, 그 사람이 원한 결과가 이미 이뤄져 있는데 실패했다고
   * 말하는 것이다.
   */
  @Post('seller-orders/:id/transitions')
  @RequirePermission('order.write')
  transition(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerOrderTransitionResponse> {
    return this.sellerOrders.transition(
      principal,
      id,
      parseInput(sellerOrderTransitionRequestSchema, body),
    )
  }

  /**
   * 지금 이 사람이 할 수 있는 전이 목록 (F7).
   *
   * **읽기가 아니라 `order.write` 를 요구한다.** 답이 「무엇을 볼 수 있나」가 아니라
   * 「무엇을 누를 수 있나」이기 때문이다 — 누를 수 없는 사람에게 버튼 목록을 주면 그
   * 목록이 거짓말이 되고, 화면은 그것을 그대로 그린다.
   */
  @Get('seller-orders/:id/actions')
  @RequirePermission('order.write')
  actions(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SellerOrderActionsResponse> {
    return this.sellerOrders.actions(principal, id)
  }
}
