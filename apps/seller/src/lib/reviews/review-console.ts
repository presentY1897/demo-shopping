import type {
  ApiFailure,
  SellerProductReview,
  SellerProductReviewsQueryParams,
} from '@shopping/shared'
import { REVIEW_REPLY_CONTENT_MAX } from '@shopping/shared'
import { z } from 'zod'

/**
 * 리뷰 관리 화면의 순수 판단 — **무엇을 묻고, 그 답을 어떻게 읽는가** (TASK-0085).
 *
 * `lib/settlements/settlement-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는
 * 것들은 **틀려도 조용하다.** 질의에서 `sellerId` 가 빠지면 목록이 비는 것이 아니라
 * 400 으로 돌아오고, 「미답변만」을 켰는데 키가 실리지 않으면 답한 리뷰가 섞인 목록이
 * 그려질 뿐 어느 검사도 빨개지지 않는다 — 판매자는 그 목록을 「답할 것이 없다」로 읽는다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 *
 * ## 이름 — 「판매자 리뷰」가 이 저장소에서 두 가지를 뜻한다
 *
 * `sellers.ts` 의 `SELLER_REVIEW_LIST_*` 는 **입점 심사 대기열**이고, 이 화면은
 * 판매자가 자기 상품에 달린 **상품 리뷰**를 보는 곳이다. 계약이 이름을 길게
 * 쓴 이유가 그것이라(`sellerProductReviewSchema` 의 주석), 여기서도 줄이지 않는다.
 */

/* ------------------------------------------------------------------- 별점 -- */

/** 별 다섯. 계약의 `reviewRatingSchema` 가 1~5 를 보장한다. */
export const RATING_MAX = 5

/**
 * 별점 한 줄, 언제나 **다섯 칸**.
 *
 * 채운 별만 그리면 3점과 5점의 폭이 달라 목록을 세로로 훑을 때 어느 쪽이 낮은지
 * 눈으로 재야 한다. 다섯 칸을 고정하면 빈 칸의 수가 곧 「모자란 만큼」이 된다.
 *
 * **이 문자열은 장식이다.** 화면은 이것을 `aria-hidden` 으로 그리고 옆에 「별점 2점」을
 * 텍스트로 둔다 — 보조 기술에게 별 다섯 개는 「검은 별 흰 별 흰 별…」이지 숫자가 아니다.
 */
export function ratingStars(rating: number): string {
  return `${'★'.repeat(rating)}${'☆'.repeat(RATING_MAX - rating)}`
}

/* ------------------------------------------------------------------- 필터 -- */

/**
 * 필터 바가 들고 있는 것, 둘.
 *
 * **`sellerId` 가 없다.** 판매자는 자기 상품의 리뷰만 보므로 자기 id 는 고르는 축이
 * 아니라 이 목록이 성립하기 위한 조건이고, 그것을 필터로 두면 「전체 스토어」를
 * 고를 수 있는 것처럼 보인다 (`settlement-console.ts` 가 같은 말을 적어 두었다).
 */
export interface SellerReviewFilters {
  /** 아직 답하지 않은 것만. */
  readonly unansweredOnly: boolean
  /** 이 별점 **이하**만. `null` 이 「전체」다. */
  readonly maxRating: number | null
}

export const EMPTY_REVIEW_FILTERS: SellerReviewFilters = { maxRating: null, unansweredOnly: false }

/**
 * 「이 별점 이하」로 고를 수 있는 값들. **5가 없다.**
 *
 * 「5점 이하」는 전체와 똑같은 목록이다. 같은 것을 두 이름으로 고르게 두면 필터가
 * 걸렸는지 아닌지가 화면과 어긋나고 — 빈 목록이 「없다」인지 「이 조건에 없다」인지를
 * 가르는 판단이 그것이다({@link isNarrowed}) — 「조건 지우기」 버튼이 아무것도 바꾸지
 * 않는 날이 온다.
 */
export const MAX_RATING_CHOICES: readonly number[] = [1, 2, 3, 4]

/** 좁혀 놓았는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: SellerReviewFilters): boolean {
  return filters.unansweredOnly || filters.maxRating !== null
}

/**
 * 아직 답하지 않은 리뷰인가.
 *
 * 목록의 줄마다 배지를 다는 근거이고, **뱃지의 근거는 아니다** — 미답변 건수는
 * 서버가 세어 보내고 필터와 무관하다(`sellerProductReviewsResponseSchema`). 보이는
 * 줄로 세면 「미답변만」을 켠 순간 뱃지와 목록이 같은 수를 말하게 되어, 뱃지가 답하려던
 * 「할 일이 몇 개인가」가 「지금 화면에 몇 개인가」로 바뀐다 (F7).
 */
export function isUnanswered(review: SellerProductReview): boolean {
  return review.reply === null
}

/**
 * 필터를 계약의 질의로.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `maxRating=undefined` 를 만들고, `z.coerce.number()` 가 그것을
 * `NaN` 으로 읽어 400 으로 답한다.
 *
 * `limit` 을 싣지 않는다 — 이 화면은 서버의 기본 개수를 그대로 쓴다. 보내지 않는 값을
 * 직렬화하는 가지는 아무도 지나가지 않고, 그런 가지를 커버리지 문턱을 채우려고 두는
 * 것이 이 저장소가 금지하는 일이다.
 */
