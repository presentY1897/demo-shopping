import type { DensityLevel } from '@shopping/ui'

/**
 * 밀도가 리뷰를 얼마나 보이는가 (TASK-0084 4장 · F5).
 *
 * | | 미니멀 | 표준 | 맥시멀 |
 * | --- | --- | --- | --- |
 * | 평점 | 숫자만 | 별점 + 개수 | 별점 + 분포 그래프 |
 * | 리뷰 | 링크만 | 3건 | 5건 + 사진 갤러리 |
 *
 * **표가 유일한 출처다.** 컴포넌트가 `density === 3 ? 5 : 3` 을 적으면 그 숫자가
 * 화면마다 흩어지고, 표가 바뀌는 날 어디를 고쳐야 하는지 아무도 모른다 — 상품 카드가
 * 같은 이유로 열 수를 CSS 변수 하나에서만 읽는다(`pages.md` 밀도 × 뷰포트).
 *
 * **갈래가 아니라 조회다.** `Record<DensityLevel, …>` 이므로 밀도가 넷이 되는 날
 * `pnpm typecheck` 이 여기서 멈춘다. `if` 로 적었다면 넷째 단계는 조용히 표준처럼
 * 그려졌을 것이다.
 *
 * ## 미니멀의 「링크만」
 *
 * `pages.md` 는 미니멀에 링크만 두라고 적었고, 이 저장소에 **리뷰 전용 라우트는
 * 없다**(`docs/design/pages.md` 의 shop 페이지 표). 그래서 링크는 다른 화면이 아니라
 * **그 자리에서 목록을 펼치는 버튼**이다 — 없는 라우트를 만들면 그것은 계약에도
 * 설계 문서에도 없는 화면이 된다. 펼친 뒤의 노출량은 표준과 같은 3건이고, 그 값이
 * `count` 에 미니멀에도 적혀 있는 이유가 이것이다.
 */

/** 평점을 어떻게 그리는가. */
export type RatingDisplay =
  /** 숫자만 — 「4.4」 */
  | 'score'
  /** 별점 + 리뷰 수 */
  | 'stars'
  /** 별점 + 별점별 분포 그래프 */
  | 'distribution'

export interface ReviewExposure {
  readonly rating: RatingDisplay
  /** 목록을 처음부터 보이는가, 아니면 펼치는 버튼만 두는가. */
  readonly collapsed: boolean
  /** 펼쳤을 때 한 번에 보이는 리뷰 수. */
  readonly count: number
  /** 사진 리뷰 갤러리를 함께 그리는가. */
  readonly gallery: boolean
}

const EXPOSURE: Readonly<Record<DensityLevel, ReviewExposure>> = {
  1: { rating: 'score', collapsed: true, count: 3, gallery: false },
  2: { rating: 'stars', collapsed: false, count: 3, gallery: false },
  3: { rating: 'distribution', collapsed: false, count: 5, gallery: true },
}

export function reviewExposure(density: DensityLevel): ReviewExposure {
  return EXPOSURE[density]
}

/**
 * 한 번에 받아 오는 리뷰의 수 — **가장 많은 단계의 수**.
 *
 * 밀도를 바꿀 때마다 다시 받으면 전환이 느려지고 캐시가 세 벌이 된다
 * (`pages.md` — 상품 카드의 같은 판단). 그래서 받는 양은 밀도와 무관하게 하나로 두고,
 * **밀도는 그중 몇 개를 보일지만 정한다.**
 */
export const REVIEW_PAGE_SIZE = EXPOSURE[3].count
