'use client'

import type { ApiFailure, PointLedgerEntry, PointSummaryResponse } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchPointLedger, fetchPointSummary } from './points-api'

/**
 * `/mypage/points` 뒤의 적립금 (TASK-0077 F4 · F6).
 *
 * ## 둘을 따로 읽고, 따로 실패한다
 *
 * 잔액(`/me/points`)과 원장(`/me/points/transactions`)이 다른 라우트인 것이 계약이고,
 * 그 이유는 읽는 빈도다 — 마이페이지 요약은 앞의 하나만 부른다. 화면에서도 둘을 따로
 * 들고 있는 이유는 **실패의 결과가 다르기** 때문이다: 원장을 못 읽어도 잔액과 적립
 * 예정은 여전히 참이고, 그 셋을 한 상태로 묶으면 원장 하나가 실패했을 때 화면 전체가
 * 오류가 된다.
 *
 * 잔액이 실패하면 반대다. 그때는 이 화면이 답해야 할 것 — 지금 얼마인가 — 이 없으므로
 * 화면 전체가 오류다.
 *
 * ## 원장은 이어 붙인다
 *
 * 커서 목록은 뒤로 갈 수 없다(`use-order-history.ts` 가 그 이유를 적어 두었다). 원장은
 * **읽어 내려가는 것**이라 그 성질이 더 맞는다: 「왜 줄었지」에 답하려면 위에서
 * 아래로 훑어야 하고, 훑는 중에 앞 장이 사라지면 그 답을 잃는다.
 *
 * ## 잔액은 원장 응답에도 실려 온다
 *
 * 계약이 두 응답 모두에 `account` 를 싣는다. 그래도 이 훅이 화면에 넘기는 잔액은
 * **요약 쪽 하나**다 — 두 곳에서 읽어 서로 다른 순간의 값을 나란히 그리면, 대사하러
 * 온 사람이 「머리의 잔액과 마지막 줄의 잔액이 다르다」를 보게 된다.
 */

export type PointSummaryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly summary: PointSummaryResponse }

export type PointLedgerState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface PointScreen {
  readonly summary: PointSummaryState
  readonly ledger: PointLedgerState
  /** 지금까지 불러온 원장 줄 전부. 최신순이다. */
  readonly entries: readonly PointLedgerEntry[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly loadMoreFailure: ApiFailure | null
  /** 둘 다 처음부터 다시. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
}

export function usePointScreen(): PointScreen {
  const [summary, setSummary] = useState<PointSummaryState>({ status: 'loading' })
  const [ledger, setLedger] = useState<PointLedgerState>({ status: 'loading' })
  const [entries, setEntries] = useState<readonly PointLedgerEntry[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailure, setLoadMoreFailure] = useState<ApiFailure | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * 이미 요청한 커서. 「더 보기」를 빠르게 두 번 누르면 같은 쪽이 두 벌 붙는다 —
   * `loadingMore` 만으로는 그 사이의 경주를 막지 못한다.
   */
  const requested = useRef<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      // **둘을 나란히 부른다.** 순서를 두면 원장이 잔액을 기다리게 되고, 그 기다림에는
      // 아무 이유가 없다 — 두 답이 서로를 필요로 하지 않는다.
      const [head, page] = await Promise.allSettled([
        fetchPointSummary({ signal: controller.signal }),
        fetchPointLedger(null, { signal: controller.signal }),
      ])

      if (controller.signal.aborted) return

      setSummary(
        head.status === 'fulfilled'
          ? { status: 'ready', summary: head.value }
          : { status: 'error', failure: apiFailure(head.reason) },
      )

      if (page.status === 'fulfilled') {
        setEntries(page.value.entries)
        setCursor(page.value.nextCursor)
        setLoadMoreFailure(null)
        requested.current = null
        setLedger({ status: 'ready' })

        return
      }

      setLedger({ status: 'error', failure: apiFailure(page.reason) })
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setSummary({ status: 'loading' })
    setLedger({ status: 'loading' })
    setEntries([])
    setCursor(null)
    setLoadMoreFailure(null)
    requested.current = null
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || requested.current === cursor) return

    requested.current = cursor
    setLoadingMore(true)
    setLoadMoreFailure(null)

    async function next(from: number): Promise<void> {
      try {
        const page = await fetchPointLedger(from)

        setEntries((existing) => [...existing, ...page.entries])
        setCursor(page.nextCursor)
      } catch (error) {
        setLoadMoreFailure(apiFailure(error))
        requested.current = null
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor])

  return {
    entries,
    hasMore: ledger.status === 'ready' && cursor !== null,
    ledger,
    loadMore,
    loadMoreFailure,
    loadingMore,
    reload,
    summary,
  }
}
