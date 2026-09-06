import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import type { ReviewResponse, ReviewableListResponse } from '@shopping/shared'
import {
  createReviewRequestSchema,
  reviewableListQueryParamsSchema,
  updateReviewRequestSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ReviewService } from './review.service.js'

const reviewIdSchema = z.uuid()

/**
 * 리뷰 (TASK-0083).
 *
 * ## 읽기에 퍼미션이 없다
 *
 * **리뷰는 로그인하지 않은 사람도 읽는다** — 상품 상세의 일부이고, 퍼미션으로 가리면
 * 그 화면이 로그인 벽 뒤로 들어간다. 쓰기만 `review.write` 이고 그 스코프는 언제나
 * `own` 이다: 이 문은 남의 리뷰를 만들 방법을 갖고 있지 않다.
 *
 * ## 라우트 순서
 *
 * `me/reviewable-items` 는 `reviews/:id` 와 마디가 달라 부딪히지 않는다.
 */
@Controller({ version: '1' })
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  /**
   * 아직 리뷰를 쓸 수 있는 주문 항목 (F7).
   *
   * `order.read` 가 아니라 `review.write` 인 것은 이 목록이 **리뷰를 쓰기 위한
   * 것**이기 때문이다 — 주문을 읽는 화면은 자기 라우트를 이미 갖고 있고, 여기에
   * 담기는 것은 「쓸 수 있는 것」뿐이라 그 판정이 곧 이 목록의 정의다.
   */
  @Get('me/reviewable-items')
  @RequirePermission('review.write')
  reviewable(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<ReviewableListResponse> {
    return this.reviews.reviewable(
      principal.userId,
      parseInput(reviewableListQueryParamsSchema, query),
    )
  }

  /** 산 것에 리뷰를 쓴다. **가리키는 것은 상품이 아니라 주문 항목이다.** */
  @Post('reviews')
  @RequirePermission('review.write')
  async create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ReviewResponse> {
    const request = parseInput(createReviewRequestSchema, body)

    return { review: await this.reviews.create(principal.userId, request) }
  }

  /** 한 벌 읽기. 상품 상세가 리뷰 하나를 펼칠 때와 수정 화면이 읽을 때 같은 문이다. */
  @Get('reviews/:id')
  @PublicEndpoint()
  detail(@Param('id') id: string): Promise<ReviewResponse> {
    return this.reviews.detail(parseInput(reviewIdSchema, id, 'id')).then((review) => ({ review }))
  }

  /** 기한 안에서 고친다 (F5). */
  @Patch('reviews/:id')
  @RequirePermission('review.write')
  async update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReviewResponse> {
    const reviewId = parseInput(reviewIdSchema, id, 'id')
    const request = parseInput(updateReviewRequestSchema, body)

    return { review: await this.reviews.update(principal.userId, reviewId, request) }
  }

  /** 지운다. **행은 남는다** — 다시 쓸 수 없고, 신고가 가리키던 자리도 남는다. */
  @Delete('reviews/:id')
  @RequirePermission('review.write')
  @HttpCode(204)
  remove(@Principal() principal: RequestPrincipal, @Param('id') id: string): Promise<void> {
    return this.reviews.remove(principal.userId, parseInput(reviewIdSchema, id, 'id'))
  }
}