export function sellerReviewQuery(
  filters: SellerReviewFilters,
  cursor: string | null,
): SellerProductReviewsQueryParams {
  return {
    ...(filters.unansweredOnly ? { unansweredOnly: true } : {}),
    ...(filters.maxRating === null ? {} : { maxRating: filters.maxRating }),
    // **커서는 불투명하다.** 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
    ...(cursor === null ? {} : { cursor }),
  }
}

/**
 * `?sellerId=…&unansweredOnly=true&maxRating=2&cursor=…`.
 *
 * **`sellerId` 를 반드시 싣는다.** `GET /seller-product-reviews` 는 그것 없이 부르면
 * 거절되고, 그 거절이 판매자가 남의 스토어 리뷰를 못 읽게 막는 장치다. 그래서 여기서
 * id 를 빠뜨리면 화면은 「리뷰가 없어요」가 아니라 「불러오지 못했습니다」로 끝난다 —
 * 두 문장은 판매자에게 전혀 다른 뜻이다.
 *
 * 질의를 만드는 일과 문자열로 옮기는 일이 **같은 파일에** 있는 이유가 그것이다:
 * `console-api.ts` 로 내보내면 그 파일은 I/O 를 하므로 분기 100% 문턱에 올릴 수 없고,
 * 그러면 이 저장소에서 가장 조용히 틀릴 수 있는 줄이 문턱 밖에 남는다.
 */
export function reviewSearch(
  sellerId: string,
  filters: SellerReviewFilters,
  cursor: string | null,
): string {
  const query = sellerReviewQuery(filters, cursor)
  const params = new URLSearchParams({ sellerId })

  if (query.unansweredOnly !== undefined) params.set('unansweredOnly', String(query.unansweredOnly))
  if (query.maxRating !== undefined) params.set('maxRating', String(query.maxRating))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  return `?${params.toString()}`
}

/* --------------------------------------------------------------- 답변 폼 -- */

/**
 * 답변 본문 한 칸.
 *
 * **규칙은 `@shopping/shared` 의 것이고 문구만 이 앱의 것이다** —
 * `writeReviewReplyRequestSchema` 가 `apps/api` 가 같은 요청을 검증하는 바로 그
 * 객체이고, 상한도 거기서 온다(`REVIEW_REPLY_CONTENT_MAX`). 그것이 뱉는 말은 zod 의
 * 기본 영어라 판매자에게 보여 줄 것이 못 되고, 그것을 고치는 것은 계약의 일이 아니다
 * (`lib/coupons/coupon-form.ts` 가 같은 이유로 같은 모양이다).
 */
export interface ReplyFieldErrorMessages {
  readonly required: string
  /** `{max}` — 상한은 문장이 아니라 상수에서 온다. */
  readonly tooLong: string
}

/**
 * 답변 폼의 스키마. 칸은 `content` 하나뿐이다.
 *
 * 이름을 상수로 빼 두지 않는다 — `serverFieldErrors` 를 쓰지 않기 때문이다. 이 폼이
 * 만나는 서버 거절(403 · 404)은 어느 칸의 일도 아니라 폼 위의 오류 상자로 가고
 * (`review-reply-form.tsx`), 칸 이름을 두 곳에 적으면 그중 하나가 낡는다.
 */
export function reviewReplyFormSchema(messages: ReplyFieldErrorMessages) {
  const tooLong = messages.tooLong.replace('{max}', String(REVIEW_REPLY_CONTENT_MAX))

  return z.object({
    content: z.string().trim().min(1, messages.required).max(REVIEW_REPLY_CONTENT_MAX, tooLong),
  })
}

/* ----------------------------------------------------------------- 거절 -- */

/**
 * 답변 쓰기·지우기가 거절되는 세 가지 방식 (TASK-0085 F2).
 *
 * | | 언제 | 판매자가 할 일 |
 * | --- | --- | --- |
 * | `forbidden` | 남의 스토어 상품에 달린 리뷰다 | 없다 — 자기 목록에서는 열리지 않아야 하는 길이다 |
 * | `gone` | 리뷰나 답변이 그 사이에 사라졌다 | 목록을 다시 읽는다 |
 * | `other` | 그 밖의 실패 | 카탈로그가 코드로 답한다 |
 *
 * **`forbidden` 은 이 화면에서 평소에 닿지 않는다.** 목록이 자기 스토어의 리뷰만
 * 실어 오기 때문이다. 그래도 문장이 있어야 하는 이유는 목록과 쓰기 사이에 시간이
 * 있기 때문이고 — 스토어가 넘어가거나 상품이 옮겨 가는 일이 없다고 말할 수 있는
 * 사람은 화면이 아니다 — 문장이 없으면 그 순간 서버의 「review.reply 퍼미션으로 접근할
 * 수 없는 리소스입니다」가 그대로 판매자에게 나간다.
 *
 * 코드가 아니라 **상태**로 가른다. 두 거절은 도메인 코드를 갖지 않고
 * `FORBIDDEN` · `NOT_FOUND` 로 오는데, 그 코드는 상태에서 파생된 값이다
 * (`http-error-code.ts`). `store-failures.ts` 가 같은 이유로 404 를 상태로 읽는다.
 */
export const replyRefusals = ['forbidden', 'gone', 'other'] as const

export type ReplyRefusal = (typeof replyRefusals)[number]

export function replyRefusalOf(failure: ApiFailure): ReplyRefusal {
  // 아무것도 도착하지 않았다. 상태가 없으므로 가를 것도 없다.
  if (failure.kind !== 'http') return 'other'
  if (failure.status === 403) return 'forbidden'
  if (failure.status === 404) return 'gone'

  return 'other'
}
