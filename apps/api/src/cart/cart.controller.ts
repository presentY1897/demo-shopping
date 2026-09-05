import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import type { CartResponse } from '@shopping/shared'
import {
  addCartItemRequestSchema,
  mergeCartRequestSchema,
  removeCartItemsRequestSchema,
  updateCartItemRequestSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CartService } from './cart.service.js'

/**
 * 장바구니 (TASK-0045).
 *
 * **어떤 라우트에도 사용자 id 가 없다** (4.3). `/me` 와 같은 모양이고, 그것이
 * 지름길이 아니라 설계다 — 남을 가리킬 자리가 없으면 「남의 장바구니를 봤다」가
 * 표현 불가능해진다. 소유자는 토큰이 정하고, 서비스의 스코프 검사가 두 번째
 * 방어선이다.
 *
 * `cart.*` 는 `order.*` 와 다른 퍼미션이다 (4.2). 운영자가 `order.read` 를 `any`
 * 로 갖고 있어서, 재사용했다면 그것이 곧 「아무의 장바구니나 읽는다」가 된다.
 */
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @RequirePermission('cart.read')
  get(@Principal() principal: RequestPrincipal): Promise<CartResponse> {
    return this.cart.get(principal)
  }

  /** 담기. 같은 Variant 면 수량이 합산된다 (F1). */
  @Post('items')
  @RequirePermission('cart.write')
  add(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<CartResponse> {
    return this.cart.add(principal, parseInput(addCartItemRequestSchema, body))
  }

  /**
   * 수량 대입. 담기와 **다른 동사**이므로 다른 라우트다 — 하나로 합치고 플래그로
   * 가르면 그 플래그를 잘못 보내는 날 수량이 두 배가 된다.
   */
  @Patch('items/:id')
  @RequirePermission('cart.write')
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CartResponse> {
    return this.cart.update(principal, id, parseInput(updateCartItemRequestSchema, body))
  }

  /**
   * 선택 삭제. 하나를 지우는 것도 이쪽이다.
   *
   * `DELETE /items/:id` 를 따로 두면 화면이 「선택한 셋」을 지울 때 요청을 셋
   * 보내게 되고, 그중 둘만 성공한 상태가 생긴다.
   */
  @Post('items/remove')
  @RequirePermission('cart.write')
  remove(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<CartResponse> {
    return this.cart.remove(principal, parseInput(removeCartItemsRequestSchema, body))
  }

  /** 비로그인 장바구니를 합친다 (F6). 거절하지 않는다 — 서비스의 주석 참조. */
  @Post('merge')
  @RequirePermission('cart.write')
  merge(@Principal() principal: RequestPrincipal, @Body() body: unknown): Promise<CartResponse> {
    return this.cart.merge(principal, parseInput(mergeCartRequestSchema, body))
  }
}
