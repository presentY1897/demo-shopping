import { z } from 'zod'

import { productIdSchema } from './products.js'

/**
 * 상품 문의 (TASK-0088).
 *
 * **비공개 문의는 계약에서부터 조심스럽다.** 목록의 한 줄에 「비공개다」와 「내
 * 것이다」가 함께 실리는데, 남의 비공개 문의는 **그 줄 자체가 오지 않는다** — 내용을
 * 비우고 보내면 「여기 뭔가 있다」가 새어 나가고, 그 사실만으로도 알아서는 안 될 것을
 * 알게 되는 경우가 있다.
 */

export const QUESTION_CONTENT_MAX = 1_000
export const ANSWER_CONTENT_MAX = 1_000

export const questionContentSchema = z.string().trim().min(1).max(QUESTION_CONTENT_MAX)

/** 문의에 달린 답변. */
export const productAnswerSchema = z.object({
  questionId: z.uuid(),
  brandName: z.string(),
  content: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type ProductAnswer = z.infer<typeof productAnswerSchema>

/** 문의 한 벌. */
export const productQuestionSchema = z.object({
  id: z.uuid(),
  productId: productIdSchema,
  /** 가려진 이름 (`홍*동`). 리뷰와 같은 규칙으로 서버가 가린다. */
  authorName: z.string(),
  content: z.string(),
  isPublic: z.boolean(),
  /** 이 문의가 **내가 쓴 것**인가. 화면이 「내 문의」 표시를 그리는 자리다. */
  mine: z.boolean(),
  answer: productAnswerSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type ProductQuestion = z.infer<typeof productQuestionSchema>

export const productQuestionResponseSchema = z.object({ question: productQuestionSchema })

export type ProductQuestionResponse = z.infer<typeof productQuestionResponseSchema>

export const QUESTION_LIST_DEFAULT_LIMIT = 10
export const QUESTION_LIST_MAX_LIMIT = 50

export const questionListQueryParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(QUESTION_LIST_MAX_LIMIT).optional(),
})

export type QuestionListQueryParams = z.infer<typeof questionListQueryParamsSchema>

export const questionListResponseSchema = z.object({
  questions: z.array(productQuestionSchema),
  nextCursor: z.string().nullable(),
})

export type QuestionListResponse = z.infer<typeof questionListResponseSchema>

/** `POST /api/v1/products/:id/questions`. */
export const createQuestionRequestSchema = z.object({
  content: questionContentSchema,
  /**
   * 기본값이 **공개**인 이유는 문의가 상품 정보의 일부이기 때문이다 — 같은 것을
   * 궁금해하는 다음 사람이 읽는다. 비공개는 고르는 것이지 기본이 아니다.
   */
  isPublic: z.boolean().default(true),
})

export type CreateQuestionRequest = z.infer<typeof createQuestionRequestSchema>

/** `PUT /api/v1/questions/:id/answer` — 쓰거나 고친다. */
export const writeAnswerRequestSchema = z.object({
  content: z.string().trim().min(1).max(ANSWER_CONTENT_MAX),
})

export type WriteAnswerRequest = z.infer<typeof writeAnswerRequestSchema>

export const answerResponseSchema = z.object({ answer: productAnswerSchema })

export type AnswerResponse = z.infer<typeof answerResponseSchema>

/** 판매자 문의 관리 목록의 한 줄 — 어느 상품의 문의인지가 더해진다. */
export const sellerQuestionSchema = productQuestionSchema.extend({
  productName: z.string(),
})

export type SellerQuestion = z.infer<typeof sellerQuestionSchema>

export const sellerQuestionsQueryParamsSchema = z.object({
  unansweredOnly: z.stringbool().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(QUESTION_LIST_MAX_LIMIT).optional(),
})

export type SellerQuestionsQueryParams = z.infer<typeof sellerQuestionsQueryParamsSchema>

export const sellerQuestionsResponseSchema = z.object({
  questions: z.array(sellerQuestionSchema),
  nextCursor: z.string().nullable(),
  /** 아직 답하지 않은 문의의 수. **필터와 무관하다** — 「할 일이 몇 개」다. */
  unansweredCount: z.int().min(0),
})

export type SellerQuestionsResponse = z.infer<typeof sellerQuestionsResponseSchema>

/** 마이페이지의 「내 문의」 한 줄 — 어느 상품에 물었는지가 더해진다 (F7). */
export const myQuestionSchema = productQuestionSchema.extend({
  productName: z.string(),
  thumbnailUrl: z.string().nullable(),
})

export type MyQuestion = z.infer<typeof myQuestionSchema>

export const myQuestionsResponseSchema = z.object({
  questions: z.array(myQuestionSchema),
  nextCursor: z.string().nullable(),
})

export type MyQuestionsResponse = z.infer<typeof myQuestionsResponseSchema>
