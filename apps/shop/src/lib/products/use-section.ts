'use client'

import type { SearchHit, SearchSort } from '@shopping/shared'
import { useContext, useEffect, useRef, useState } from 'react'

import { fetchSection } from './section-api'
import { SectionReadiness } from './section-readiness'

// Fetch immediately; health readiness can retry an unsuccessful first request.
export type SectionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'ready'; readonly items: readonly SearchHit[] }

export function useSection(
  sort: SearchSort,
  limit: number,
  /** 눌러 둘 가게들. 비우면 카탈로그 전체다. */
  sellerIds?: readonly string[],
): SectionState {
  const ready = useContext(SectionReadiness)
  const [run, setRun] = useState(0)
  const [state, setState] = useState<SectionState>({ status: 'loading' })
  // 배열을 그대로 의존성에 두면 **렌더마다 새 참조**라 이 효과가 멈추지 않는다 —
  // 요청이 무한히 나가고, 그 사실은 화면에 아무 자국도 남기지 않는다. 문자열 하나로
  // 접으면 「같은 가게들」이 같은 값이 된다.
  const stores = sellerIds === undefined ? '' : sellerIds.join(',')

  const completed = useRef<string | null>(null)
  const key = JSON.stringify([sort, limit, stores, run])

  useEffect(() => {
    if (completed.current === key) return
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await fetchSection(
          { sort, limit, ...(stores === '' ? {} : { sellerIds: stores.split(',') }) },
          { signal: controller.signal },
        )

        if (!controller.signal.aborted) {
          if (answer.items.length > 0 || ready) {
            completed.current = key
            setState({ status: 'ready', items: answer.items })
          } else {
            // An empty index while search is waking is not an empty catalogue.
            setState({ status: 'loading' })
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            retry: () => {
              setState({ status: 'loading' })
              setRun((value) => value + 1)
            },
          })
        }
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sort, limit, stores, ready, run, key])

  return state
}
