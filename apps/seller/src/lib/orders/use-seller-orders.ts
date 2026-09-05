'use client'

import type {
  ApiFailure,
  SellerOrderListItem,
  SellerOrderListQuery,
  SellerOrderSummary,
} from '@shopping/shared'
import { apiFailure, SELLER_ORDER_LIST_MAX_LIMIT } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchSellerOrders, fetchSellerOrderSummary } from './console-api'
import type { SellerOrderTab } from './order-console'
import { statusesOf } from './order-console'

/**
 * 한 페이지의 주문, 그 위의 필터, 그리고 필터와 **무관한** 뱃지.
 *
 * `use-seller-products.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고,
 * 커서는 `useCursorPagination` 이 들고, 선택은 페이지가 바뀌면 비워진다. **닮은
 * 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 다른 것이 하나 있다: **요약이 목록과 다른 요청이다.** 뱃지는 「내 가게에 처리할
 * 것이 몇 건인가」에 답하므로 탭·기간·검색을 따라 움직이면 안 되고, 그래서 필터가
 * 바뀔 때 다시 읽지 않는다 — 다시 읽는 것은 **목록을 바꾼 쓰기 뒤**뿐이다.
 */

export type SellerOrdersState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly SellerOrderListItem[]
      readonly nextCursor: string | null
    }

/**
 * 필터 바가 들고 있는 것.
 *
 * 기간은 `YYYY-MM-DD` 다 — `<input type="date">` 가 주는 값 그대로이고, ISO 시각으로
 * 바꾸는 일은 **보내기 직전**에 한다. 상태에 시각을 들고 있으면 같은 날을 고른 두
 * 번의 렌더가 다른 값을 갖고, 그때 커서는 이유 없이 리셋된다.
 */
export interface SellerOrderFilters {
  readonly tab: SellerOrderTab
  readonly from: string
  readonly to: string
  readonly q: string
}

export const EMPTY_ORDER_FILTERS: SellerOrderFilters = { tab: 'all', from: '', to: '', q: '' }

/**
 * 고른 날의 **시작**을 ISO 로. 빈 값은 `undefined` — 필터를 걸지 않는다는 뜻이다.
 *
 * 브라우저의 지역시로 만든다. 판매자가 「9월 6일」이라고 할 때 뜻하는 것은 자기
 * 시계의 하루이고, `2026-09-06T00:00:00Z` 로 보내면 한국에서는 오전 9시부터가 된다.
 */
