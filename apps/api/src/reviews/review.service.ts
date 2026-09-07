import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  CreateReviewRequest,
  DomainErrorCode,
  OrderStatus,
  Review,
  ReviewableItem,
  ReviewableListQueryParams,
  ReviewableListResponse,
  UpdateReviewRequest,
} from '@shopping/shared'
import { REVIEWABLE_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SearchOutboxService } from '../search/search-outbox.service.js'
import { ratingAverage } from './review-console.js'
import { ReviewImageUrls } from './review-images.js'
import type { ReviewImageRefusal, ReviewRefusal } from './review-rules.js'
import {
  editable,
  maskAuthorName,
  REVIEW_WRITE_WINDOW_DAYS,
  reviewDecision,
  reviewImageDecision,
} from './review-rules.js'

const DAY_MS = 24 * 60 * 60 * 1_000

/** 주문 항목 하나에 대해 리뷰가 알아야 하는 사실 전부 — 한 번의 조회로. */
interface SubjectRow {
  readonly orderItemId: string
  readonly productId: string
  readonly buyerId: string
  /**
   * `::text` 로 받아 곧바로 `OrderStatus` 로 받는다.
   *
   * 열거형 값을 문자열로 받아 좁히는 검사를 두지 않는 이유는 **그 갈래에 닿을 수
   * 없기** 때문이다 — 이 값은 DB 의 열거형 컬럼이고, 그 열거형의 정의가 곧 이 타입의
   * 정의다. 닿을 수 없는 방어는 커버리지에 구멍으로 남는다.
   */
  readonly status: OrderStatus
  readonly deliveredAt: Date | null
  readonly reviewed: boolean
  readonly optionLabel: string | null
}

