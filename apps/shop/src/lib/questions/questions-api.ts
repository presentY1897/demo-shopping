import type {
  ApiCallOptions,
  CreateQuestionRequest,
  MyQuestionsResponse,
  ProductQuestionResponse,
  QuestionListResponse,
} from '@shopping/shared'
import {
  myQuestionsResponseSchema,
  productQuestionResponseSchema,
  questionListResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 상품 문의가 부르는 라우트들 (TASK-0088).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 전부 계약 스키마로 파싱한다.
 *
 * ## 목록도 세션이 붙은 클라이언트로 부른다
 *
 * `GET /products/:id/questions` 는 로그인하지 않아도 열리지만(`@PublicEndpoint()`),
 * **누가 부르느냐에 따라 오는 줄이 다르다.** 내 비공개 문의는 나에게만 오고
 * `mine` 도 부르는 사람에 따라 달라진다 — `getPublicApiClient()` 로 부르면 로그인한
 * 사람이 자기가 방금 남긴 비공개 문의를 못 보게 된다. 리뷰의 `helpfulByMe` 가 같은
 * 이유로 같은 클라이언트를 쓴다.
 *
 * ## 남의 비공개 문의는 **줄 자체가 오지 않는다**
 *
 * 내용을 비우고 보내는 길도 있었지만 그러면 「여기 뭔가 있다」가 새어 나가고, 그
 * 사실만으로도 알아서는 안 될 것을 알게 되는 경우가 있다(`questions.ts` 의 머리말).
 * 그래서 **화면은 받지 못한 줄에 「비공개 문의입니다」 자리를 만들지 않는다** — 만들면
 * 서버가 감춘 것을 화면이 세어 보여 주는 셈이 된다.
 */

/**
 * 이 상품의 문의 한 쪽.
 *
 * 질의를 문자열로 조립하지 않고 `URLSearchParams` 에 담는 이유는 **빈 값을 보내지
 * 않기 위해서**다. `?cursor=` 는 「처음부터」가 아니라 빈 문자열이다.
 */
export function fetchProductQuestions(
  productId: string,
  cursor: string | null,
  limit: number,
  options?: ApiCallOptions,
): Promise<QuestionListResponse> {
  const search = new URLSearchParams({ limit: String(limit) })

  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/products/${encodeURIComponent(productId)}/questions?${search.toString()}`,
    schema: questionListResponseSchema,
    ...options,
  })
}

/**
 * 문의를 남긴다 (F1).
 *
 * **답이 만들어진 문의를 통째로 싣는다.** 그래서 화면은 쓰고 나서 목록을 다시 읽지
 * 않고 그 줄을 맨 앞에 끼워 넣는다 — 다시 읽으면 비공개로 남긴 문의가 다음 장으로
 * 밀려 **방금 쓴 것이 화면에서 사라진다.**
 */
export function askQuestion(
  productId: string,
  body: CreateQuestionRequest,
  options?: ApiCallOptions,
): Promise<ProductQuestionResponse> {
  return getApiClient().request({
    path: `/products/${encodeURIComponent(productId)}/questions`,
    method: 'POST',
    body,
    schema: productQuestionResponseSchema,
    ...options,
  })
}

/** 내가 남긴 문의 — 비공개든 아니든 전부 내 것이다 (F7). */
export function fetchMyQuestions(
  cursor: string | null,
  limit: number,
  options?: ApiCallOptions,
): Promise<MyQuestionsResponse> {
  const search = new URLSearchParams({ limit: String(limit) })

  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/me/questions?${search.toString()}`,
    schema: myQuestionsResponseSchema,
    ...options,
  })
}
