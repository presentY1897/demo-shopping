'use client'

import type { SearchHit, SearchSort } from '@shopping/shared'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'

import { fetchSection } from './section-api'
import { SectionReadiness } from './section-readiness'

// Fetch immediately; health readiness can retry an unsuccessful first request.
export type SectionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly retry: () => void }
  | { readonly status: 'ready'; readonly items: readonly SearchHit[] }

/**
 * What the hook holds, which is one state more than it shows.
 *
 * `unanswered` — the request is over and there is nothing to draw: it failed, or
 * it found an empty index while search was not ready. **Whether that is an error
 * is not the request's to say** — it depends on whether anybody is still going
 * to ask again, and that is the gate's knowledge (TASK-0143 4.3). So the fact is
 * kept and the verdict is derived at the bottom of the hook, which is also why
 * the budget running out needs no request of its own to turn into a message.
 *
 * `ready` is what search readiness was when the answer failed to arrive. When
 * it no longer matches, the effect is already re-reading.
 */
type HeldState =
  | Exclude<SectionState, { readonly status: 'error' }>
  | { readonly status: 'unanswered'; readonly ready: boolean }

const LOADING = { status: 'loading' } as const

export function useSection(
  sort: SearchSort,
  limit: number,
  /** 눌러 둘 가게들. 비우면 카탈로그 전체다. */
  sellerIds?: readonly string[],
): SectionState {
  const readiness = useContext(SectionReadiness)
  // The effect re-reads when search *becomes* ready, and only then. Giving up is
  // not a reason to ask again — it is the decision to stop asking.
  const ready = readiness === 'ready'
  const [run, setRun] = useState(0)
  const [state, setState] = useState<HeldState>(LOADING)
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
            setState({ status: 'unanswered', ready })
          }
        }
      } catch {
        // Every failure, not only `SEARCH_UNAVAILABLE`: before the API is up the
        // same row fails with a transport error, and it is the same wait.
        if (!controller.signal.aborted) setState({ status: 'unanswered', ready })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sort, limit, stores, ready, run, key])

  const retry = useCallback(() => {
    setState(LOADING)
    setRun((value) => value + 1)
  }, [])

  if (state.status !== 'unanswered') return state

  // Still a skeleton while the gate is asking, and while the re-read that the
  // flip to `ready` started is in the air. **No alert in either window** — the
  // first is a wait the gate is already explaining, and the second would be a
  // failure announced a moment before the products that contradict it.
  if (readiness === 'pending' || state.ready !== ready) return LOADING

  return { status: 'error', retry }
}
