/**
 * The answers TASK-0085's three routes give, built through their contracts.
 *
 * `defineFixture` parses at module load, so a fixture that drifts from
 * `@shopping/shared` takes down every spec that imports it — including the
 * screen specs, which never mention the schema themselves (gate C2). Types alone
 * would not do: `rating: 0` typechecks and fails `reviewRatingSchema`, whose
 * `min(1)` is the reason a star row can never come out empty.
 *
 * These live here rather than in `@shopping/api-mocks` only because this branch
 * does not own `packages/` — see `support/api-stub.ts`.
 */

import { defineFixture, sessionSellerOwner } from '@shopping/api-mocks'
import type {
  ReviewReplyResponse,
  SellerProductReview,
  SellerProductReviewsResponse,
} from '@shopping/shared'
import { reviewReplyResponseSchema, sellerProductReviewsResponseSchema } from '@shopping/shared'

/** The store the signed-in seller owns. Read off the session, never retyped. */
export const MOCK_SELLER_ID = sessionSellerOwner.user.sellerId ?? ''

const BRAND_NAME = '루미에르'

/**
 * 답을 기다리는 리뷰 — **별 둘, 사진 둘, 답변 없음.**
 *
 * 이 화면이 존재하는 이유가 이 한 줄이다. 낮은 평점과 미답변이 겹치는 것이 4장이
 * 말하는 「대응이 필요한 리뷰」이고, 두 필터가 각각 이것을 골라낸다.
 */
const unansweredReview = {
  authorName: '홍*동',
  content: '색이 사진과 많이 달라요. 교환 가능한가요?',
  createdAt: '2026-09-04T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f6001',
  images: [
    {
      key: 'reviews/0192f0c1-0000-7000-8000-000000000001/0192f0c1-0000-7000-8000-0000000000a1.webp',
      url: 'https://cdn.test.invalid/a.webp',
    },
    {
      key: 'reviews/0192f0c1-0000-7000-8000-000000000001/0192f0c1-0000-7000-8000-0000000000a2.webp',
      url: 'https://cdn.test.invalid/b.webp',
    },
  ],
  optionLabel: '블랙 / M',
  productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f7001',
  productName: '리네아 오버사이즈 코트',
  rating: 2,
  reply: null,
  status: 'PUBLISHED',
  updatedAt: '2026-09-04T02:00:00.000Z',
} satisfies SellerProductReview

/** 이미 답한 리뷰. 별 다섯, 사진 없음, 옵션 없음 — 세 갈래의 반대편이다. */
const answeredReview = {
  authorName: '김*수',
  content: '핏이 좋아서 색깔별로 더 살 생각이에요.',
  createdAt: '2026-09-03T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f6002',
  images: [],
  optionLabel: null,
  productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f7002',
  productName: '메르시아 니트 카디건',
  rating: 5,
  reply: {
    brandName: BRAND_NAME,
    content: '좋게 봐주셔서 감사합니다. 다음 시즌에도 뵙겠습니다.',
    createdAt: '2026-09-03T05:00:00.000Z',
    reviewId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f6002',
    updatedAt: '2026-09-03T05:00:00.000Z',
  },
  status: 'PUBLISHED',
  updatedAt: '2026-09-03T02:00:00.000Z',
} satisfies SellerProductReview

export const UNANSWERED_REVIEW_ID = unansweredReview.id

export const ANSWERED_REVIEW_ID = answeredReview.id

export const UNANSWERED_PRODUCT_NAME = unansweredReview.productName

export const ANSWERED_PRODUCT_NAME = answeredReview.productName

export const UNANSWERED_CONTENT = unansweredReview.content

export const EXISTING_REPLY_CONTENT = answeredReview.reply.content

export const REPLY_BRAND_NAME = BRAND_NAME

/**
 * 첫 페이지. `nextCursor` 가 있어 「다음」이 눌린다.
 *
 * **답한 것이 먼저 실려 있다.** 서버가 보내는 순서(미답변 우선)와 반대인데, 그것이
 * 이 픽스처의 목적이다: 화면이 스스로 정렬하면 이 순서가 뒤집히고, 그 회귀는 다른
 * 어떤 검사로도 드러나지 않는다 (F5).
 */
export const reviewsPage1: SellerProductReviewsResponse = defineFixture(
  sellerProductReviewsResponseSchema,
  {
    nextCursor: 'cursor-page-2',
    reviews: [answeredReview, unansweredReview],
    // **7은 이 페이지의 미답변 수(1)가 아니다.** 뱃지가 목록에서 파생되지 않는다는
    // 것을 픽스처가 먼저 말한다.
    unansweredCount: 7,
  },
)

/** 마지막 페이지. */
export const reviewsPage2: SellerProductReviewsResponse = defineFixture(
  sellerProductReviewsResponseSchema,
  {
    nextCursor: null,
    reviews: [
      {
        ...unansweredReview,
        content: '배송이 생각보다 오래 걸렸어요.',
        id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f6003',
        images: [],
        rating: 3,
      },
    ],
    unansweredCount: 7,
  },
)

/** 방금 쓴 답변이 붙은 그 페이지. 저장 뒤에 줄이 바뀌는 것을 보이려고 쓴다. */
export const reviewsAfterReply: SellerProductReviewsResponse = defineFixture(
  sellerProductReviewsResponseSchema,
  {
    nextCursor: 'cursor-page-2',
    reviews: [
      answeredReview,
      {
        ...unansweredReview,
        reply: {
          brandName: BRAND_NAME,
          content: '불편을 드려 죄송합니다. 교환 도와드리겠습니다.',
          createdAt: '2026-09-06T01:00:00.000Z',
          reviewId: unansweredReview.id,
          updatedAt: '2026-09-06T01:00:00.000Z',
        },
      },
    ],
    unansweredCount: 6,
  },
)

export const NEW_REPLY_CONTENT = '불편을 드려 죄송합니다. 교환 도와드리겠습니다.'

export const reviewsEmpty: SellerProductReviewsResponse = defineFixture(
  sellerProductReviewsResponseSchema,
  { nextCursor: null, reviews: [], unansweredCount: 0 },
)

/** 답할 것이 하나도 없는 스토어. 뱃지가 0을 큰 글씨로 쓰지 않는 쪽이다. */
export const reviewsAllAnswered: SellerProductReviewsResponse = defineFixture(
  sellerProductReviewsResponseSchema,
  { nextCursor: null, reviews: [answeredReview], unansweredCount: 0 },
)

/** `PUT /reviews/:id/reply` 의 답. 쓰기와 고치기가 같은 모양으로 온다. */
export const writtenReply: ReviewReplyResponse = defineFixture(reviewReplyResponseSchema, {
  reply: {
    brandName: BRAND_NAME,
    content: NEW_REPLY_CONTENT,
    createdAt: '2026-09-06T01:00:00.000Z',
    reviewId: unansweredReview.id,
    updatedAt: '2026-09-06T01:00:00.000Z',
  },
})
