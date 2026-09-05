import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import type {
  CheckoutResponse,
  OrderListResponse,
  OrderResponse,
  SellerOrderListResponse,
  SellerOrderResponse,
  SellerOrderSummaryResponse,
} from '@shopping/shared'
import {
  createCheckoutRequestSchema,
  createOrderRequestSchema,
  orderListQueryParamsSchema,
  sellerOrderListQueryParamsSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CheckoutService } from './checkout.service.js'
import { OrderService } from './order.service.js'
import { SellerOrderListService } from './seller-order-list.service.js'

/**
 * 주문 (TASK-0049).
 *
 * 라우트가 둘로 갈린다. `/orders` 는 **산 사람의 것**이고 `/seller-orders` 는 **판
 * 사람의 것**이다. 하나로 두고 역할에 따라 걸러 주지 않는 이유는 응답의 모양이 다르기
 * 때문이다 — 주문 단위 합계에는 남의 몫이 섞여 있으므로 판매자에게 그대로 줄 수 없고,
 * 다시 계산해서 주면 그 숫자는 아무 데도 저장된 적이 없는 값이 된다.
 *
 * 쿠폰·적립금은 아직 받지 않는다 (4.2). 서비스는 할인 목록을 인자로 받게 되어 있고
 * 여기서 넘기지 않을 뿐이다 — M11 이 그 목록을 계산해 채운다.
 */
@Controller({ version: '1' })
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly checkouts: CheckoutService,
    private readonly sellerOrderList: SellerOrderListService,
  ) {}

  /**
   * 주문서를 연다 — 즉 재고를 잡는다 (TASK-0050 4.1).
   *
   * 부르는 것은 **장바구니의 「주문하기」**다. 주문서 화면이 진입과 동시에 부르면
   * 새로고침 한 번에 예약이 한 벌 더 잡힌다.
   */
  @Post('checkouts')
  @RequirePermission('order.write')
  openCheckout(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<CheckoutResponse> {
    return this.checkouts.open(principal, parseInput(createCheckoutRequestSchema, body))
  }

  /** 열려 있는 주문서. 만료됐거나 풀렸으면 없는 것으로 답한다. */
  @Get('checkouts/:id')
  @RequirePermission('order.read')
  readCheckout(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<CheckoutResponse> {
    return this.checkouts.read(principal, id)
  }

  /**
   * 이탈. 이 시도의 예약 전부를 푼다.
   *
   * 화면은 `sendBeacon` 으로 부른다 — 페이지가 사라지는 중에 보내는 `fetch` 는
   * 브라우저가 취소한다. 그래도 강제 종료에는 신호가 없고, 그때의 안전망은 만료
   * 스케줄러(TASK-0051)다.
   */
  @Delete('checkouts/:id')
  @RequirePermission('order.write')
  closeCheckout(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<{ released: number }> {
    return this.checkouts.close(principal, id)
  }

  /** 주문서 생성. 장바구니에서 고른 줄로 만든다. */
  @Post('orders')
  @RequirePermission('order.write')
  create(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<OrderResponse> {
    return this.orders.create(principal, parseInput(createOrderRequestSchema, body))
  }

  /** 내 주문 목록. 최신순, 커서 페이지네이션. */
  @Get('orders')
  @RequirePermission('order.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<OrderListResponse> {
    return this.orders.list(principal, parseInput(orderListQueryParamsSchema, query))
  }

  /** 주문 하나. 산 사람과 운영자가 읽는다. */
  @Get('orders/:id')
  @RequirePermission('order.read')
  get(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<OrderResponse> {
    return this.orders.get(principal, id)
  }

  /**
   * 판매자 콘솔의 주문 목록 (TASK-0060 1장). 상태·기간·검색·커서.
   *
   * 산 사람의 `/orders` 와 라우트를 나누는 이유는 그쪽 주석이 말하는 것과 같다 —
   * 응답의 모양이 다르다. 여기서 한 줄은 **한 판매자의 몫**이고, 주문 단위 합계는
   * 남의 몫이 섞여 있어 실을 수 없다.
   */
  @Get('seller-orders')
  @RequirePermission('order.read')
  sellerOrders(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<SellerOrderListResponse> {
    return this.sellerOrderList.list(principal, parseInput(sellerOrderListQueryParamsSchema, query))
  }

  /**
   * 상태별 건수 — 뱃지와 탭이 읽는다 (TASK-0060 2장).
   *
   * **`seller-orders/:id` 보다 위에 있어야 한다.** 라우터는 먼저 선언된 것을 쓰므로
   * 아래에 두면 `summary` 가 id 로 읽히고, 그 id 는 uuid 가 아니라 조회가 500 으로
   * 끝난다. 두 라우트를 굳이 같은 컨트롤러에 둔 이유도 그것이다 — 컨트롤러가 다르면
   * 순서를 정하는 것이 모듈 스캔 순서가 되고, 그것은 이 파일을 읽어서는 알 수 없다.
   */
  @Get('seller-orders/summary')
  @RequirePermission('order.read')
  sellerOrderSummary(
    @Principal() principal: RequestPrincipal,
  ): Promise<SellerOrderSummaryResponse> {
    return this.sellerOrderList.summary(principal)
  }

  /** 판매자가 읽는 자기 몫 하나 (F6). 남의 몫이면 403 이다. */
  @Get('seller-orders/:id')
  @RequirePermission('order.read')
  sellerOrder(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SellerOrderResponse> {
    return this.orders.sellerOrder(principal, id)
  }
}
