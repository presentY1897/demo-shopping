import { z } from 'zod'

import { REVIEW_IMAGE_MAX_COUNT, reviewImageKeySchema } from './uploads.js'

/**
 * 리뷰 (TASK-0083).
 *
 * **구매 검증이 계약에 없다.** 「이 사람이 이 상품을 샀는가」를 묻는 필드도, 그
 * 물음에 답하는 라우트도 없다 — 리뷰를 쓰는 요청이 가리키는 것은 **주문 항목**이고,
 * 그 항목이 없으면 요청 자체가 성립하지 않는다. 검증이 스키마에 있다는 말은 이런
 * 뜻이다 (`erd.md` 9장).
 */

export const REVIEW_CONTENT_MAX = 2_000

export const reviewRatingSchema = z.int().min(1).max(5)

/**
 * 리뷰의 본문.
 *
 * 빈 문자열이 거절되는 것이 요점이다 — 별점만 남기는 길이 열리면 그것은 평균을
 * 움직이면서 아무 근거도 남기지 않는다. `Review_content_check` 가 같은 것을 DB 에서
 * 한 번 더 막는다.
 */
export const reviewContentSchema = z.string().trim().min(1).max(REVIEW_CONTENT_MAX)

export const reviewStatuses = ['PUBLISHED', 'HIDDEN', 'DELETED'] as const

export type ReviewStatus = (typeof reviewStatuses)[number]

export const reviewStatusSchema = z.enum(reviewStatuses)

/**
 * 사진 목록.
 *
 * 상한을 **계약이 아니라 규칙이 강제한다** — `.max()` 로 걸면 여섯 번째 장이 이름
 * 없는 필드 오류가 되어 화면이 「몇 장까지」로 바꿔 말할 수 없다 (반품 사진이 같은
 * 판단을 하고 그 이유가 `claimReturnDetailsSchema.photoKeys` 에 적혀 있다).
 */
export const reviewImageKeysSchema = z.array(reviewImageKeySchema)

/**
 * 붙은 사진 하나 — 열쇠와 **그릴 수 있는 주소**.
 *
 * 열쇠만 내려보내던 시절이 잠깐 있었고, 그때 화면은 사진을 그릴 방법이 없었다. 열쇠를
 * 주소로 바꾸는 규칙은 저장소 설정에 달려 있고 그 설정은 서버에만 있다 — 화면이
 * 주소를 조립하면 저장소를 옮기는 날 모든 화면이 함께 틀린다.
 *
 * **저장소가 설정되지 않은 배포에서는 `url` 이 `null`** 이다 (TASK-0011 4.5). 클레임
 * 사진이 같은 판단을 하고 그 이유가 `claimPhotoSchema` 에 적혀 있다 — 사진을 못 보는
 * 것과 화면이 열리지 않는 것은 다른 일이다.
 */
export const reviewImageSchema = z.object({
  key: reviewImageKeySchema,
  url: z.url().nullable(),
})

export type ReviewImage = z.infer<typeof reviewImageSchema>

/** 리뷰 한 벌. 상품 상세와 마이페이지가 같은 모양으로 읽는다. */
export const reviewSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  rating: reviewRatingSchema,
  content: z.string(),
  status: reviewStatusSchema,
  /**
   * 쓴 사람의 표시 이름 — **가려서** 내려간다 (`홍*동`).
   *
   * 리뷰는 로그인하지 않은 사람도 읽으므로, 여기 실리는 것은 공개해도 되는 만큼이다.
   * 가리는 일을 화면마다 하게 두면 한 화면이 잊는 날 그 화면만 이름을 다 보여 준다.
   */
  authorName: z.string(),
  /** 산 조합의 이름 (`블랙 / M`). 주문 항목의 스냅샷에서 온다. */
  optionLabel: z.string().nullable(),
  images: z.array(reviewImageSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type Review = z.infer<typeof reviewSchema>

export const reviewResponseSchema = z.object({ review: reviewSchema })

export type ReviewResponse = z.infer<typeof reviewResponseSchema>

/** `POST /api/v1/reviews` — 산 것에 리뷰를 쓴다. */
export const createReviewRequestSchema = z.object({
  /**
   * 어느 주문 항목에 대한 리뷰인가.
   *
   * **상품 id 를 받지 않는 이유가 여기 있다.** 상품을 받으면 「이 사람이 그 상품을
   * 샀는가」를 서버가 물어야 하고, 그 물음은 우회 경로가 생기는 날 뚫린다. 주문
   * 항목을 받으면 그 행이 없는 사람은 애초에 아무것도 가리킬 수 없다.
   */
  orderItemId: z.uuid(),
  rating: reviewRatingSchema,
  content: reviewContentSchema,
  imageKeys: reviewImageKeysSchema.default([]),
})

export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>

/** `PATCH /api/v1/reviews/:id` — 기한 안에서 고친다. */
export const updateReviewRequestSchema = z.object({
  rating: reviewRatingSchema,
  content: reviewContentSchema,
  imageKeys: reviewImageKeysSchema.default([]),
})

export type UpdateReviewRequest = z.infer<typeof updateReviewRequestSchema>

/**
 * 왜 못 쓰나 (TASK-0083 F3).
 *
 * 넷을 나누는 이유는 **사람이 할 일이 다르기** 때문이다. 아직 안 온 것은 기다리면
 * 되고, 이미 쓴 것은 고치면 되며, 기한이 지난 것은 할 수 있는 일이 없고, 취소된
 * 것은 애초에 받은 적이 없다.
 */
export const reviewRefusals = [
  'not_delivered',
  'already_reviewed',
  'window_closed',
  'canceled',
] as const

export type ReviewRefusal = (typeof reviewRefusals)[number]

/** 마이페이지의 「리뷰 쓸 수 있는 주문」 한 줄. */
export const reviewableItemSchema = z.object({
  orderItemId: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  productId: z.uuid(),
  productName: z.string(),
  optionLabel: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  /** 배송완료 시각. 화면이 「D-12 남음」을 그리는 근거다. */
  deliveredAt: z.iso.datetime(),
  /** 이 날까지 쓸 수 있다. 서버가 계산해 내려보내야 화면마다 달라지지 않는다. */
  writableUntil: z.iso.datetime(),
})

export type ReviewableItem = z.infer<typeof reviewableItemSchema>

export const REVIEWABLE_LIST_DEFAULT_LIMIT = 20
export const REVIEWABLE_LIST_MAX_LIMIT = 100

export const reviewableListQueryParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(REVIEWABLE_LIST_MAX_LIMIT).optional(),
})

