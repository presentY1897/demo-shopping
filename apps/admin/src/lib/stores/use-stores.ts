'use client'

import type { AdminSellerRow, ApiFailure, SellerStatusEvent } from '@shopping/shared'
import { ADMIN_LIST_MAX_LIMIT, apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchStoreHistory, fetchStores } from './console-api'
import type { StoreFilters } from './store-console'
import { EMPTY_STORE_FILTERS, isNarrowed, queryOf } from './store-console'

/**
 * 스토어 한 페이지, 그리고 **연 스토어 하나의 이력** (TASK-0094).
 *
 * 훅이 둘인 것이 계약이 둘인 것과 같은 이유다. 목록은 「어느 스토어를 봐야 하나」에
 * 답하고 이력은 「이 스토어가 몇 번 정지됐나」에 답한다 — 목록에 이력을 실으면 스무
 * 줄마다 이력을 끌고 오면서 첫 질문에는 아무것도 더하지 못한다 (`console-api.ts`).
 *
 * 목록 쪽 뼈대는 `use-users.ts` · `use-reports.ts` 와 같다: 서버 렌더에서 아무것도
 * 기다리지 않고, 커서는 `useCursorPagination` 이 들며, 필터가 바뀌면 첫 페이지로
 * 돌아간다. **닮은 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 */

export type StoresState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly stores: readonly AdminSellerRow[]
      readonly nextCursor: string | null
    }

export interface StoresController {
  readonly state: StoresState
  readonly filters: StoreFilters
  readonly setFilters: (filters: StoreFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
}

export function useStores(): StoresController {
  const [state, setState] = useState<StoresState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<StoreFilters>(EMPTY_STORE_FILTERS)
  const [token, setToken] = useState(0)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const page = await fetchStores(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ nextCursor: page.nextCursor, status: 'ready', stores: page.sellers })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, token])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * **정렬이 바뀔 때도 그렇다.** 커서는 그 정렬과 그 필터 안에서만 위치를 뜻하므로,
   * 매출순 세 번째 페이지의 커서를 클레임률순에 그대로 들고 가면 「이 스토어 다음」이
   * 아무 뜻도 없는 자리를 가리킨다 (설계서 커서 규약).
   */
  const setFilters = useCallback(
    (next: StoreFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const narrowed = useMemo(() => isNarrowed(filters), [filters])

  return { filters, narrowed, pagination, reload, setFilters, state }
}

/* ----------------------------------------------------- 한 스토어의 이력 -- */

export type StoreHistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly events: readonly SellerStatusEvent[] }

export interface StoreHistoryController {
  readonly state: StoreHistoryState
  readonly reload: () => void
}

/**
 * 한 스토어의 제재 이력 (F6).
 *
 * `sellerId` 가 바뀌면 다시 읽는다 — 목록에서 다른 줄의 이력을 열었을 때가 그 자리다.
 * 답을 기다리는 사이에 창이 닫히면 요청은 취소되고, 취소된 요청은 상태를 건드리지
 * 않는다.
 */
export function useStoreHistory(sellerId: string): StoreHistoryController {
  const [state, setState] = useState<StoreHistoryState>({ status: 'loading' })
  const [token, setToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const { events } = await fetchStoreHistory(sellerId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ events, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sellerId, token])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  return { reload, state }
}

/* ------------------------------------------------- id 를 이름으로 옮기기 -- */

export interface StoreChoice {
  readonly id: string
  readonly name: string
}

export type StoreChoicesState =
  | { readonly status: 'loading' }
  /** 목록을 못 받았다. 왜인지는 말하지 않는다 — 부르는 화면의 본 일이 아니다. */
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly choices: readonly StoreChoice[] }

/**
 * 고를 수 있는 스토어들 — 그리고 **id 를 이름으로 바꾸는 표.**
 *
 * `/products` 와 `/orders` 가 함께 쓴다. 두 계약 다 스토어를 **uuid 로** 받고
 * (`productListQuerySchema.sellerId` · `adminOrderSearchQueryParamsSchema.sellerId`),
 * 상품 줄도 `sellerId` 만 들고 온다(`productSummarySchema`) — 사람이 uuid 를 치거나
 * 읽을 일이 없게 하는 표가 어딘가 한 번은 있어야 한다.
 *
 * **첫 페이지뿐이다.** 한 번에 {@link ADMIN_LIST_MAX_LIMIT} 곳까지이고, 커서를
 * 따라가며 전부 모으면 스토어가 늘어날수록 화면이 열리는 시간이 함께 늘어난다 —
 * 그 값이 쓰이는 곳은 셀렉트 하나다. 목록이 잘렸다는 사실은 화면이 문장으로 말한다
 * (`lib/commissions/use-sellers.ts` 가 같은 판단을 먼저 했다).
 *
 * 실패해도 화면은 서지 않는다. 상품도 주문도 스토어 이름 없이 읽히고, 그때 그 자리에
 * 남는 것은 id 다 — 아무것도 없는 것보다는 낫다.
 */
export function useStoreChoices(): StoreChoicesState {
  const [state, setState] = useState<StoreChoicesState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchStores(
          { limit: ADMIN_LIST_MAX_LIMIT },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          // 목록은 최근 개설 순이다. 고르는 사람이 찾는 것은 이름이므로 이름순으로
          // 세운다 — 지표 화면의 순서를 여기까지 가져오면 아무 뜻이 없다.
          choices: page.sellers
            .map((store) => ({ id: store.sellerId, name: store.brandName }))
            .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR')),
          status: 'ready',
        })
      } catch {
        if (controller.signal.aborted) return

        setState({ status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [])

  return state
}
