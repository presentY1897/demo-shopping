import type { AnswerResponse, SellerQuestionsResponse } from '@shopping/shared'
import { answerResponseSchema, sellerQuestionsResponseSchema } from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'

/**
 * 판매자 콘솔이 상품 문의에 대해 부르는 세 자리, 한 곳에 (TASK-0088).
 *
 * **`lib/reviews/console-api.ts` 와 같은 모양이다**, 그리고 그것이 의도다 — 두 화면이
 * 계약에 대해 같은 규약을 쓴다. 지켜지는 성질도 같다: **경로와 스키마가 한 번씩만
 * 적힌다.** 화면은 응답의 모양을 다시 선언하지 않는다 (게이트 C1).
 *
 * ## 목록만 `sellerId` 를 받는다
 *
 * | 라우트 | `sellerId` | 왜 |
 * | --- | --- | --- |
 * | `GET /seller-questions` | **반드시 보낸다** | 없으면 요청이 거절된다. 그 거절이 남의 스토어를 막는 장치다 |
 * | `PUT /questions/:id/answer` | 경로에 없다 | 문의가 이미 상품을, 상품이 스토어를 가리킨다 — 서버가 거기서 소유권을 판정한다 (F3) |
 * | `DELETE /questions/:id/answer` | 위와 같다 | |
 *
 * 쓰기가 id 를 받지 않는 것이 **더 안전하다.** 요청이 주인을 말할 수 있으면 언젠가
 * 다른 주인이 실리고, 그때 막는 것은 서버의 대조 하나뿐이다. 아예 말할 수 없으면
 * 그 대조가 필요 없다.
 *
 * ## 답변을 쓰는 문이 **하나**다
 *
 * 문의당 답변이 하나이고 그것을 기본키가 만든다(`ProductAnswer.questionId`). 그래서
 * 「처음 쓴다」와 「고친다」는 서버에서 같은 일이고(`upsert`), 계약이 `PUT` 하나로
 * 답한다 (4.3). 화면에 「작성」과 「수정」 두 함수를 두면 둘이 같은 곳으로 가는
 * 이유를 다음 사람이 먼저 알아내야 한다.
 */

/**
 * 몸통 없는 대답.
 *
 * `DELETE /questions/:id/answer` 는 204 다. `createApiClient` 의 `readJson` 이 빈
 * 몸통을 `undefined` 로 돌려주므로 **그것이 이 응답의 실제 모양**이고, 아무 스키마나
 * 넘겨 놓으면 파싱이 조용히 실패한다 — 스키마는 생략할 수 있는 인자가 아니다
 * (`lib/reviews/console-api.ts` 가 같은 상수를 같은 이유로 둔다).
 */
const noContentSchema = z.undefined()

/**
 * 이 스토어의 상품에 달린 문의 한 페이지와 **미답변 건수**.
 *
 * 질의 문자열은 `question-console.ts` 의 `questionSearch` 가 만든다 — `sellerId` 가
 * 실리는 자리를 분기 100% 문턱 안에 두기 위해서다.
 *
 * **미답변이 위에 오도록 다시 정렬하지 않는다** (F5). 서버가 「답변 여부, id」 두
 * 축으로 정렬해 보내고(`question.service.ts` 의 `unansweredFirst`), 화면이 한 번 더
 * 정렬하면 그 순서는 **이 페이지 안에서만** 참이 된다 — 커서 목록에서 클라이언트
 * 정렬은 페이지 경계에서 반드시 거짓말을 한다.
 *
 * **비공개 문의도 여기로 온다** (4.2). 가리는 대상은 제3자이지 판매자가 아니다 —
 * 답할 사람이 읽지 못하면 비공개 문의라는 것이 성립하지 않는다.
 */
export function fetchSellerQuestions(
  search: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerQuestionsResponse> {
  return getApiClient().request({
    path: `/seller-questions${search}`,
    schema: sellerQuestionsResponseSchema,
    ...options,
  })
}

/** 답변을 **쓰거나 고친다**. 두 번째 답변이 저장될 자리가 없으므로 같은 일이다 (4.3). */
export function writeQuestionAnswer(questionId: string, content: string): Promise<AnswerResponse> {
  return getApiClient().request({
    path: `/questions/${questionId}/answer`,
    method: 'PUT',
    body: { content },
    schema: answerResponseSchema,
  })
}

/**
 * 답변을 지운다. **문의는 남는다.**
 *
 * 없던 답변을 지우면 404 다 — 화면이 열려 있는 동안 다른 탭에서 지웠을 때 오는
 * 답이고, 그때 할 일은 목록을 다시 읽는 것이다 (`answerRefusalOf`).
 */
export async function deleteQuestionAnswer(questionId: string): Promise<void> {
  await getApiClient().request({
    path: `/questions/${questionId}/answer`,
    method: 'DELETE',
    schema: noContentSchema,
  })
}
