import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import type {
  FollowIdsResponse,
  FollowListResponse,
  RestockAlertResult,
  FollowResult,
  RecentlyViewedResponse,
  ToggleResult,
  WishlistIdsResponse,
  WishlistResponse,
} from '@shopping/shared'
import {
  followListQueryParamsSchema,
  mergeRecentlyViewedRequestSchema,
  productIdSchema,
  sellerIdSchema,
  wishlistQueryParamsSchema,
} from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { CollectionsService } from './collections.service.js'

/**
 * 찜 · 최근 본 상품 · 팔로우 (TASK-0086 · 0087 · 0089).
 *
 * ## 전부 `own` 이고, 그것이 전부다
 *
 * 이 문들은 남의 목록을 만들 방법을 갖고 있지 않다 — 어느 요청도 사용자 id 를 받지
 * 않고, 주체는 토큰이 정한다. 실어 보내지 않는 값은 조작할 수도 없다.
 *
 * ## 토글이 `POST` 하나인 이유
 *
 * 「담기」와 「빼기」를 나누면 화면이 지금 상태를 알아야 어느 쪽을 부를지 정할 수
 * 있고, 그 상태가 틀렸을 때(다른 탭에서 이미 뺐다) 요청이 실패한다. 토글은 **지금
 * 상태를 돌려주므로** 두 번 눌려도 답이 사실이다.
 */
@Controller({ version: '1' })
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  /** 찜을 켜고 끈다 (TASK-0086 F1). */
  @Post('me/wishlist/:productId')
  @RequirePermission('collection.write')
  toggleWishlist(
    @Principal() principal: RequestPrincipal,
    @Param('productId') productId: string,
  ): Promise<ToggleResult> {
    return this.collections.toggleWishlist(
      principal.userId,
      parseInput(productIdSchema, productId, 'productId'),
    )
  }

  /**
   * 재입고 알림 신청을 켜고 끈다 (F4).
   *
   * `DELETE` 가 끄고 `POST` 가 켠다 — 토글이 아닌 이유는 이 버튼이 **품절 화면에만**
   * 있고, 그 화면에서 사람이 하려는 일은 언제나 「켜기」이기 때문이다. 끄는 것은
   * 찜 목록에서 한다.
   */
  @Post('me/wishlist/:productId/restock-alert')
  @RequirePermission('collection.write')
  requestRestockAlert(
    @Principal() principal: RequestPrincipal,
    @Param('productId') productId: string,
  ): Promise<RestockAlertResult> {
    return this.collections.setRestockAlert(
      principal.userId,
      parseInput(productIdSchema, productId, 'productId'),
      true,
    )
  }

  @Delete('me/wishlist/:productId/restock-alert')
  @RequirePermission('collection.write')
  cancelRestockAlert(
    @Principal() principal: RequestPrincipal,
    @Param('productId') productId: string,
  ): Promise<RestockAlertResult> {
    return this.collections.setRestockAlert(
      principal.userId,
      parseInput(productIdSchema, productId, 'productId'),
      false,
    )
  }

  /** 내 찜 목록 (F3 · F4 · F5). */
  @Get('me/wishlist')
  @RequirePermission('collection.write')
  wishlist(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<WishlistResponse> {
    return this.collections.wishlist(principal.userId, parseInput(wishlistQueryParamsSchema, query))
  }

  /**
   * 찜한 상품의 id 만, 전부 (F1).
   *
   * 화면 한 장에 하트가 스무 개 있고 그 스무 개가 각자 자기 상태를 알아야 한다.
   * 목록으로 그것을 하면 101개를 담은 사람의 하트가 조용히 빈 채로 그려진다 —
   * `wishlistIdsResponseSchema` 에 왜 페이지가 없는지 적어 두었다.
   *
   * `me/wishlist/:productId` 는 `POST` 뿐이라 `ids` 가 상품 id 로 읽힐 자리는
   * 없지만, 그래도 목록 바로 뒤에 둔다 — 나중에 그 자리에 `GET` 이 생기면 순서가
   * 곧 답이 된다.
   */
  @Get('me/wishlist/ids')
  @RequirePermission('collection.write')
  wishlistIds(@Principal() principal: RequestPrincipal): Promise<WishlistIdsResponse> {
    return this.collections.wishlistIds(principal.userId)
  }

  /** 최근 본 상품 (TASK-0087). */
  @Get('me/recently-viewed')
  @RequirePermission('collection.write')
  recentlyViewed(@Principal() principal: RequestPrincipal): Promise<RecentlyViewedResponse> {
    return this.collections.recentlyViewed(principal.userId)
  }

  /**
   * 비로그인 이력을 합친다 (F6).
   *
   * **더 최근 쪽이 이긴다.** 브라우저에 남아 있던 옛 기록이 방금 본 것을 뒤로 밀면
   * 안 된다.
   */
  @Post('me/recently-viewed')
  @RequirePermission('collection.write')
  merge(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<RecentlyViewedResponse> {
    return this.collections.mergeRecentlyViewed(
      principal.userId,
      parseInput(mergeRecentlyViewedRequestSchema, body),
    )
  }

  /** 하나를 지운다 (F7). */
  @Delete('me/recently-viewed/:productId')
  @RequirePermission('collection.write')
  @HttpCode(204)
  forgetView(
    @Principal() principal: RequestPrincipal,
    @Param('productId') productId: string,
  ): Promise<void> {
    return this.collections.forgetView(
      principal.userId,
      parseInput(productIdSchema, productId, 'productId'),
    )
  }

  /** 전부 지운다 (F7). */
  @Delete('me/recently-viewed')
  @RequirePermission('collection.write')
  @HttpCode(204)
  forgetAllViews(@Principal() principal: RequestPrincipal): Promise<void> {
    return this.collections.forgetAllViews(principal.userId)
  }

  /** 팔로우를 켜고 끈다 (TASK-0089 F1 · F2 · F3). */
  @Post('me/follows/:sellerId')
  @RequirePermission('collection.write')
  toggleFollow(
    @Principal() principal: RequestPrincipal,
    @Param('sellerId') sellerId: string,
  ): Promise<FollowResult> {
    return this.collections.toggleFollow(
      principal.userId,
      parseInput(sellerIdSchema, sellerId, 'sellerId'),
    )
  }

  /** 내가 팔로우한 브랜드. */
  @Get('me/follows')
  @RequirePermission('collection.write')
  follows(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<FollowListResponse> {
    return this.collections.follows(
      principal.userId,
      parseInput(followListQueryParamsSchema, query),
    )
  }

  /**
   * 팔로우한 가게의 id 만, 전부 (F1 · F6).
   *
   * 홈의 「팔로우한 브랜드의 신상품」 줄이 이것으로 시작한다: 여기서 받은 id 들을
   * 검색에 그대로 넘긴다 (`searchQuerySchema.sellerIds`). 홈 전용 엔드포인트를
   * 만들지 않기로 한 판단(`pages.md`)이 이 문을 이 모양으로 만들었다 — 이 문은
   * 「무엇을 팔로우했나」만 답하고, 「그 가게들의 신상품」은 검색이 답한다.
   */
  @Get('me/follows/ids')
  @RequirePermission('collection.write')
  followIds(@Principal() principal: RequestPrincipal): Promise<FollowIdsResponse> {
    return this.collections.followIds(principal.userId)
  }
}