const REVIEW_SELECT = {
  id: true,
  productId: true,
  orderItemId: true,
  userId: true,
  rating: true,
  content: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true } },
  orderItem: { select: { productSnapshot: true } },
  images: { select: { key: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.ReviewSelect

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>

/** 주문 시점의 스냅샷에서 옵션 이름만. 지금의 조합 이름이 아니라 **산 것의 이름**이다. */
function optionLabelOf(snapshot: Prisma.JsonValue): string | null {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null

  const label = (snapshot as Record<string, unknown>).optionLabel

  return typeof label === 'string' ? label : null
}

/**
 * 거절 코드와 그 뜻.
 *
 * 표로 두는 이유는 **넷을 나눈 값이 여기서 살아나기** 때문이다. 서비스가 `if` 로
 * 문장을 골라 쓰면 한 갈래를 빠뜨렸을 때 그 사람만 다른 말을 듣는다.
 */
const REVIEW_REFUSAL: Readonly<Record<ReviewRefusal, { code: DomainErrorCode; message: string }>> =
  {
    not_delivered: {
      code: 'REVIEW_NOT_DELIVERED',
      message: '배송이 끝난 뒤에 리뷰를 쓸 수 있어요.',
    },
    already_reviewed: {
      code: 'REVIEW_ALREADY_WRITTEN',
      message: '이미 리뷰를 쓴 주문이에요.',
    },
    window_closed: {
      code: 'REVIEW_WINDOW_CLOSED',
      message: '리뷰를 쓸 수 있는 기간이 지났어요.',
    },
    canceled: {
      code: 'REVIEW_ORDER_CANCELED',
      message: '취소되거나 반품된 주문에는 리뷰를 쓸 수 없어요.',
    },
  }

const IMAGE_REFUSAL: Readonly<
  Record<ReviewImageRefusal, { code: DomainErrorCode; message: string }>
> = {
  too_many: { code: 'REVIEW_IMAGE_TOO_MANY', message: '사진이 너무 많아요.' },
  duplicate: { code: 'REVIEW_IMAGE_FOREIGN', message: '같은 사진을 두 번 붙일 수 없어요.' },
  foreign: { code: 'REVIEW_IMAGE_FOREIGN', message: '첨부할 수 없는 사진이에요.' },
}

/**
 * 리뷰 (TASK-0083).
 *
 * ## 여기에 「구매했는가」를 묻는 코드가 없다
 *
 * 그 답은 스키마가 갖고 있다 — 요청이 가리키는 것은 **주문 항목**이고, 그 항목이
 * 이 사람의 것이 아니면 아래 조회가 아무것도 찾지 못한다. 중복도 마찬가지다:
 * `Review.orderItemId` 가 유니크라, 이 서비스의 검사를 모두 우회해 들어와도 두 번째
 * 행은 저장되지 않는다 (`erd.md` 9장).
 *
 * 그래서 서비스가 판단하는 것은 **시점**과 **사진**뿐이고, 둘 다 순수 함수가 쥔다.
 *
 * ## 남의 것을 물으면 「없다」고 답한다
 *
 * 남의 주문 항목에 리뷰를 쓰려는 요청에 403 을 주면 그 id 가 존재한다는 사실을
 * 알려 주는 것이 된다. 404 는 「당신에게는 없다」이고, 그것이 사실이다.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: SearchOutboxService,
    private readonly images: ReviewImageUrls,
  ) {}

  /** 산 것에 리뷰를 쓴다 (F1 · F2 · F3 · F6). */
  async create(userId: string, request: CreateReviewRequest): Promise<Review> {
    const subject = await this.subject(userId, request.orderItemId)
    const now = this.clock.now()
    const decision = reviewDecision(subject, now)

    if (!decision.allowed) {
      const { code, message } = REVIEW_REFUSAL[decision.reason]

      throw new ConflictException(domainFailure(code, message))
    }

    this.assertImages(request.imageKeys, userId)

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          orderItemId: request.orderItemId,
          productId: subject.productId,
          userId,
          rating: request.rating,
          content: request.content,
          createdAt: now,
          updatedAt: now,
          images: {
            create: request.imageKeys.map((key, position) => ({ key, position, createdAt: now })),
          },
        },
        select: REVIEW_SELECT,
      })

      await this.refreshRating(tx, subject.productId)

      return review
    })

    return toReview(created, this.images)
  }

  /** 기한 안에서 고친다 (F4 · F5). */
  async update(userId: string, id: string, request: UpdateReviewRequest): Promise<Review> {
    const held = await this.own(userId, id)
    const now = this.clock.now()

    if (!editable(held.createdAt, now)) {
      throw new ConflictException(
        domainFailure('REVIEW_EDIT_WINDOW_CLOSED', '리뷰를 고칠 수 있는 기간이 지났어요.'),
      )
    }

    this.assertImages(request.imageKeys, userId)

    // 사진은 **통째로 갈아 끼운다.** 무엇이 지워지고 무엇이 남는지를 부분 갱신으로
    // 표현하면 순서까지 함께 정해야 하고, 그 규칙이 화면과 서버 두 곳에 생긴다.
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.reviewImage.deleteMany({ where: { reviewId: id } })

      const review = await tx.review.update({
        where: { id },
        data: {
          rating: request.rating,
          content: request.content,
          updatedAt: now,
          images: {
            create: request.imageKeys.map((key, position) => ({ key, position, createdAt: now })),
          },
        },
        select: REVIEW_SELECT,
      })

      await this.refreshRating(tx, review.productId)

      return review
    })

    return toReview(updated, this.images)
  }

  /**
   * 지운다 — **행은 남는다** (F4).
   *
   * 신고가 이 행을 가리키고 있을 수 있고(TASK-0091), 지웠다 다시 쓰는 길을 열면
   * 「좋은 리뷰를 쓰고 혜택을 받은 뒤 지우고 나쁜 리뷰를 쓴다」가 가능해진다 —
   * 수정 기한이 막으려는 것과 같은 조작이다.
   */
  async remove(userId: string, id: string): Promise<void> {
    const held = await this.own(userId, id)

    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id },
        data: { status: 'DELETED', updatedAt: this.clock.now() },
      })
      await this.refreshRating(tx, held.productId)
    })
  }

  /**
   * 이 상품의 평점을 **다시 센다** (F2 · F3 · F4).
   *
   * 더하고 빼지 않고 처음부터 센다 — `Product.minPrice` 가 같은 판단을 하고 그
   * 이유가 저쪽에 적혀 있다: **파생값은 누적하지 않는다.** 누적하면 어긋난 값을
   * 되돌릴 방법이 없고, 어긋난 평점은 아무도 신고하지 않는다.
   *
   * 다시 센 뒤 검색 인덱스에 사건을 남긴다. 부르는 쪽의 트랜잭션 안이라, **사건은
   * 리뷰가 실제로 바뀐 만큼만 존재한다** — 롤백되면 사건도 함께 사라진다.
   */
  private async refreshRating(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ rating: number; count: number }[]>`
      SELECT "rating", COUNT(*)::int AS "count"
        FROM "Review"
       WHERE "productId" = ${productId}::uuid AND "status" = 'PUBLISHED'
       GROUP BY "rating"`
    const counts = Object.fromEntries(rows.map((row) => [row.rating, row.count]))

    await tx.product.update({
      where: { id: productId },
      data: {
        ratingAvg: ratingAverage(counts),
        ratingCount: rows.reduce((sum, row) => sum + row.count, 0),
      },
    })
    await this.outbox.publish(tx, productId, 'UPSERT')
  }

  /** 한 벌 읽기. 지워진 리뷰는 쓴 사람에게도 없는 것으로 답한다. */
  async detail(id: string): Promise<Review> {
    const review = await this.prisma.review.findUnique({ where: { id }, select: REVIEW_SELECT })

    if (review === null || review.status === 'DELETED') {
      throw new NotFoundException('리뷰를 찾을 수 없어요.')
    }

    return toReview(review, this.images)
  }

  /**
   * 아직 리뷰를 쓸 수 있는 주문 항목 (F7).
   *
   * **쓸 수 있는 것만 담는다.** 「쓸 수 없는 이유」를 함께 실어 전부 내려보내면 이
   * 목록이 「배송 중인 주문」 목록과 겹쳐 두 화면이 같은 것을 서로 다르게 말한다.
   */
  async reviewable(
    userId: string,
    params: ReviewableListQueryParams,
  ): Promise<ReviewableListResponse> {
    const limit = params.limit ?? REVIEWABLE_LIST_DEFAULT_LIMIT
    const since = new Date(this.clock.now().getTime() - REVIEW_WRITE_WINDOW_DAYS * DAY_MS)
    const rows = await this.prisma.$queryRaw<ReviewableRow[]>`
      SELECT oi."id"::text        AS "orderItemId",
             o."id"::text         AS "orderId",
             o."orderNumber"      AS "orderNumber",
             oi."productId"::text AS "productId",
             oi."productSnapshot" AS "snapshot",
             MAX(h."createdAt")   AS "deliveredAt"
        FROM "OrderItem" oi
        JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
        JOIN "Order" o        ON o."id" = so."orderId"
        JOIN "OrderStatusHistory" h
          ON h."sellerOrderId" = so."id" AND h."toStatus" = 'DELIVERED'
       WHERE o."userId" = ${userId}::uuid
         AND so."status" IN ('DELIVERED', 'CONFIRMED')
         AND NOT EXISTS (SELECT 1 FROM "Review" r WHERE r."orderItemId" = oi."id")
         AND (${params.cursor ?? null}::uuid IS NULL OR oi."id" < ${params.cursor ?? null}::uuid)
       GROUP BY oi."id", o."id", o."orderNumber"
      HAVING MAX(h."createdAt") >= ${since}
       ORDER BY oi."id" DESC
       LIMIT ${limit + 1}`
    const page = rows.slice(0, limit)

    return {
      items: page.map((row) => toReviewable(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.orderItemId ?? null) : null,
    }
  }

  /** 이 사람의 리뷰. 남의 것이면 **없다**고 답한다. */
  private async own(userId: string, id: string): Promise<{ createdAt: Date; productId: string }> {
    const review = await this.prisma.review.findUnique({
      where: { id },
      select: { userId: true, status: true, createdAt: true, productId: true },
    })

    if (review?.userId !== userId || review.status === 'DELETED') {
      throw new NotFoundException('리뷰를 찾을 수 없어요.')
    }

    return { createdAt: review.createdAt, productId: review.productId }
  }

  private assertImages(keys: readonly string[], userId: string): void {
    const decision = reviewImageDecision(keys, userId)

    if (decision.outcome === 'allowed') return

    const { code, message } = IMAGE_REFUSAL[decision.reason]

    throw new BadRequestException(domainFailure(code, message))
  }

  /**
   * 리뷰가 알아야 하는 사실 전부를 한 번에.
   *
   * 배송완료 시각을 이력에서 읽는 이유는 그것이 **단일 출처**이기 때문이다 —
   * `SellerOrder` 에 사본을 두면 두 값이 갈라지고, 갈라졌을 때 어느 쪽이 맞는지
   * 말할 방법이 없다.
   */
  private async subject(userId: string, orderItemId: string): Promise<SubjectRow> {
    const [row] = await this.prisma.$queryRaw<SubjectRow[]>`
      SELECT oi."id"::text        AS "orderItemId",
             oi."productId"::text AS "productId",
             o."userId"::text     AS "buyerId",
             so."status"::text    AS "status",
             MAX(h."createdAt")   AS "deliveredAt",
             (r."id" IS NOT NULL) AS "reviewed",
             (oi."productSnapshot" ->> 'optionLabel') AS "optionLabel"
        FROM "OrderItem" oi
        JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
        JOIN "Order" o        ON o."id" = so."orderId"
        LEFT JOIN "OrderStatusHistory" h
          ON h."sellerOrderId" = so."id" AND h."toStatus" = 'DELIVERED'
        LEFT JOIN "Review" r ON r."orderItemId" = oi."id"
       WHERE oi."id" = ${orderItemId}::uuid AND o."userId" = ${userId}::uuid
       GROUP BY oi."id", o."userId", so."status", r."id"`

    if (row === undefined) throw new NotFoundException('주문 항목을 찾을 수 없어요.')

    return row
  }
}

