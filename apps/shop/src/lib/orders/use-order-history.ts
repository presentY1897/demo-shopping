'use client'

import type { ApiFailure, OrderSummary } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { OrderFilter } from './order-filters'
import { orderListQueryOf } from './order-filters'
import { fetchOrders } from './orders-api'

/**
 * `/mypage/orders` 뒤의 목록 (TASK-0063).
 *
 * ## 필터가 바뀌면 **다시 부른다**
 *
 * 기간·상태를 서버가 받으므로(`orderListQuerySchema`) 조건은 질의의 일부다. 조건이
 * 바뀌면 그것은 다른 질문이고, 그러면 지금까지 이어 붙인 것은 **다른 질문의 답**이라
 * 버려야 한다 — 남겨 두면 조건을 좁혔는데 넓은 조건의 주문이 화면에 남는다.
 *
 * 그전에는 서버에 보낼 것이 없어 다시 부르지 않았고, 필터는 이미 받은 것을 다르게
 * 걸렀다. 그 대가로 목록은 「조건에 맞는 것이 더 있을 수 있다」고 말해야 했다.
 * 지금은 말할 필요가 없다 — 서버가 걸렀으므로 남은 장이 있으면 **조건에 맞는 것이
 * 더 있는 것**이고, 그 사실은 `hasMore` 하나로 충분하다.
 *
 * ## 왜 이전/다음이 아니라 누적인가
 *
 * 커서 규약은 화면별 이동 수단을 둘로 나눈다 — 상품 목록은 무한 스크롤, 콘솔 표는
 * 이전/다음(`pages.md` 커서 페이지네이션 규약). 주문 내역은 앞쪽이다. 커서 목록은
 * **뒤로 갈 수 없기** 때문이다: 커서는 「마지막으로 본 줄」이라 다음 장은 뜰 수 있어도
 * 이전 장은 그 커서로 다시 물을 수 없고, 그것을 흉내 내려면 화면이 지나온 커서를
 * 전부 쌓아야 한다. 누적이면 그 문제가 아예 없고, 사람이 위로 스크롤하면 앞 장이
 * 그 자리에 있다.
 *
 * ## 다음 장이 앞 장을 갈아치우지 않는다
 *
 * `items` 는 **이어 붙인다.** 대역이 두 장을 갖고 있는 이유가 이것이다 — 한 장짜리
 * 대역에서는 누적과 교체가 구분되지 않는다.
 */

export type OrderHistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface OrderHistory {
  readonly state: OrderHistoryState
  /** 지금 조건으로 지금까지 불러온 주문 전부. 최신순이다. */
  readonly items: readonly OrderSummary[]
  /** 이 조건에 서버가 아직 갖고 있는 장이 있는가. */
  readonly hasMore: boolean
  /** 다음 장이 오는 중. 「더 보기」의 중복 클릭을 막는 값이다 (U3). */
  readonly loadingMore: boolean
  /** 다음 장을 이어 붙인다. 실패는 조용히 남기고 이미 있는 목록은 지키지 않는다. */
  readonly loadMore: () => void
  /** 처음부터 다시. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  /** 「더 보기」가 실패했을 때. 목록은 그대로이고 이 줄만 붙는다 (U6). */
  readonly loadMoreFailure: ApiFailure | null
}

/** 어느 요청의 결과인가. 조건이 바뀌면 지난 결과는 **다른 질문의 답**이 된다. */
interface Settled {
  readonly key: string
  readonly state: OrderHistoryState
}