export function dayStart(day: string): string | undefined {
  if (day === '') return undefined

  const parsed = new Date(`${day}T00:00:00`)

  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

/** 고른 날의 **끝**. 경계가 양쪽 다 포함이라 하루의 마지막 밀리초다. */
export function dayEnd(day: string): string | undefined {
  if (day === '') return undefined

  const parsed = new Date(`${day}T23:59:59.999`)

  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

/** 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다. */
export function queryOf(filters: SellerOrderFilters): SellerOrderListQuery {
  const statuses = statusesOf(filters.tab)
  const from = dayStart(filters.from)
  const to = dayEnd(filters.to)
  const q = filters.q.trim()

  return {
    // 계약의 `status` 는 가변 배열이고 탭의 표는 읽기 전용이다. 복사해서 넘기는
    // 것이 그 둘을 잇는 자리이고, 표를 가변으로 만드는 것보다 낫다 — 표가 가변이면
    // 어느 화면이 탭의 정의를 고쳐 놓을 수 있다.
    ...(statuses === null ? {} : { status: [...statuses] }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(q === '' ? {} : { q }),
  }
}

/** 쓰기 하나의 결말. 던지지 않는 이유는 부르는 쪽이 계속 그려야 하기 때문이다. */
export type SellerOrderWrite<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ApiFailure }

export interface SellerOrdersController {
  readonly state: SellerOrdersState
  readonly summary: SellerOrderSummary | null
  readonly filters: SellerOrderFilters
  readonly setFilters: (filters: SellerOrderFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
  /** 화면에 있는 페이지에서 고른 것들 — 없는 페이지의 것은 절대 들어 있지 않다. */
  readonly selected: ReadonlySet<string>
  readonly toggle: (id: string) => void
  readonly toggleAll: () => void
  readonly clearSelection: () => void
  /** 목록을 조용히 다시 읽는다. 쓰기가 끝난 뒤 화면이 스켈레톤으로 돌아가지 않게. */
  readonly refresh: () => void
  /** 지금 필터에 걸린 **전부**를, 페이지를 넘겨 가며. 내보내기가 쓴다. */
  readonly collectAll: () => Promise<SellerOrderWrite<readonly SellerOrderListItem[]>>
}

/**
 * 내보내기가 넘길 수 있는 페이지의 상한.
 *
 * 상한이 있는 이유는 성능이 아니라 **끝나지 않는 일을 만들지 않기 위해서**다. 커서가
 * 잘못되면 이 고리는 영원히 돌고, 그 증상은 「내보내기가 안 된다」가 아니라 탭이
 * 멈추는 것이다. 100 페이지 × 100건이면 만 건이고, 그보다 큰 내보내기는 화면이 아니라
 * 정산 쪽의 일이다.
 */
const EXPORT_PAGE_LIMIT = 100

export function useSellerOrders(): SellerOrdersController {
  const [state, setState] = useState<SellerOrdersState>({ status: 'loading' })
  const [summary, setSummary] = useState<SellerOrderSummary | null>(null)
  const [filters, setFiltersState] = useState<SellerOrderFilters>(EMPTY_ORDER_FILTERS)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [reloadToken, setReloadToken] = useState(0)
  const [summaryToken, setSummaryToken] = useState(0)

  /** 화면을 스켈레톤으로 되돌리지 않아야 하는 다시 읽기. */
  const silent = useRef(false)

  const paging = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = paging

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const page = await fetchSellerOrders(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ status: 'ready', items: page.sellerOrders, nextCursor: page.nextCursor })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, reloadToken])

  /**
   * 뱃지는 **필터를 보지 않는다.**
   *
   * 의존 배열에 `filters` 가 없는 것이 이 훅에서 가장 쉽게 잘못 고쳐지는 자리다.
   * 넣으면 탭을 옮길 때마다 숫자가 흔들리고, 흔들리는 숫자는 사이드바에 그릴 수 없다.
   * 다시 읽는 것은 **목록을 바꾼 쓰기 뒤**뿐이고 그 신호가 `summaryToken` 이다.
   *
   * 실패해도 상태를 만들지 않는다 — 뱃지가 없는 화면은 그대로 쓸 수 있고, 목록이
   * 멀쩡한데 「불러오지 못했습니다」를 띄우는 편이 나쁘다.
   */
  useEffect(() => {
    const controller = new AbortController()

    fetchSellerOrderSummary({ signal: controller.signal })
      .then((answer) => {
        if (!controller.signal.aborted) setSummary(answer.summary)
      })
      .catch(() => undefined)

    return () => {
      controller.abort()
    }
  }, [summaryToken])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아가고 선택을 버린다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로 쓰면
   * 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다.
   */
  const setFilters = useCallback(
    (next: SellerOrderFilters) => {
      setFiltersState(next)
      setSelected(new Set())
      reset()
    },
    [reset],
  )

  /**
   * 페이지 이동도 화면의 줄을 전부 바꾼다.
   *
   * 효과로 지우지 않고 여기서 감싸는 이유는, 효과는 **새 페이지가 그려진 뒤에** 돌아
   * 한 프레임 동안 「5건 선택됨」이 없는 줄들을 가리키기 때문이다.
   */
  const pagination = useMemo<CursorPagination>(
    () => ({
      ...paging,
      goNext: () => {
        setSelected(new Set())
        paging.goNext()
      },
      goPrevious: () => {
        setSelected(new Set())
        paging.goPrevious()
      },
    }),
    [paging],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const refresh = useCallback(() => {
    silent.current = true
    setSelected(new Set())
    setReloadToken((token) => token + 1)
    setSummaryToken((token) => token + 1)
  }, [])

  const toggle = useCallback((id: string) => {
    setSelected((held) => {
      const next = new Set(held)

      if (!next.delete(id)) next.add(id)

      return next
    })
  }, [])

  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state])
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
  }, [allSelected, items])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
  }, [])

  /**
   * 지금 필터의 **전부**를 모은다 — 화면에 보이는 페이지가 아니라.
   *
   * 「내보내기」가 지금 페이지만 담으면 그 파일은 이름이 약속한 것을 담고 있지 않다.
   * 커서를 끝까지 따라가되 {@link EXPORT_PAGE_LIMIT} 에서 멈추는 것은 위 상수의 주석
   * 그대로다.
   */
  const collectAll = useCallback(async (): Promise<
    SellerOrderWrite<readonly SellerOrderListItem[]>
  > => {
    const collected: SellerOrderListItem[] = []
    let cursorAt: string | null = null
    let pages = 0

    try {
      do {
        const page = await fetchSellerOrders({
          ...queryOf(filters),
          limit: SELLER_ORDER_LIST_MAX_LIMIT,
          ...(cursorAt === null ? {} : { cursor: cursorAt }),
        })

        collected.push(...page.sellerOrders)
        cursorAt = page.nextCursor
        pages += 1
      } while (cursorAt !== null && pages < EXPORT_PAGE_LIMIT)

      return { ok: true, value: collected }
    } catch (error) {
      return { ok: false, failure: apiFailure(error) }
    }
  }, [filters])

  const isFiltered = useMemo(
    () =>
      filters.tab !== 'all' || filters.from !== '' || filters.to !== '' || filters.q.trim() !== '',
    [filters],
  )

  return {
    state,
    summary,
    filters,
    setFilters,
    isFiltered,
    pagination,
    reload,
    refresh,
    selected,
    toggle,
    toggleAll,
    clearSelection,
    collectAll,
  }
}
