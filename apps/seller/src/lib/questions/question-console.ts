import type { ApiFailure, SellerQuestion, SellerQuestionsQueryParams } from '@shopping/shared'
import { ANSWER_CONTENT_MAX } from '@shopping/shared'
import { z } from 'zod'

/**
 * 문의 관리 화면의 순수 판단 — **무엇을 묻고, 그 답을 어떻게 읽는가** (TASK-0088).
 *
 * **`lib/reviews/review-console.ts` 를 그대로 옮긴 것이다.** 이 화면은 리뷰 관리와
 * *같은 화면*이고 대상만 다르다: 미답변이 위에 오는 목록, 「미답변만」 하나짜리 필터,
 * 줄 안에서 열리는 답변 편집기, 커서 페이지네이션, 그리고 필터와 무관한 미답변 건수.
 * 몇 시간 전에 놓인 그 규약을 여기서 다시 발명하지 않는다 — 두 번째 규약이 생기면
 * 「판매자가 답을 쓰는 화면」이 이 콘솔에 두 종류가 되고, 그 둘은 반드시 갈린다.
 *
 * 여기 있는 것들은 **틀려도 조용하다.** 질의에서 `sellerId` 가 빠지면 목록이 비는
 * 것이 아니라 400 으로 돌아오고, 「미답변만」을 켰는데 키가 실리지 않으면 답한
 * 문의가 섞인 목록이 그려질 뿐 어느 검사도 빨개지지 않는다 — 판매자는 그 목록을
 * 「답할 것이 없다」로 읽는다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* ------------------------------------------------------------------- 필터 -- */

/**
 * 필터 바가 들고 있는 것, **하나**.
 *
 * 리뷰 쪽에는 축이 둘이고(미답변 · 평점 이하) 여기는 하나다. 문의에는 별점이 없고,
 * 계약이 판매자 목록에 허용하는 축도 `unansweredOnly` 뿐이기 때문이다
 * (`sellerQuestionsQueryParamsSchema`). **공개/비공개는 필터가 아니다** — 판매자가
 * 이 화면에 오는 이유는 「답할 것 찾기」이고, 비공개 문의도 똑같이 답해야 하는
 * 것이라 그 축으로 목록을 가르면 할 일이 두 화면으로 쪼개진다 (4.2).
 *
 * **`sellerId` 가 없다.** 판매자는 자기 상품의 문의만 보므로 자기 id 는 고르는 축이
 * 아니라 이 목록이 성립하기 위한 조건이고, 그것을 필터로 두면 「전체 스토어」를
 * 고를 수 있는 것처럼 보인다 (`review-console.ts` 가 같은 말을 적어 두었다).
 */
export interface SellerQuestionFilters {
  /** 아직 답하지 않은 것만. */
  readonly unansweredOnly: boolean
}

export const EMPTY_QUESTION_FILTERS: SellerQuestionFilters = { unansweredOnly: false }

/** 좁혀 놓았는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: SellerQuestionFilters): boolean {
  return filters.unansweredOnly
}

/**
 * 아직 답하지 않은 문의인가.
 *
 * 목록의 줄마다 배지를 다는 근거이고, **뱃지의 근거는 아니다** — 미답변 건수는
 * 서버가 세어 보내고 필터와 무관하다(`sellerQuestionsResponseSchema`). 보이는
 * 줄로 세면 「미답변만」을 켠 순간 뱃지와 목록이 같은 수를 말하게 되어, 뱃지가
 * 답하려던 「할 일이 몇 개인가」가 「지금 화면에 몇 개인가」로 바뀐다.
 */
export function isUnanswered(question: SellerQuestion): boolean {
  return question.answer === null
}

/**
 * 필터를 계약의 질의로.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `unansweredOnly=undefined` 를 만들고, `z.stringbool()` 이
 * 그것을 읽지 못해 400 으로 답한다.
 *
 * `limit` 을 싣지 않는다 — 이 화면은 서버의 기본 개수를 그대로 쓴다. 보내지 않는
 * 값을 직렬화하는 가지는 아무도 지나가지 않고, 그런 가지를 커버리지 문턱을 채우려고
 * 두는 것이 이 저장소가 금지하는 일이다.
 */
export function sellerQuestionQuery(
  filters: SellerQuestionFilters,
  cursor: string | null,
): SellerQuestionsQueryParams {
  return {
    ...(filters.unansweredOnly ? { unansweredOnly: true } : {}),
    // **커서는 불투명하다.** 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
    ...(cursor === null ? {} : { cursor }),
  }
}

