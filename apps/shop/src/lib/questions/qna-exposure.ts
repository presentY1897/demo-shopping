import type { DensityLevel } from '@shopping/ui'
import { QUESTION_LIST_DEFAULT_LIMIT } from '@shopping/shared'

/**
 * 밀도가 문의를 얼마나 보이는가 (TASK-0088 F6).
 *
 * | | 미니멀 | 표준 | 맥시멀 |
 * | --- | --- | --- | --- |
 * | 목록 | 접힘 | 접힘 | 처음부터 |
 * | 펼쳤을 때 | 5건 | 10건 | 10건 |
 *
 * **「맥시멀에서만 목록을 노출」이 F6 의 문장이고, 그것이 `open` 한 칸이다.** 문서가
 * 그렇게 정한 이유는 4장에 있다 — 미니멀 상품 페이지에 문의 목록이 붙으면 정보
 * 밀도가 올라가 밀도 구분 자체가 흐려진다. 표준·미니멀에서는 「링크나 접힘」이고,
 * 이 저장소에 문의 전용 라우트가 없으므로(`docs/design/pages.md` 의 shop 페이지 표)
 * 그 링크는 **그 자리에서 펴는 버튼**이다. 리뷰가 같은 판단을 같은 이유로 한다
 * (`lib/reviews/exposure.ts`).
 *
 * **갈래가 아니라 조회다.** `Record<DensityLevel, …>` 이므로 밀도가 넷이 되는 날
 * `pnpm typecheck` 이 여기서 멈춘다 — `if` 로 적었다면 넷째 단계는 조용히 표준처럼
 * 그려졌을 것이다.
 *
 * **문의를 쓰는 자리는 세 단계 모두에 있다.** 접히는 것은 남이 쓴 것을 읽는 일이고,
 * 자기가 묻는 일은 밀도와 무관하다 — 미니멀을 고른 사람도 물어볼 것이 있다.
 */

export interface QuestionExposure {
  /** 목록을 처음부터 보이는가. **맥시멀만 참이다** (F6). */
  readonly open: boolean
  /** 펼쳤을 때 한 번에 보이는 문의 수. */
  readonly count: number
}

const EXPOSURE: Readonly<Record<DensityLevel, QuestionExposure>> = {
  1: { open: false, count: 5 },
  2: { open: false, count: QUESTION_LIST_DEFAULT_LIMIT },
  3: { open: true, count: QUESTION_LIST_DEFAULT_LIMIT },
}

export function questionExposure(density: DensityLevel): QuestionExposure {
  return EXPOSURE[density]
}

/**
 * 한 번에 받아 오는 문의의 수 — **가장 많은 단계의 수**.
 *
 * 밀도를 바꿀 때마다 다시 받으면 전환이 느려지고 캐시가 세 벌이 된다. 받는 양은
 * 밀도와 무관하게 하나로 두고, **밀도는 그중 몇 개를 보일지만 정한다** (리뷰의
 * `REVIEW_PAGE_SIZE` 와 같은 규칙).
 */
export const QUESTION_PAGE_SIZE = EXPOSURE[3].count