interface ReviewableRow {
  readonly orderItemId: string
  readonly orderId: string
  readonly orderNumber: string
  readonly snapshot: Prisma.JsonValue
  readonly productId: string
  readonly deliveredAt: Date
}

function toReviewable(row: ReviewableRow): ReviewableItem {
  const snapshot =
    typeof row.snapshot === 'object' && row.snapshot !== null && !Array.isArray(row.snapshot)
      ? (row.snapshot as Record<string, unknown>)
      : {}
  const text = (key: string): string | null => {
    const value = snapshot[key]

    return typeof value === 'string' ? value : null
  }

  return {
    orderItemId: row.orderItemId,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    productId: row.productId,
    productName: text('productName') ?? '',
    optionLabel: text('optionLabel'),
    thumbnailUrl: text('thumbnailUrl'),
    deliveredAt: row.deliveredAt.toISOString(),
    // 서버가 계산해 내려보낸다 — 화면이 기한을 다시 세면 그 규칙이 두 벌이 된다.
    writableUntil: new Date(
      row.deliveredAt.getTime() + REVIEW_WRITE_WINDOW_DAYS * DAY_MS,
    ).toISOString(),
  }
}

function toReview(row: ReviewRow, images: ReviewImageUrls): Review {
  return {
    id: row.id,
    productId: row.productId,
    rating: row.rating,
    content: row.content,
    status: row.status,
    authorName: maskAuthorName(row.user.name),
    optionLabel: optionLabelOf(row.orderItem.productSnapshot),
    images: images.of(row.images.map((image) => image.key)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