export type ReviewableListQueryParams = z.infer<typeof reviewableListQueryParamsSchema>

/**
 * `GET /api/v1/me/reviewable-items` — 아직 리뷰를 쓸 수 있는 주문 항목 (F7).
 *
 * **쓸 수 있는 것만 담는다.** 「쓸 수 없는 이유」를 함께 실어 전부 내려보내는 길도
 * 있었지만, 그러면 이 목록이 「배송 중인 주문」 목록과 겹쳐 두 화면이 같은 것을 서로
 * 다르게 말한다. 못 쓰는 이유는 리뷰를 **쓰려고 할 때** 답한다.
 */
export const reviewableListResponseSchema = z.object({
  items: z.array(reviewableItemSchema),
  nextCursor: z.string().nullable(),
})

export type ReviewableListResponse = z.infer<typeof reviewableListResponseSchema>

/**
 * 리뷰를 늘어놓는 세 가지 축 (TASK-0084).
 *
 * **「낮은 평점 순」이 없다.** 그 정렬은 목록의 뜻을 바꾼다 — 위에서부터 읽는
 * 사람에게 별 하나가 먼저 보이는 목록은 「이 상품의 리뷰」가 아니라 「이 상품의
 * 불만」이 된다.
 */
export const reviewSortKeys = ['latest', 'rating', 'helpful'] as const

export type ReviewSortKey = (typeof reviewSortKeys)[number]

export const REVIEW_LIST_DEFAULT_LIMIT = 10
export const REVIEW_LIST_MAX_LIMIT = 50

/** `GET /api/v1/products/:id/reviews`. */
export const reviewListQueryParamsSchema = z.object({
  sort: z.enum(reviewSortKeys).optional(),
  /** 사진이 있는 리뷰만 (F6). */
  photoOnly: z.stringbool().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(REVIEW_LIST_MAX_LIMIT).optional(),
})

export type ReviewListQueryParams = z.infer<typeof reviewListQueryParamsSchema>

/** 별점 하나의 몫. */
export const ratingBucketSchema = z.object({
  rating: reviewRatingSchema,
  count: z.int().min(0),
  /** **다섯을 더하면 정확히 100** 이다 (리뷰가 하나라도 있으면). */
  percentage: z.int().min(0).max(100),
})

export type RatingBucket = z.infer<typeof ratingBucketSchema>

/**
 * 이 상품의 평점 요약.
 *
 * 목록과 **함께** 오는 이유는 화면이 둘을 나란히 그리기 때문이고, 나눠 받으면
 * 필터를 바꿀 때마다 분포가 함께 흔들린다 — 분포는 **필터와 무관한** 사실이다.
 */
export const ratingSummarySchema = z.object({
  /** 100배 정수. 4.35는 435다 — 이 스키마에 부동소수가 없다. */
  averageTimes100: z.int().min(0).max(500),
  count: z.int().min(0),
  /** 별 다섯부터 하나까지, 언제나 다섯 칸. */
  buckets: z.array(ratingBucketSchema),
  /** 사진이 붙은 리뷰의 수 — 「사진 리뷰만 보기」 버튼이 이 수를 그린다. */
  photoCount: z.int().min(0),
})

export type RatingSummary = z.infer<typeof ratingSummarySchema>

