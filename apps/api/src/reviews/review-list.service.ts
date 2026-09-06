import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  RatingSummary,
  ReviewHelpfulResponse,
  ReviewListEntry,
  ReviewListQueryParams,
  ReviewListResponse,
  ReviewSortKey,
} from '@shopping/shared'
import { REVIEW_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { PrismaService } from '../prisma/prisma.service.js'
import { maskAuthorName } from './review-rules.js'
import type { ReviewCursor } from './review-console.js'
import {
  decodeReviewCursor,
  encodeReviewCursor,
  rankOf,
  ratingAverage,
  ratingDistribution,
} from './review-console.js'

interface ListRow {
  readonly id: string
  readonly productId: string
  readonly rating: number
  readonly content: string
  readonly helpfulCount: number
  readonly authorName: string
  readonly optionLabel: string | null
  readonly imageKeys: readonly string[]
  readonly helpfulByMe: boolean
  readonly replyContent: string | null
  readonly replyCreatedAt: Date | null
  readonly replyUpdatedAt: Date | null
  readonly brandName: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** 축마다 SQL 이 다르다. 표로 두면 정렬과 커서가 한 곳에서 짝을 이룬다. */
const ORDER_BY: Readonly<Record<ReviewSortKey, Prisma.Sql>> = {
  latest: Prisma.sql`r."id" DESC`,
  rating: Prisma.sql`r."rating" DESC, r."id" DESC`,
  helpful: Prisma.sql`r."helpfulCount" DESC, r."id" DESC`,
}

/**
 * 상품의 리뷰 목록과 평점 (TASK-0084).
 *
 * ## 요약이 목록과 함께 온다
 *
 * 나눠 받으면 필터를 바꿀 때마다 분포가 함께 흔들리는데, **분포는 필터와 무관한
 * 사실**이다. 「사진 리뷰만」을 켜도 이 상품의 별점 분포는 그대로여야 한다.
 *
 * ## 집계는 조회할 때 하지 않는다
 *
 * `Product.ratingAvg` 는 리뷰가 바뀔 때 다시 센다 (TASK-0084 4장). 조회할 때마다
 * 세면 상품 **목록**에서 N+1 이 되고, 그것이 F7 이 재는 것이다. 여기서 세는 분포는
 * 상품 **하나**의 상세를 열 때뿐이다.
 */
@Injectable()
export class ReviewListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    productId: string,
    params: ReviewListQueryParams,
    viewerId: string | null,
  ): Promise<ReviewListResponse> {
    const sort = params.sort ?? 'latest'
    const limit = params.limit ?? REVIEW_LIST_DEFAULT_LIMIT
    const cursor = this.cursorOf(params.cursor)
    const rows = await this.page(
      productId,
      sort,
      params.photoOnly === true,
      cursor,
      viewerId,
      limit,
    )
    const page = rows.slice(0, limit)
    const last = page.at(-1)

    return {
      reviews: page.map((row) => toEntry(row)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeReviewCursor({ rank: rankOf(sort, last), id: last.id })
          : null,
      summary: await this.summary(productId),
    }
  }

  /**
   * 「도움이 됐다」를 누른다 (F1 의 세 번째 축이 읽는 값).
   *
   * **두 번 눌러도 한 번이다.** 복합 기본키가 그것을 만들고, 세는 값은 그 결과에서
   * 온다 — 「눌렀으면 +1」을 코드가 판단하면 두 번 누른 요청이 두 번 세어진다.
   */
  async vote(userId: string, reviewId: string): Promise<ReviewHelpfulResponse> {
    await this.assertVisible(reviewId)

    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "ReviewHelpful" ("reviewId", "userId")
        VALUES (${reviewId}::uuid, ${userId}::uuid)
        ON CONFLICT DO NOTHING`

      // **센 수를 그 결과에서 얻는다.** 조건부 삽입이 0줄을 넣었으면 이미 누른
      // 것이고, 그때 세는 값을 올리면 한 사람이 여러 번 세어진다.
      if (inserted > 0) {
        await tx.review.update({
          where: { id: reviewId },
          data: { helpfulCount: { increment: 1 } },
        })
      }

      return this.state(tx, reviewId, userId)
    })
  }

  /** 누른 것을 무른다. 없던 것을 무르면 아무 일도 일어나지 않는다. */
  async unvote(userId: string, reviewId: string): Promise<ReviewHelpfulResponse> {
    await this.assertVisible(reviewId)

    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.reviewHelpful.deleteMany({ where: { reviewId, userId } })

      if (removed.count > 0) {
        await tx.review.update({
          where: { id: reviewId },
          data: { helpfulCount: { decrement: 1 } },
        })
      }

      return this.state(tx, reviewId, userId)
    })
  }

  private async state(
    tx: Prisma.TransactionClient,
    reviewId: string,
    userId: string,
  ): Promise<ReviewHelpfulResponse> {
    const [review, mine] = await Promise.all([
      tx.review.findUniqueOrThrow({ where: { id: reviewId }, select: { helpfulCount: true } }),
      tx.reviewHelpful.findUnique({
        where: { reviewId_userId: { reviewId, userId } },
        select: { userId: true },
      }),
    ])

    return { helpfulCount: review.helpfulCount, helpfulByMe: mine !== null }
  }

  /** 보이는 리뷰인가. 지워졌거나 가려진 리뷰에는 투표할 것이 없다. */
  private async assertVisible(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { status: true },
    })

    if (review?.status !== 'PUBLISHED') {
      throw new NotFoundException('리뷰를 찾을 수 없어요.')
    }
  }

  private cursorOf(value: string | undefined): ReviewCursor | null {
    if (value === undefined) return null

    const cursor = decodeReviewCursor(value)

    // 조용히 첫 페이지로 되돌리지 않는다 — 커서가 깨진 화면이 1페이지를 무한히
    // 반복하고, 그 증상은 아무 오류도 내지 않는다.
    if (cursor === null) throw new BadRequestException('cursor 가 올바르지 않습니다.')

    return cursor
  }

  /**
   * 한 장.
   *
   * `viewerId` 가 `null` 이면 「내가 눌렀는가」는 언제나 거짓이다 — 로그인하지 않은
   * 사람에게 그 질문은 뜻이 없고, 조인 하나를 아낀다.
   */
  private async page(
    productId: string,
    sort: ReviewSortKey,
    photoOnly: boolean,
    cursor: ReviewCursor | null,
    viewerId: string | null,
    limit: number,
  ): Promise<readonly ListRow[]> {
    return this.prisma.$queryRaw<ListRow[]>`
      SELECT r."id"::text        AS "id",
             r."productId"::text AS "productId",
             r."rating"          AS "rating",
             r."content"         AS "content",
             r."helpfulCount"    AS "helpfulCount",
             u."name"            AS "authorName",
             (oi."productSnapshot" ->> 'optionLabel') AS "optionLabel",
             COALESCE(
               ARRAY(
                 SELECT ri."key" FROM "ReviewImage" ri
                  WHERE ri."reviewId" = r."id" ORDER BY ri."position"),
               '{}') AS "imageKeys",
             (${viewerId}::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM "ReviewHelpful" rh
                 WHERE rh."reviewId" = r."id" AND rh."userId" = ${viewerId}::uuid
             )) AS "helpfulByMe",
             rr."content"        AS "replyContent",
             rr."createdAt"      AS "replyCreatedAt",
             rr."updatedAt"      AS "replyUpdatedAt",
             s."brandName"       AS "brandName",
             r."createdAt"       AS "createdAt",
             r."updatedAt"       AS "updatedAt"
        FROM "Review" r
        JOIN "User" u       ON u."id" = r."userId"
        JOIN "OrderItem" oi ON oi."id" = r."orderItemId"
        JOIN "Product" p    ON p."id" = r."productId"
        JOIN "Seller" s     ON s."id" = p."sellerId"
        LEFT JOIN "ReviewReply" rr ON rr."reviewId" = r."id"
       WHERE r."productId" = ${productId}::uuid
         AND r."status" = 'PUBLISHED'
         AND (NOT ${photoOnly} OR EXISTS (
               SELECT 1 FROM "ReviewImage" ri WHERE ri."reviewId" = r."id"))
         AND (
           ${cursor === null}::boolean
           OR (${sortRank(sort)}, r."id") < (${cursor?.rank ?? 0}, ${cursor?.id ?? productId}::uuid)
         )
       ORDER BY ${ORDER_BY[sort]}
       LIMIT ${limit + 1}`
  }

  /**
   * 이 상품의 평점 요약. **필터와 무관하다.**
   *
   * 별점별 개수를 한 번에 세고 나머지는 순수 함수가 만든다 — 평균과 비율의 규칙이
   * SQL 과 코드 두 곳에 있으면 언젠가 서로 다르게 반올림한다.
   */
  private async summary(productId: string): Promise<RatingSummary> {
    const [rows, photoCount] = await Promise.all([
      this.prisma.$queryRaw<{ rating: number; count: number }[]>`
        SELECT "rating", COUNT(*)::int AS "count"
          FROM "Review"
         WHERE "productId" = ${productId}::uuid AND "status" = 'PUBLISHED'
         GROUP BY "rating"`,
      this.prisma.review.count({
        where: { productId, status: 'PUBLISHED', images: { some: {} } },
      }),
    ])
    const counts = Object.fromEntries(rows.map((row) => [row.rating, row.count]))

    return {
      averageTimes100: ratingAverage(counts),
      count: rows.reduce((sum, row) => sum + row.count, 0),
      buckets: [...ratingDistribution(counts)],
      photoCount,
    }
  }
}

/** 정렬 축의 값을 SQL 조각으로. 커서 비교가 `ORDER BY` 와 같은 값을 봐야 한다. */
function sortRank(sort: ReviewSortKey): Prisma.Sql {
  if (sort === 'rating') return Prisma.sql`r."rating"`
  if (sort === 'helpful') return Prisma.sql`r."helpfulCount"`

  return Prisma.sql`0`
}

function toEntry(row: ListRow): ReviewListEntry {
  return {
    id: row.id,
    productId: row.productId,
    rating: row.rating,
    content: row.content,
    status: 'PUBLISHED',
    authorName: maskAuthorName(row.authorName),
    optionLabel: row.optionLabel,
    imageKeys: [...row.imageKeys],
    helpfulCount: row.helpfulCount,
    helpfulByMe: row.helpfulByMe,
    // 답변을 목록과 **함께** 싣는다 (TASK-0085 F4). 따로 받으면 리뷰 한 장마다
    // 요청이 하나씩 늘고, 그것이 바로 N+1 이다.
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
