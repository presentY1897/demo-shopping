import { allocate } from '@shopping/shared'

/**
 * 리뷰 목록의 순수 판단 (TASK-0084).
 *
 * 정렬 축과 커서, 그리고 평점 분포. 셋 다 **화면이 다시 계산하면 갈라지는** 것들이고,
 * 그래서 서버가 정해 내려보낸다.
 */

/**
 * 리뷰를 늘어놓는 세 가지 축.
 *
 * **「낮은 평점 순」이 없다.** 넣지 않은 이유는 그 정렬이 목록의 뜻을 바꾸기
 * 때문이다 — 위에서부터 읽는 사람에게 별 하나가 먼저 보이는 목록은 「이 상품의
 * 리뷰」가 아니라 「이 상품의 불만」이 된다. 필요하면 신고·문의가 답할 일이고,
 * 그 판단은 이 TASK 가 정할 것이 아니다.
 */
export const reviewSortKeys = ['latest', 'rating', 'helpful'] as const

export type ReviewSortKey = (typeof reviewSortKeys)[number]

/**
 * 커서가 가리키는 **정렬 축 위의 위치**. 행이 아니다.
 *
 * `rank` 가 축마다 다른 값을 담는다 — 최신순이면 쓰지 않고(0), 평점순이면 별,
 * 도움순이면 도움 수다. 축을 함께 굳히지 않으면 정렬을 바꾼 채 커서를 넘겼을 때
 * 아무 뜻도 없는 자리에서 목록이 열린다.
 */
export interface ReviewCursor {
  readonly rank: number
  readonly id: string
}

const CURSOR_PATTERN =
  /^(?<rank>\d+)\.(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/**
 * 위치를 커서로.
 *
 * base64url 로 감싸는 것은 **클라이언트가 해석하지 못하게** 하기 위해서다
 * (`claims/claim-console.ts` 가 같은 이유로 같은 모양이다). 위조는 가능하지만
 * 서명이 아니고, 그 요청이 할 수 있는 최악은 자기 목록을 이상한 자리에서 여는
 * 것뿐이다 — 리뷰는 어차피 공개다.
 */
export function encodeReviewCursor(cursor: ReviewCursor): string {
  return Buffer.from(`${String(cursor.rank)}.${cursor.id}`, 'utf8').toString('base64url')
}

/**
 * 커서를 위치로. **모양이 아니면 `null`** 이고, 부르는 쪽이 400 으로 돌려보낸다.
 *
 * 조용히 첫 페이지로 되돌리지 않는다 — 그러면 커서가 깨진 화면이 「1페이지를 무한히
 * 반복」하고, 그 증상은 아무 오류도 내지 않는다.
 */
export function decodeReviewCursor(value: string): ReviewCursor | null {
  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  const groups = CURSOR_PATTERN.exec(decoded)?.groups

  if (groups === undefined) return null

  return { rank: Number(groups.rank), id: String(groups.id) }
}

/** 이 리뷰의 정렬 축 위 위치. 축을 아는 곳이 한 곳이어야 커서와 정렬이 갈리지 않는다. */
export function rankOf(
  sort: ReviewSortKey,
  review: { rating: number; helpfulCount: number },
): number {
  if (sort === 'rating') return review.rating
  if (sort === 'helpful') return review.helpfulCount

  // 최신순의 축은 id 하나뿐이다. 0 은 「쓰지 않는 칸」이지 값이 아니다.
  return 0
}

/** 별점 하나의 몫. */
export interface RatingBucket {
  readonly rating: number
  readonly count: number
  /** 백분율. **다섯을 더하면 정확히 100** 이다 (리뷰가 하나라도 있으면). */
  readonly percentage: number
}

/**
 * 별점 분포 (F1).
 *
 * **비율의 합이 100이 되게 맞춘다.** 각자 반올림하면 99나 101이 나오고, 그 화면은
 * 고장으로 보인다. 남는 몫을 가장 큰 칸에 몰아주는 규칙은 금액 안분과 **같은
 * 함수**를 쓴다 (`pricing.md` 2장) — 「잔여를 버리지 않는다」가 원이든 퍼센트든
 * 같은 문제이고, 규칙이 두 벌이면 언젠가 서로 다르게 반올림한다.
 *
 * 리뷰가 없으면 다섯 칸 모두 0이다. 비율을 20%씩 나눠 주는 것이 아니라 — 없는 것을
 * 균등하다고 말하면 「별 하나가 20%인 상품」으로 읽힌다.
 */
export function ratingDistribution(
  counts: Readonly<Record<number, number>>,
): readonly RatingBucket[] {
  const buckets = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: counts[rating] ?? 0 }))
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const shares = allocate(
    total === 0 ? 0 : 100,
    buckets.map((bucket) => ({ item: bucket, weight: bucket.count })),
  )

  return shares.map((share) => ({
    rating: share.item.rating,
    count: share.item.count,
    percentage: share.amount,
  }))
}

/**
 * 평균을 **100배 정수**로 (F2).
 *
 * 이 스키마에는 부동소수 컬럼이 없고, 평점이 그 첫 번째가 될 이유는 없다
 * (`Product.ratingAvg` 의 주석). 4.35는 435다.
 *
 * 리뷰가 없으면 0이다 — `Product_rating_check` 가 「개수가 0이면 평균도 0」을
 * 요구하므로, 여기서 다른 값을 내면 저장 자체가 실패한다.
 */
export function ratingAverage(counts: Readonly<Record<number, number>>): number {
  const entries = [1, 2, 3, 4, 5].map((rating) => ({ rating, count: counts[rating] ?? 0 }))
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  if (total === 0) return 0

  const sum = entries.reduce((acc, entry) => acc + entry.rating * entry.count, 0)

  return Math.round((sum * 100) / total)
}
