import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  ReviewReply,
  SellerProductReview,
  SellerProductReviewsQueryParams,
  SellerProductReviewsResponse,
} from '@shopping/shared'
import { SELLER_PRODUCT_REVIEWS_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { maskAuthorName } from './review-rules.js'

interface ConsoleRow {
  readonly id: string
  readonly productId: string
  readonly productName: string
  readonly rating: number
  readonly content: string
  readonly authorName: string
  readonly optionLabel: string | null
  readonly imageKeys: readonly string[]
  readonly replyContent: string | null
  readonly replyCreatedAt: Date | null
  readonly replyUpdatedAt: Date | null
  readonly brandName: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * 판매자의 리뷰 답변 (TASK-0085).
 *
 * ## 소유권은 리뷰가 아니라 **상품**이 정한다
 *
 * 리뷰는 산 사람의 것이지만 답변할 자격은 **판 사람**의 것이고, 그 둘을 잇는 것이
 * 상품이다. 그래서 아래는 리뷰에서 상품으로, 상품에서 스토어로 올라가 그 스토어에
 * 대한 접근을 묻는다 — 리뷰의 `userId` 는 여기서 한 번도 읽지 않는다.
 *
 * ## 두 번째 답변이 저장될 자리가 없다
 *
 * `ReviewReply` 의 기본키가 `reviewId` 라, 「두 번 쓰면 400」과 「두 번 쓰면 수정」
 * 중 무엇을 고르든 그 판단이 애플리케이션에만 있으면 우회 경로가 생기는 날 뚫린다.
 * 이 서비스는 **덮어쓰기**를 고른다 (F3) — 판매자 응대는 개선이 목적이지 기록
 * 보존이 목적이 아니다 (4장).
 */
@Injectable()
export class ReviewReplyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 답변을 쓰거나 고친다 (F1 · F2 · F3). */
  async write(
    principal: RequestPrincipal,
    reviewId: string,
    content: string,
  ): Promise<ReviewReply> {
    const seller = await this.sellerOf(principal, reviewId)
    const now = this.clock.now()
    const saved = await this.prisma.reviewReply.upsert({
      where: { reviewId },
      create: {
        reviewId,
        sellerId: seller.id,
        authorId: principal.userId,
        content,
        createdAt: now,
        updatedAt: now,
      },
      update: { content, authorId: principal.userId, updatedAt: now },
      select: { reviewId: true, content: true, createdAt: true, updatedAt: true },
    })

    return { ...saved, brandName: seller.brandName, ...toIso(saved) }
  }

  /** 지운다. 답변이 없던 리뷰를 지우면 **없다**고 답한다. */
  async remove(principal: RequestPrincipal, reviewId: string): Promise<void> {
    await this.sellerOf(principal, reviewId)

    const removed = await this.prisma.reviewReply.deleteMany({ where: { reviewId } })

    if (removed.count === 0) throw new NotFoundException('답변을 찾을 수 없어요.')
  }

  /**
   * 이 스토어의 상품에 달린 리뷰들 (F5 · F6 · F7).
   *
   * **미답변이 먼저다.** 정렬 축이 「답변 여부, id」 두 칸이고, 그 첫 칸이 이 화면의
   * 목적 그 자체다 — 판매자가 여기 오는 이유는 답할 것을 찾기 위해서다.
   */
  async list(
    principal: RequestPrincipal,
    sellerId: string,
    params: SellerProductReviewsQueryParams,
  ): Promise<SellerProductReviewsResponse> {
    await this.assertStore(principal, sellerId)

    const limit = params.limit ?? SELLER_PRODUCT_REVIEWS_DEFAULT_LIMIT
    const [rows, unansweredCount] = await Promise.all([
      this.page(sellerId, params, limit),
      this.prisma.review.count({
        where: {
          status: 'PUBLISHED',
          reply: null,
          product: { sellerId },
        },
      }),
    ])
    const page = rows.slice(0, limit)

    return {
      reviews: page.map((row) => toConsoleReview(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      unansweredCount,
    }
  }

  private async page(
    sellerId: string,
    params: SellerProductReviewsQueryParams,
    limit: number,
  ): Promise<readonly ConsoleRow[]> {
    return this.prisma.$queryRaw<ConsoleRow[]>`
      SELECT r."id"::text        AS "id",
             r."productId"::text AS "productId",
             p."name"            AS "productName",
             r."rating"          AS "rating",
             r."content"         AS "content",
             u."name"            AS "authorName",
             (oi."productSnapshot" ->> 'optionLabel') AS "optionLabel",
             COALESCE(
               ARRAY(
                 SELECT ri."key" FROM "ReviewImage" ri
                  WHERE ri."reviewId" = r."id" ORDER BY ri."position"),
               '{}')             AS "imageKeys",
             rr."content"        AS "replyContent",
             rr."createdAt"      AS "replyCreatedAt",
             rr."updatedAt"      AS "replyUpdatedAt",
             s."brandName"       AS "brandName",
             r."createdAt"       AS "createdAt",
             r."updatedAt"       AS "updatedAt"
        FROM "Review" r
        JOIN "Product" p        ON p."id" = r."productId"
        JOIN "Seller" s         ON s."id" = p."sellerId"
        JOIN "User" u           ON u."id" = r."userId"
        JOIN "OrderItem" oi     ON oi."id" = r."orderItemId"
        LEFT JOIN "ReviewReply" rr ON rr."reviewId" = r."id"
       WHERE p."sellerId" = ${sellerId}::uuid
         AND r."status" = 'PUBLISHED'
         AND (NOT ${params.unansweredOnly === true} OR rr."reviewId" IS NULL)
         AND (${params.maxRating ?? null}::int IS NULL OR r."rating" <= ${params.maxRating ?? null}::int)
         AND (${params.cursor ?? null}::uuid IS NULL OR r."id" < ${params.cursor ?? null}::uuid)
       ORDER BY (rr."reviewId" IS NOT NULL), r."id" DESC
       LIMIT ${limit + 1}`
  }

  /**
   * 이 리뷰의 상품을 파는 스토어. **답할 자격이 있는지도 여기서 판정한다.**
   *
   * 남의 상품 리뷰에 답하려는 요청은 403 이다 — 404 로 답하지 않는 이유는 리뷰가
   * **공개**이기 때문이다. 존재를 숨길 것이 없는 자리에서 404 를 주면 판매자에게
   * 「그런 리뷰가 없다」는 거짓말을 하게 된다.
   */
  private async sellerOf(
    principal: RequestPrincipal,
    reviewId: string,
  ): Promise<{ id: string; brandName: string }> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        status: true,
        product: { select: { seller: { select: { ...sellerOwnershipSelect, brandName: true } } } },
      },
    })

    if (review?.status !== 'PUBLISHED') throw new NotFoundException('리뷰를 찾을 수 없어요.')

    const seller = review.product.seller

    assertResourceAccess(principal, 'review.reply', sellerOwnership(seller))

    return { id: seller.id, brandName: seller.brandName }
  }

  private async assertStore(principal: RequestPrincipal, sellerId: string): Promise<void> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    assertResourceAccess(principal, 'review.reply', sellerOwnership(seller))
  }
}

function toIso(reply: { createdAt: Date; updatedAt: Date }): {
  createdAt: string
  updatedAt: string
} {
  return { createdAt: reply.createdAt.toISOString(), updatedAt: reply.updatedAt.toISOString() }
}

function toConsoleReview(row: ConsoleRow): SellerProductReview {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    rating: row.rating,
    content: row.content,
    status: 'PUBLISHED',
    authorName: maskAuthorName(row.authorName),
    optionLabel: row.optionLabel,
    imageKeys: [...row.imageKeys],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reply:
      row.replyContent === null || row.replyCreatedAt === null || row.replyUpdatedAt === null
        ? null
        : {
            reviewId: row.id,
            brandName: row.brandName,
            content: row.replyContent,
            createdAt: row.replyCreatedAt.toISOString(),
            updatedAt: row.replyUpdatedAt.toISOString(),
          },
  }
}
