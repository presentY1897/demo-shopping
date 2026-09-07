'use client'

import type { SearchHit, SearchSort } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { fetchSection } from './section-api'

/**
 * 홈의 한 섹션을 브라우저에서 읽는다 (TASK-0044 4.1).
 *
 * **서버 렌더에서 부르지 않는 것이 핵심이다.** TASK-0101 F4 가 그것을 구조로
 * 못박아 뒀다 — `HomePage()` 는 Promise 를 반환하지 않고 호출해도 요청이 나가지
 * 않으며 `/` 는 정적 프리렌더된다. 그 결정의 이유는 콜드 스타트다: 서버에서
 * 기다리면 90초짜리 기상 시간을 5초 타임아웃으로 맞이하게 되고, 방문자는 페이지
 * 대신 실패 화면을 받는다. 여기서 홈에 데이터를 붙인다고 그 결정을 뒤집을 수는
 * 없다.
 *
 * 그래서 섹션은 마운트 뒤에 채워진다. 셸·히어로·카테고리는 즉시 나오고, 상품
 * 줄만 늦게 온다 — 콜드 스타트 안내(`ApiWakeGate`)가 그 사이를 설명한다.
 *
 * 실패는 **빈 섹션**이다. 홈은 목적지가 아니라 출발점이고, 신상품 줄이 비어 있는
 * 홈은 여전히 검색과 카테고리로 갈 수 있다 — 오류 화면은 갈 수 없다.
 *
 * `sellerIds` 를 받는 것은 「팔로우한 브랜드의 신상품」 때문이다 (TASK-0089 4.5).
 * 그 줄도 **검색 한 번**이고, 다른 점은 어느 가게를 눌러 두었는가뿐이다 — 홈 전용
 * 엔드포인트를 만들지 않는다는 `pages.md` 의 규칙이 그것을 이 자리로 보냈다.
 */

export type SectionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly SearchHit[] }

export function useSection(
  sort: SearchSort,
  limit: number,
  /** 눌러 둘 가게들. 비우면 카탈로그 전체다. */
  sellerIds?: readonly string[],
): SectionState {
  const [state, setState] = useState<SectionState>({ status: 'loading' })
  // 배열을 그대로 의존성에 두면 **렌더마다 새 참조**라 이 효과가 멈추지 않는다 —
  // 요청이 무한히 나가고, 그 사실은 화면에 아무 자국도 남기지 않는다. 문자열 하나로
  // 접으면 「같은 가게들」이 같은 값이 된다.
  const stores = sellerIds === undefined ? '' : sellerIds.join(',')

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await fetchSection(
          { sort, limit, ...(stores === '' ? {} : { sellerIds: stores.split(',') }) },
          { signal: controller.signal },
        )

        if (!controller.signal.aborted) setState({ status: 'ready', items: answer.items })
      } catch {
        if (!controller.signal.aborted) setState({ status: 'ready', items: [] })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sort, limit, stores])

  return state
}
