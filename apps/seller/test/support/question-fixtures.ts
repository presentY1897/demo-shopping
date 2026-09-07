/**
 * The answers TASK-0088's three routes give, built through their contracts.
 *
 * `defineFixture` parses at module load, so a fixture that drifts from
 * `@shopping/shared` takes down every spec that imports it — including the
 * screen specs, which never mention the schema themselves (gate C2). Types alone
 * would not do: `productId: 'x'` typechecks and fails `productIdSchema`.
 *
 * `support/review-fixtures.ts` is the file this one is modelled on, down to the
 * shape of the two rows — the two consoles are the same screen for a different
 * object, so their fixtures answer the same questions.
 *
 * These live here rather than in `@shopping/api-mocks` only because this branch
 * does not own `packages/` — see `support/api-stub.ts`.
 */

import { defineFixture, sessionSellerOwner } from '@shopping/api-mocks'
import type { AnswerResponse, SellerQuestion, SellerQuestionsResponse } from '@shopping/shared'
import { answerResponseSchema, sellerQuestionsResponseSchema } from '@shopping/shared'

/** The store the signed-in seller owns. Read off the session, never retyped. */
export const MOCK_SELLER_ID = sessionSellerOwner.user.sellerId ?? ''

const BRAND_NAME = '루미에르'

/**
 * 답을 기다리는 문의 — 그리고 **비공개**다 (4.2).
 *
 * 두 성질을 한 줄에 겹쳐 둔 것이 의도다. 판매자에게 비공개 문의가 도착한다는 사실은
 * 「그 줄이 온다」로만 증명되고, 그 줄이 **답해야 하는 줄**일 때 화면이 그것을 어떻게
 * 표시하는지가 이 화면의 유일한 새 판단이다 — 답변도 공개되지 않는다는 것.
 */
const unansweredQuestion = {
  answer: null,
  authorName: '홍*동',
  content: '이 코트 안감도 울인가요? 세탁은 어떻게 하나요?',
  createdAt: '2026-09-04T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f8001',
  isPublic: false,
  mine: false,
  productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f7001',
  productName: '리네아 오버사이즈 코트',
  updatedAt: '2026-09-04T02:00:00.000Z',
} satisfies SellerQuestion

/** 이미 답한 문의. 공개다 — 세 갈래의 반대편이다. */
const answeredQuestion = {
  answer: {
    brandName: BRAND_NAME,
    content: '안감은 폴리에스터이고, 드라이클리닝을 권해드립니다.',
    createdAt: '2026-09-03T05:00:00.000Z',
    questionId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f8002',
    updatedAt: '2026-09-03T05:00:00.000Z',
  },
  authorName: '김*수',
  content: '재입고 예정이 있을까요?',
  createdAt: '2026-09-03T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f8002',
  isPublic: true,
  mine: false,
  productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f7002',
  productName: '메르시아 니트 카디건',
  updatedAt: '2026-09-03T02:00:00.000Z',
} satisfies SellerQuestion

export const UNANSWERED_QUESTION_ID = unansweredQuestion.id

export const ANSWERED_QUESTION_ID = answeredQuestion.id

export const UNANSWERED_PRODUCT_NAME = unansweredQuestion.productName

export const ANSWERED_PRODUCT_NAME = answeredQuestion.productName

export const UNANSWERED_CONTENT = unansweredQuestion.content

export const EXISTING_ANSWER_CONTENT = answeredQuestion.answer.content

export const ANSWER_BRAND_NAME = BRAND_NAME

export const NEW_ANSWER_CONTENT = '안감은 울 30% 혼방이고, 드라이클리닝만 가능합니다.'

/**
 * 첫 페이지. `nextCursor` 가 있어 「다음」이 눌린다.
 *
 * **답한 것이 먼저 실려 있다.** 서버가 보내는 순서(미답변 우선)와 반대인데, 그것이
 * 이 픽스처의 목적이다: 화면이 스스로 정렬하면 이 순서가 뒤집히고, 그 회귀는 다른
 * 어떤 검사로도 드러나지 않는다 (F5).
 */
export const questionsPage1: SellerQuestionsResponse = defineFixture(
  sellerQuestionsResponseSchema,
  {
    nextCursor: 'cursor-page-2',
    questions: [answeredQuestion, unansweredQuestion],
    // **4는 이 페이지의 미답변 수(1)가 아니다.** 뱃지가 목록에서 파생되지 않는다는
    // 것을 픽스처가 먼저 말한다.
    unansweredCount: 4,
  },
)

/** 마지막 페이지. */
export const questionsPage2: SellerQuestionsResponse = defineFixture(
  sellerQuestionsResponseSchema,
  {
    nextCursor: null,
    questions: [
      {
        ...unansweredQuestion,
        content: '사이즈가 정사이즈인가요?',
        id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f8003',
        isPublic: true,
      },
    ],
    unansweredCount: 4,
  },
)

/** 방금 쓴 답변이 붙은 그 페이지. 저장 뒤에 줄이 바뀌는 것을 보이려고 쓴다. */
export const questionsAfterAnswer: SellerQuestionsResponse = defineFixture(
  sellerQuestionsResponseSchema,
  {
    nextCursor: 'cursor-page-2',
    questions: [
      answeredQuestion,
      {
        ...unansweredQuestion,
        answer: {
          brandName: BRAND_NAME,
          content: NEW_ANSWER_CONTENT,
          createdAt: '2026-09-06T01:00:00.000Z',
          questionId: unansweredQuestion.id,
          updatedAt: '2026-09-06T01:00:00.000Z',
        },
      },
    ],
    unansweredCount: 3,
  },
)

export const questionsEmpty: SellerQuestionsResponse = defineFixture(
  sellerQuestionsResponseSchema,
  { nextCursor: null, questions: [], unansweredCount: 0 },
)

/** 답할 것이 하나도 없는 스토어. 뱃지가 0을 큰 글씨로 쓰지 않는 쪽이다. */
export const questionsAllAnswered: SellerQuestionsResponse = defineFixture(
  sellerQuestionsResponseSchema,
  { nextCursor: null, questions: [answeredQuestion], unansweredCount: 0 },
)

/** `PUT /questions/:id/answer` 의 답. 쓰기와 고치기가 같은 모양으로 온다. */
export const writtenAnswer: AnswerResponse = defineFixture(answerResponseSchema, {
  answer: {
    brandName: BRAND_NAME,
    content: NEW_ANSWER_CONTENT,
    createdAt: '2026-09-06T01:00:00.000Z',
    questionId: unansweredQuestion.id,
    updatedAt: '2026-09-06T01:00:00.000Z',
  },
})