export function useOrderHistory(filter: OrderFilter, now: Date): OrderHistory {
  const [settled, setSettled] = useState<Settled | null>(null)
  const [items, setItems] = useState<readonly OrderSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailure, setLoadMoreFailure] = useState<ApiFailure | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * 조건을 **문자열 하나**로 줄인다.
   *
   * `useEffect` 의 의존 목록은 참조로 비교하므로, 객체를 그대로 두면 부모가 렌더될
   * 때마다 새 객체가 되어 같은 조건으로 목록을 다시 부른다.
   */
  const query = useMemo(() => orderListQueryOf(filter, now), [filter, now])
  const queryKey = JSON.stringify(query)
  /** 「다시 시도」는 같은 조건의 새 요청이라 열쇠에 회차가 붙는다. */
  const requestKey = `${queryKey}#${String(reloadToken)}`

  /**
   * 「기다리는 중」은 **저장하지 않고 유도한다.**
   *
   * 조건이 바뀌면 화면은 그 순간부터 기다리는 중인데, 그것을 효과 안에서
   * `setState` 로 적으면 렌더 한 번이 더 돈다(`react-hooks/set-state-in-effect`).
   * 「마지막으로 받은 답이 지금 조건의 것인가」를 물으면 같은 사실이 상태 없이
   * 나온다 — 아니면 아직 안 온 것이다.
   */
  const state: OrderHistoryState =
    settled?.key === requestKey ? settled.state : { status: 'loading' }

  /**
   * 이미 요청한 커서.
   *
   * 무한 스크롤의 센티널은 **한 번의 교차에 여러 번 발화할 수 있고**, 그때 같은
   * 커서로 두 번 물으면 같은 스무 건이 목록에 두 벌 들어간다. `loadingMore` 만으로는
   * 그 사이의 경주를 막지 못한다 — 상태 갱신은 다음 렌더에서야 보인다.
   */
  const requested = useRef<string | null>(null)

  /**
   * 지금 화면에 걸린 조건.
   *
   * 「더 보기」가 읽는다. 이 값을 콜백의 의존 목록에 넣으면 조건이 바뀔 때마다
   * 콜백이 새로 만들어지고, 그것을 받는 `useInfiniteScroll` 이 관찰자를 다시 단다.
   */
  const current = useRef(query)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchOrders(null, query, { signal: controller.signal })
        if (controller.signal.aborted) return

        // 이어 붙이지 않고 **갈아 끼운다.** 조건이 바뀌었으면 지금까지의 것은 다른
        // 질문의 답이다.
        setItems(page.orders)
        setCursor(page.nextCursor)
        setLoadMoreFailure(null)
        requested.current = null
        current.current = query
        setSettled({ key: requestKey, state: { status: 'ready' } })
      } catch (error) {
        if (controller.signal.aborted) return
        setSettled({ key: requestKey, state: { status: 'error', failure: apiFailure(error) } })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
    // `requestKey` 가 「지금 무엇을 묻고 있나」의 전부다 — 같은 조건의 새 객체로는
    // 다시 부르지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` 는 `requestKey` 가 같으면 같은 값이고, 목록에 넣으면 렌더마다 다시 부른다.
  }, [requestKey])

  const reload = useCallback(() => {
    setItems([])
    setCursor(null)
    setLoadMoreFailure(null)
    requested.current = null
    // 회차가 바뀌면 마지막으로 받은 답이 「지금 조건의 것」이 아니게 되고, 그것이
    // 곧 「기다리는 중」이다.
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || requested.current === cursor) return

    requested.current = cursor
    setLoadingMore(true)
    setLoadMoreFailure(null)

    async function next(from: string): Promise<void> {
      try {
        // 조건은 **첫 장과 같은 것**이어야 한다. 다음 장을 다른 조건으로 물으면
        // 커서가 가리키는 자리가 그 목록에 없다.
        const page = await fetchOrders(from, current.current)

        // 이어 붙인다. 갈아치우면 「더 보기」가 목록을 지우는 버튼이 된다.
        setItems((existing) => [...existing, ...page.orders])
        setCursor(page.nextCursor)
      } catch (error) {
        setLoadMoreFailure(apiFailure(error))
        // 같은 커서를 다시 시도할 수 있어야 한다. 실패한 요청이 그 장을 영원히
        // 잠그면 사람이 할 수 있는 일이 새로고침뿐이 된다.
        requested.current = null
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor])

  return {
    // **답을 받은 뒤에만 참이다.** 조건을 바꾼 직후의 커서는 지난 질문의 것이라,
    // 그것으로 「더 보기」를 그리면 아직 오지도 않은 목록의 다음 장을 권하게 된다.
    hasMore: state.status === 'ready' && cursor !== null,
    items,
    loadMore,
    loadMoreFailure,
    loadingMore,
    reload,
    state,
  }
}
