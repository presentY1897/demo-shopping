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
 */

export type SectionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly SearchHit[] }

export function useSection(sort: SearchSort, limit: number): SectionState {
  const [state, setState] = useState<SectionState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await fetchSection({ sort, limit }, { signal: controller.signal })

        if (!controller.signal.aborted) setState({ status: 'ready', items: answer.items })
      } catch {
        if (!controller.signal.aborted) setState({ status: 'ready', items: [] })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sort, limit])

  return state
}