export const REVIEW_REPLY_CONTENT_MAX = 1_000

/**
 * 판매자의 답변 (TASK-0085).
 *
 * **리뷰당 하나**이고, 그것을 기본키가 만든다 — 두 번째 답변은 저장될 자리가 없다.
 */
export const reviewReplySchema = z.object({
  reviewId: z.uuid(),
  brandName: z.string(),
  content: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type ReviewReply = z.infer<typeof reviewReplySchema>

export const reviewReplyResponseSchema = z.object({ reply: reviewReplySchema })

export type ReviewReplyResponse = z.infer<typeof reviewReplyResponseSchema>

/** `PUT /api/v1/reviews/:id/reply` — 쓰거나 고친다. */
export const writeReviewReplyRequestSchema = z.object({
  content: z.string().trim().min(1).max(REVIEW_REPLY_CONTENT_MAX),
})

export type WriteReviewReplyRequest = z.infer<typeof writeReviewReplyRequestSchema>

/** 목록에 실리는 리뷰 — 한 벌짜리에 도움 수와 내가 눌렀는지가 더해진다. */
export const reviewListEntrySchema = reviewSchema.extend({
  helpfulCount: z.int().min(0),
  /** 로그인하지 않았으면 언제나 `false`. */
  helpfulByMe: z.boolean(),
  /**
   * 판매자의 답변 (TASK-0085 F4).
   *
   * 목록과 **함께** 오는 이유는 화면이 리뷰 바로 아래에 그리기 때문이다. 따로
   * 받으면 리뷰 한 장마다 요청이 하나씩 늘고, 그것이 바로 N+1 이다.
   */
  reply: reviewReplySchema.nullable(),
})

export type ReviewListEntry = z.infer<typeof reviewListEntrySchema>

export const reviewListResponseSchema = z.object({
  reviews: z.array(reviewListEntrySchema),
  nextCursor: z.string().nullable(),
  summary: ratingSummarySchema,
})

export type ReviewListResponse = z.infer<typeof reviewListResponseSchema>

/** `POST`/`DELETE /api/v1/reviews/:id/helpful` 의 답. */
export const reviewHelpfulResponseSchema = z.object({
  helpfulCount: z.int().min(0),
  helpfulByMe: z.boolean(),
})

export type ReviewHelpfulResponse = z.infer<typeof reviewHelpfulResponseSchema>

/**
 * 판매자 리뷰 관리 목록의 한 줄 (F5 · F6).
 *
 * 상품 상세의 목록과 **다른 모양**인 이유는 다른 질문에 답하기 때문이다 — 저쪽은
 * 「이 상품이 어떤가」이고 이쪽은 「무엇에 답해야 하는가」다. 그래서 여기에는 상품
 * 이름이 있고 가려지지 않은 별점 분포가 없다.
 */
export const sellerProductReviewSchema = reviewSchema.extend({
  productName: z.string(),
  reply: reviewReplySchema.nullable(),
})

export type SellerProductReview = z.infer<typeof sellerProductReviewSchema>

/**
 * 「판매자 리뷰」가 이 저장소에서 두 가지를 뜻한다.
 *
 * `sellers.ts` 의 `SELLER_REVIEW_LIST_*` 는 **입점 심사 대기열**이고, 이쪽은 판매자가
 * 자기 상품에 달린 **상품 리뷰**를 보는 목록이다. 이름을 길게 쓰는 이유가 그것이다 —
 * 짧게 두면 두 화면이 같은 이름을 서로 다른 뜻으로 쓰게 된다.
 */
export const SELLER_PRODUCT_REVIEWS_DEFAULT_LIMIT = 20

export const sellerProductReviewsQueryParamsSchema = z.object({
  /** `true` 면 아직 답하지 않은 것만. */
  unansweredOnly: z.stringbool().optional(),
  /** 이 별점 이하만 — 대응이 필요한 리뷰를 먼저 찾는 것이 실제 사용 패턴이다 (4장). */
  maxRating: z.coerce.number().pipe(reviewRatingSchema).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(REVIEW_LIST_MAX_LIMIT).optional(),
})

export type SellerProductReviewsQueryParams = z.infer<typeof sellerProductReviewsQueryParamsSchema>

export const sellerProductReviewsResponseSchema = z.object({
  reviews: z.array(sellerProductReviewSchema),
  nextCursor: z.string().nullable(),
  /**
   * 아직 답하지 않은 리뷰의 수 (F7).
   *
   * **필터와 무관하다.** 뱃지는 「지금 화면에 몇 개」가 아니라 「할 일이 몇 개」이고,
   * 필터를 켜면 줄어드는 뱃지는 할 일을 숨긴다.
   */
  unansweredCount: z.int().min(0),
})

export type SellerProductReviewsResponse = z.infer<typeof sellerProductReviewsResponseSchema>

export { REVIEW_IMAGE_MAX_COUNT }
