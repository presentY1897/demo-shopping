import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AnswerResponse,
  CreateQuestionRequest,
  MyQuestionsResponse,
  ProductAnswer,
  ProductQuestion,
  QuestionListQueryParams,
  QuestionListResponse,
  SellerQuestionsQueryParams,
  SellerQuestionsResponse,
} from '@shopping/shared'
import { QUESTION_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { NotificationService } from '../notifications/notification.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { maskAuthorName } from '../reviews/review-rules.js'

interface QuestionRow {
  readonly id: string
  readonly productId: string
  readonly productName: string
  readonly thumbnailUrl: string | null
  readonly authorName: string
  readonly authorId: string
  readonly content: string
  readonly isPublic: boolean
  readonly brandName: string
  readonly answerContent: string | null
  readonly answerCreatedAt: Date | null
  readonly answerUpdatedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * 상품 문의 (TASK-0088).
 *
 * ## 비공개 문의는 **줄 자체가 오지 않는다**
 *
 * 내용을 비우고 보내는 길도 있었지만 그러면 「여기 뭔가 있다」가 새어 나가고, 그
 * 사실만으로도 알아서는 안 될 것을 알게 되는 경우가 있다 — 「이 상품에 비공개 문의가
 * 세 건 있다」는 그 자체로 정보다.
 *
 * 그래서 거르는 자리가 **질의의 `WHERE`** 다 (4장). 화면에서 숨기는 방식은 응답에
 * 이미 실려 나간 것을 가리는 일이라 개발자 도구 하나로 뚫린다.
 *
 * ## 답변은 문의당 하나다
 *
 * 기본키가 `questionId` 라 두 번째 답변이 저장될 자리가 없다 — 리뷰 답변과 같은
 * 판단이다 (`ReviewReply`).
 */
@Injectable()
export class QuestionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: NotificationService,
  ) {}

  /** 문의를 남긴다 (F1). */
  async ask(
    userId: string,
    productId: string,
    request: CreateQuestionRequest,
  ): Promise<ProductQuestion> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { deletedAt: true },
    })

    if (product?.deletedAt !== null) throw new NotFoundException('상품을 찾을 수 없어요.')

    const now = this.clock.now()
    const created = await this.prisma.productQuestion.create({
      data: {
        productId,
        userId,
        content: request.content,
        isPublic: request.isPublic,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    })
    const [row] = await this.rows({ questionId: created.id, viewerId: userId, limit: 1 })

    if (row === undefined) throw new NotFoundException('문의를 찾을 수 없어요.')

    return toQuestion(row, userId)
  }

  /**
   * 이 상품의 문의 (F2 · F6).
   *
   * **남의 비공개 문의는 여기 없다.** 로그인하지 않았으면 공개된 것만, 로그인했으면
   * 공개된 것과 자기 것이다.
   */
  async byProduct(
    productId: string,
    params: QuestionListQueryParams,
    viewerId: string | null,
  ): Promise<QuestionListResponse> {
    const limit = params.limit ?? QUESTION_LIST_DEFAULT_LIMIT
    const rows = await this.rows({
      productId,
      viewerId,
      cursor: params.cursor,
      limit: limit + 1,
      visibleOnly: true,
    })
    const page = rows.slice(0, limit)

    return {
      questions: page.map((row) => toQuestion(row, viewerId)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /** 내가 남긴 문의 (F7). 비공개든 아니든 전부 내 것이다. */
  async mine(userId: string, params: QuestionListQueryParams): Promise<MyQuestionsResponse> {
    const limit = params.limit ?? QUESTION_LIST_DEFAULT_LIMIT
    const rows = await this.rows({
      authorId: userId,
      viewerId: userId,
      cursor: params.cursor,
      limit: limit + 1,
    })
    const page = rows.slice(0, limit)

    return {
      questions: page.map((row) => ({
        ...toQuestion(row, userId),
        productName: row.productName,
        thumbnailUrl: row.thumbnailUrl,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 이 스토어의 상품에 달린 문의 (F5).
   *
   * **판매자는 비공개 문의도 본다.** 자기 상품에 대한 물음이고, 답할 사람이 읽지
   * 못하면 비공개 문의라는 것이 성립하지 않는다.
   */
  async bySeller(
    principal: RequestPrincipal,
    sellerId: string,
    params: SellerQuestionsQueryParams,
  ): Promise<SellerQuestionsResponse> {
    await this.assertStore(principal, sellerId)

    const limit = params.limit ?? QUESTION_LIST_DEFAULT_LIMIT
    const [rows, unansweredCount] = await Promise.all([
      this.rows({
        sellerId,
        viewerId: principal.userId,
        cursor: params.cursor,
        limit: limit + 1,
        unansweredOnly: params.unansweredOnly === true,
        unansweredFirst: true,
      }),
      this.prisma.productQuestion.count({
        where: { answer: null, product: { sellerId } },
      }),
    ])
    const page = rows.slice(0, limit)

    return {
      questions: page.map((row) => ({
        ...toQuestion(row, principal.userId),
        productName: row.productName,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      unansweredCount,
    }
  }

  /** 답한다 — **쓰거나 고친다** (F3). */
  async answer(
    principal: RequestPrincipal,
    questionId: string,
    content: string,
  ): Promise<AnswerResponse> {
    const seller = await this.sellerOf(principal, questionId)
    const asked = await this.prisma.productQuestion.findUniqueOrThrow({
      where: { id: questionId },
      select: { userId: true, productId: true },
    })
    const now = this.clock.now()
    const saved = await this.prisma.productAnswer.upsert({
      where: { questionId },
      create: {
        questionId,
        sellerId: seller.id,
        authorId: principal.userId,
        content,
        createdAt: now,
        updatedAt: now,
      },
      update: { content, authorId: principal.userId, updatedAt: now },
      select: { questionId: true, content: true, createdAt: true, updatedAt: true },
    })

    // 물어본 사람에게 알린다 (TASK-0088 F4 · TASK-0090). 기다리지 않는다.
    void this.notifications.send({
      userId: asked.userId,
      type: 'QUESTION_ANSWER',
      title: '문의에 답변이 달렸어요',
      body: `${seller.brandName} 가 회원님의 문의에 답했어요.`,
      link: `/products/${asked.productId}`,
    })

    return {
      answer: {
        questionId: saved.questionId,
        brandName: seller.brandName,
        content: saved.content,
        createdAt: saved.createdAt.toISOString(),
        updatedAt: saved.updatedAt.toISOString(),
      },
    }
  }

  /** 답변을 지운다. 문의는 남는다. */
  async removeAnswer(principal: RequestPrincipal, questionId: string): Promise<void> {
    await this.sellerOf(principal, questionId)

    const removed = await this.prisma.productAnswer.deleteMany({ where: { questionId } })

    if (removed.count === 0) throw new NotFoundException('답변을 찾을 수 없어요.')
  }

  /**
   * 조회의 한 자리.
   *
   * 축이 넷(상품 · 작성자 · 스토어 · 하나)인데 한 함수인 이유는 **고르는 조건이
   * 같기 때문**이다 — 비공개를 거르는 규칙이 네 곳에 흩어지면 그중 하나가 잊히는
   * 날 남의 비공개 문의가 새어 나간다.
   */
  private async rows(options: {
    productId?: string
    authorId?: string
    sellerId?: string
    questionId?: string
    viewerId: string | null
    cursor?: string
    limit: number
    visibleOnly?: boolean
    unansweredOnly?: boolean
    unansweredFirst?: boolean
  }): Promise<readonly QuestionRow[]> {
    return this.prisma.$queryRaw<QuestionRow[]>`
      SELECT q."id"::text        AS "id",
             q."productId"::text AS "productId",
             p."name"            AS "productName",
             pi."url"            AS "thumbnailUrl",
             u."name"            AS "authorName",
             q."userId"::text    AS "authorId",
             q."content"         AS "content",
             q."isPublic"        AS "isPublic",
             s."brandName"       AS "brandName",
             -- 가려진 답변은 없는 것으로 내려간다 (TASK-0091 F3).
             CASE WHEN a."hiddenAt" IS NULL THEN a."content" END AS "answerContent",
             a."createdAt"       AS "answerCreatedAt",
             a."updatedAt"       AS "answerUpdatedAt",
             q."createdAt"       AS "createdAt",
             q."updatedAt"       AS "updatedAt"
        FROM "ProductQuestion" q
        JOIN "Product" p ON p."id" = q."productId"
        JOIN "Seller" s  ON s."id" = p."sellerId"
        JOIN "User" u    ON u."id" = q."userId"
        LEFT JOIN "ProductAnswer" a ON a."questionId" = q."id"
        LEFT JOIN LATERAL (
          SELECT COALESCE("thumbnailUrl", "url") AS "url" FROM "ProductImage"
           WHERE "productId" = p."id" ORDER BY "sortOrder" LIMIT 1) pi ON TRUE
       WHERE (${options.questionId ?? null}::uuid IS NULL OR q."id" = ${options.questionId ?? null}::uuid)
         AND (${options.productId ?? null}::uuid IS NULL OR q."productId" = ${options.productId ?? null}::uuid)
         AND (${options.authorId ?? null}::uuid IS NULL OR q."userId" = ${options.authorId ?? null}::uuid)
         AND (${options.sellerId ?? null}::uuid IS NULL OR p."sellerId" = ${options.sellerId ?? null}::uuid)
         -- **남의 비공개 문의는 줄 자체가 오지 않는다** (F2).
         AND (
           NOT ${options.visibleOnly ?? false}
           OR q."isPublic"
           OR q."userId" = ${options.viewerId}::uuid
         )
         -- 신고로 가려진 문의도 공개 목록에서 빠진다 (TASK-0091 F3). 쓴 사람에게는
         -- 보인다 — 자기 글이 사라진 것과 가려진 것은 다른 일이고, 뒤엣것은 이의를
         -- 제기할 수 있는 상태다.
         AND (
           NOT ${options.visibleOnly ?? false}
           OR q."hiddenAt" IS NULL
           OR q."userId" = ${options.viewerId}::uuid
         )
         AND (NOT ${options.unansweredOnly ?? false} OR a."questionId" IS NULL)
         AND (${options.cursor ?? null}::uuid IS NULL OR q."id" < ${options.cursor ?? null}::uuid)
       ORDER BY
         CASE WHEN ${options.unansweredFirst ?? false} THEN (a."questionId" IS NOT NULL) END,
         q."id" DESC
       LIMIT ${options.limit}`
  }

  /** 이 문의의 상품을 파는 스토어. **답할 자격이 있는지도 여기서 판정한다.** */
  private async sellerOf(
    principal: RequestPrincipal,
    questionId: string,
  ): Promise<{ id: string; brandName: string }> {
    const question = await this.prisma.productQuestion.findUnique({
      where: { id: questionId },
      select: {
        product: { select: { seller: { select: { ...sellerOwnershipSelect, brandName: true } } } },
      },
    })

    if (question === null) throw new NotFoundException('문의를 찾을 수 없어요.')

    const seller = question.product.seller

    assertResourceAccess(principal, 'question.answer', sellerOwnership(seller))

    return { id: seller.id, brandName: seller.brandName }
  }

  private async assertStore(principal: RequestPrincipal, sellerId: string): Promise<void> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    assertResourceAccess(principal, 'question.answer', sellerOwnership(seller))
  }
}

function toAnswer(row: QuestionRow): ProductAnswer | null {
  if (row.answerContent === null || row.answerCreatedAt === null || row.answerUpdatedAt === null) {
    return null
  }

  return {
    questionId: row.id,
    brandName: row.brandName,
    content: row.answerContent,
    createdAt: row.answerCreatedAt.toISOString(),
    updatedAt: row.answerUpdatedAt.toISOString(),
  }
}

function toQuestion(row: QuestionRow, viewerId: string | null): ProductQuestion {
  return {
    id: row.id,
    productId: row.productId,
    authorName: maskAuthorName(row.authorName),
    content: row.content,
    isPublic: row.isPublic,
    mine: row.authorId === viewerId,
    answer: toAnswer(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