/**
 * `?sellerId=…&unansweredOnly=true&cursor=…`.
 *
 * **`sellerId` 를 반드시 싣는다.** `GET /seller-questions` 는 그것 없이 부르면
 * 거절되고, 그 거절이 판매자가 남의 스토어 문의를 못 읽게 막는 장치다. 그래서 여기서
 * id 를 빠뜨리면 화면은 「문의가 없어요」가 아니라 「불러오지 못했습니다」로 끝난다 —
 * 두 문장은 판매자에게 전혀 다른 뜻이다.
 *
 * 질의를 만드는 일과 문자열로 옮기는 일이 **같은 파일에** 있는 이유가 그것이다:
 * `console-api.ts` 로 내보내면 그 파일은 I/O 를 하므로 분기 100% 문턱에 올릴 수 없고,
 * 그러면 이 저장소에서 가장 조용히 틀릴 수 있는 줄이 문턱 밖에 남는다.
 */
export function questionSearch(
  sellerId: string,
  filters: SellerQuestionFilters,
  cursor: string | null,
): string {
  const query = sellerQuestionQuery(filters, cursor)
  const params = new URLSearchParams({ sellerId })

  if (query.unansweredOnly !== undefined) params.set('unansweredOnly', String(query.unansweredOnly))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  return `?${params.toString()}`
}

/* --------------------------------------------------------------- 답변 폼 -- */

/**
 * 답변 본문 한 칸.
 *
 * **규칙은 `@shopping/shared` 의 것이고 문구만 이 앱의 것이다** —
 * `writeAnswerRequestSchema` 가 `apps/api` 가 같은 요청을 검증하는 바로 그 객체이고,
 * 상한도 거기서 온다(`ANSWER_CONTENT_MAX`). 그것이 뱉는 말은 zod 의 기본 영어라
 * 판매자에게 보여 줄 것이 못 되고, 그것을 고치는 것은 계약의 일이 아니다
 * (`lib/reviews/review-console.ts` 가 같은 이유로 같은 모양이다).
 */
export interface AnswerFieldErrorMessages {
  readonly required: string
  /** `{max}` — 상한은 문장이 아니라 상수에서 온다. */
  readonly tooLong: string
}

/**
 * 답변 폼의 스키마. 칸은 `content` 하나뿐이다.
 *
 * 이름을 상수로 빼 두지 않는다 — `serverFieldErrors` 를 쓰지 않기 때문이다. 이 폼이
 * 만나는 서버 거절(403 · 404)은 어느 칸의 일도 아니라 폼 위의 오류 상자로 가고
 * (`question-answer-form.tsx`), 칸 이름을 두 곳에 적으면 그중 하나가 낡는다.
 */
export function questionAnswerFormSchema(messages: AnswerFieldErrorMessages) {
  const tooLong = messages.tooLong.replace('{max}', String(ANSWER_CONTENT_MAX))

  return z.object({
    content: z.string().trim().min(1, messages.required).max(ANSWER_CONTENT_MAX, tooLong),
  })
}

/* ----------------------------------------------------------------- 거절 -- */

/**
 * 답변 쓰기·지우기가 거절되는 세 가지 방식 (TASK-0088 F3).
 *
 * | | 언제 | 판매자가 할 일 |
 * | --- | --- | --- |
 * | `forbidden` | 남의 스토어 상품에 달린 문의다 | 없다 — 자기 목록에서는 열리지 않아야 하는 길이다 |
 * | `gone` | 문의나 답변이 그 사이에 사라졌다 | 목록을 다시 읽는다 |
 * | `other` | 그 밖의 실패 | 카탈로그가 코드로 답한다 |
 *
 * **`forbidden` 은 이 화면에서 평소에 닿지 않는다.** 목록이 자기 스토어의 문의만
 * 실어 오기 때문이다. 그래도 문장이 있어야 하는 이유는 목록과 쓰기 사이에 시간이
 * 있기 때문이고 — 스토어가 넘어가거나 상품이 옮겨 가는 일이 없다고 말할 수 있는
 * 사람은 화면이 아니다 — 문장이 없으면 그 순간 서버의 「question.answer 퍼미션으로
 * 접근할 수 없는 리소스입니다」가 그대로 판매자에게 나간다.
 *
 * 코드가 아니라 **상태**로 가른다. 두 거절은 도메인 코드를 갖지 않고
 * `FORBIDDEN` · `NOT_FOUND` 로 오는데, 그 코드는 상태에서 파생된 값이다
 * (`http-error-code.ts`).
 */
export const answerRefusals = ['forbidden', 'gone', 'other'] as const

export type AnswerRefusal = (typeof answerRefusals)[number]

export function answerRefusalOf(failure: ApiFailure): AnswerRefusal {
  // 아무것도 도착하지 않았다. 상태가 없으므로 가를 것도 없다.
  if (failure.kind !== 'http') return 'other'
  if (failure.status === 403) return 'forbidden'
  if (failure.status === 404) return 'gone'

  return 'other'
}
