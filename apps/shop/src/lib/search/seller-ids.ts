import { SEARCH_SELLER_IDS_MAX } from '@shopping/shared'
import { z } from 'zod'

/**
 * 「이 가게들의 상품」을 이루는 id 목록을 다듬는다 (TASK-0089 4.6).
 *
 * ## 왜 자르는 자리가 따로 있나
 *
 * 계약은 이 목록을 **50곳까지**만 받는다(`SEARCH_SELLER_IDS_MAX`). 그 수는 상품이
 * 아니라 검색 엔진에 넘기는 **필터 문자열의 길이**에서 온다. 51곳을 팔로우한 사람의
 * 홈에서 그 상한을 넘기면 서버가 400 으로 거절하고, 그 거절은 화면에 **빈 줄**로
 * 나타난다 — 「팔로우한 브랜드의 신상품이 아직 없나 보다」로 읽히고 아무도 오류를
 * 보지 못한다. 그래서 자르는 일은 화면이 하고, 앞에서부터 자른다: 목록이 최근에
 * 팔로우한 순서이므로 (4.4) 남는 것은 **가장 최근 50곳**이다.
 *
 * ## uuid 가 아닌 것을 버리는 이유
 *
 * 이 목록은 주소창에서도 온다(`?sellerIds=a,b,c`). 한 칸이 망가진 링크를 그대로
 * 서버에 넘기면 400 이 오고, 검색 화면은 「다시 시도」가 붙은 오류 화면이 된다 —
 * 몇 번을 눌러도 같은 400 이다. 읽을 수 없는 것은 **버리는 쪽**이 링크를 누른 사람에게
 * 남는 화면이 있다는 뜻이고, 그것이 `search-params.ts` 가 다른 모든 필터에 대해
 * 내린 판단과 같다.
 *
 * 판정을 정규식으로 새로 적지 않고 **계약의 것을 그대로 쓴다.** 여기서 통과시킨 것을
 * 서버가 거절하면 그 차이는 조용하다.
 */

const sellerIdSchema = z.uuid()

/**
 * 읽을 수 있는 것만, 중복 없이, 계약이 받는 수까지.
 *
 * 중복을 지우는 것은 상한을 **의미 있게** 만들기 위해서다 — 같은 가게가 60번 적힌
 * 링크가 「60곳」으로 세어지면 진짜 가게 하나만 남기고 잘린다.
 */
export function capSellerIds(ids: readonly string[]): string[] {
  const kept: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    if (kept.length === SEARCH_SELLER_IDS_MAX) break

    const trimmed = id.trim()

    if (seen.has(trimmed) || !sellerIdSchema.safeParse(trimmed).success) continue

    seen.add(trimmed)
    kept.push(trimmed)
  }

  return kept
}

/**
 * 질의 문자열 한 칸(`a,b,c`) 을 목록으로.
 *
 * 남는 것이 하나도 없으면 **필터 자체가 없는 것**으로 답한다. 빈 목록을 그대로 넘기면
 * 계약의 `min(1)` 에 걸려 400 이 되고, 「가게를 하나도 고르지 않은 검색」은 원래
 * 필터가 없는 검색이다.
 */
export function readSellerIds(value: string | null): string[] | undefined {
  if (value === null) return undefined

  const kept = capSellerIds(value.split(','))

  return kept.length === 0 ? undefined : kept
}
