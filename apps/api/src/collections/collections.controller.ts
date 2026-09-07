import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import type {
  FollowListResponse,
  FollowResult,
  RecentlyViewedResponse,
  ToggleResult,
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

  /** 내 찜 목록 (F3 · F4 · F5). */
  @Get('me/wishlist')
  @RequirePermission('collection.write')
  wishlist(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<WishlistResponse> {
    return this.collections.wishlist(principal.userId, parseInput(wishlistQueryParamsSchema, query))
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
}
