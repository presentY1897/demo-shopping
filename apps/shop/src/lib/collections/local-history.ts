import type { MergeRecentlyViewedRequest, RecentlyViewedItem } from '@shopping/shared'
import { RECENTLY_VIEWED_MERGE_MAX, recentlyViewedItemSchema } from '@shopping/shared'
import { z } from 'zod'

/**
 * 로그인하지 않은 사람의 「최근 본 상품」 (TASK-0087 F6).
 *
 * ## 왜 브라우저가 이것을 들고 있나
 *
 * 서버는 **로그인한 사람의 상세 조회만** 기록한다. 로그인하지 않은 사람에게도 이력이
 * 필요한 이유는 그 사람이 나중에 로그인하기 때문이다 — 둘러보다 계정을 만든 사람의
 * 「최근 본 상품」이 비어 있으면, 방금 30분 동안 한 일이 없던 일이 된다.
 *
 * ## 이 파일은 저장소를 만지지 않는다
 *
 * `localStorage` 는 없을 수도, 던질 수도, 남의 브라우저에서 이상한 것이 들어 있을
 * 수도 있는 자리다. 그 세 가지는 훅이 감당하고(`use-recently-viewed.ts`), 여기서는
 * **문자열 하나를 목록으로 읽는 일**과 **목록을 다루는 일**만 한다. 순수하므로 화면을
 * 그리지 않고 부르는 것만으로 검사할 수 있다 (리뷰의 `review-draft.ts` 와 같은 결).
 *
 * ## 읽은 것을 계약 스키마로 거른다
 *
 * 브라우저에 남아 있는 것은 **우리가 지난번에 적은 값이라는 보장이 없다.** 다른
 * 배포의 옛 모양일 수도 있고 사람이 직접 고쳤을 수도 있다. `recentlyViewedItemSchema`
 * 를 지나게 하면 그 순간 이 목록은 서버가 보낼 수 있는 모양과 같아지고, 그래서
 * 화면이 로그인 전후로 같은 컴포넌트를 쓸 수 있다.
 *
 * ## 자르는 수가 `RECENTLY_VIEWED_MERGE_MAX` 인 이유
 *
 * 이 목록이 마지막에 하는 일은 **병합 요청이 되는 것**이고, 계약이 그 요청을 50개로
 * 묶는다(`mergeRecentlyViewedRequestSchema`). 더 들고 있어 봐야 보낼 때 잘리므로,
 * 잘리는 자리를 저장할 때로 앞당긴다 — 그래야 화면에 보이는 목록과 로그인 뒤에 남는
 * 목록이 같다.
 */

const localHistorySchema = z.array(recentlyViewedItemSchema)

/** 최근 것이 앞. 순서를 저장에 맡기지 않는 이유는 병합이 순서를 흩뜨리기 때문이다. */
function newestFirst(items: readonly RecentlyViewedItem[]): RecentlyViewedItem[] {
  return [...items].sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt))
}

/**
 * 저장된 문자열을 목록으로. 읽을 수 없으면 **빈 목록**이지 오류가 아니다.
 *
 * 이력을 읽지 못하는 것은 사람이 할 일이 있는 실패가 아니다 — 스트립 하나가 안 보일
 * 뿐이고, 그 자리에 「이력을 불러오지 못했습니다」를 그리면 아무도 고칠 수 없는
 * 문장이 홈 화면에 남는다.
 */
export function parseLocalHistory(raw: string | null): readonly RecentlyViewedItem[] {
  if (raw === null) return []

  let decoded: unknown

  try {
    decoded = JSON.parse(raw)
  } catch {
    return []
  }

  const read = localHistorySchema.safeParse(decoded)

  return read.success ? newestFirst(read.data).slice(0, RECENTLY_VIEWED_MERGE_MAX) : []
}

/**
 * 방금 본 상품을 이력에 넣는다.
 *
 * **같은 상품은 한 줄이고, 더 최근 쪽이 이긴다.** 서버의 병합이 같은 규칙이라
 * (`mergeRecentlyViewedRequestSchema` 의 머리말) 로그인 전후로 목록이 같은 방식으로
 * 움직인다. 여기서 「지금 본 것이 언제나 이긴다」로 두면, 이력을 두 탭에서 만지는
 * 순간 옛 기록이 새 기록을 뒤로 미는 일이 생긴다.
 */
export function recordLocalView(
  history: readonly RecentlyViewedItem[],
  item: RecentlyViewedItem,
  max: number = RECENTLY_VIEWED_MERGE_MAX,
): readonly RecentlyViewedItem[] {
  const held = history.find((entry) => entry.productId === item.productId)
  const others = history.filter((entry) => entry.productId !== item.productId)
  const kept =
    held !== undefined && Date.parse(held.viewedAt) > Date.parse(item.viewedAt) ? held : item

  return newestFirst([kept, ...others]).slice(0, max)
}

/**
 * 로그인한 순간 서버로 보낼 것 — 비어 있으면 `null` (F6).
 *
 * `null` 이 「보내지 않는다」인 이유는 계약이 **한 개 이상**을 요구하기 때문이다
 * (`min(1)`). 빈 배열을 보내면 400 이 돌아오고, 그 400 은 아무 일도 없었다는 사실을
 * 실패처럼 보이게 한다.
 *
 * 상품 이름과 가격은 싣지 않는다. 서버는 id 로 지금 값을 다시 읽고, **모르는 상품은
 * 건너뛴다** — 브라우저에 남아 있던 옛 이름을 우리가 보낼 이유가 없다.
 */
export function mergeRequest(
  history: readonly RecentlyViewedItem[],
): MergeRecentlyViewedRequest | null {
  const items = newestFirst(history)
    .slice(0, RECENTLY_VIEWED_MERGE_MAX)
    .map((entry) => ({ productId: entry.productId, viewedAt: entry.viewedAt }))

  return items.length === 0 ? null : { items }
}
