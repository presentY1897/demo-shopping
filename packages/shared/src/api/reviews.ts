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
  imageKeys: z.array(z.string()),
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

export { REVIEW_IMAGE_MAX_COUNT }
