'use client'

import type {
  ApiFailure,
  Settlement,
  SettlementListResponse,
  SettlementOutlookResponse,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useState } from 'react'

import { fetchSellerSettlements, fetchSettlementOutlook } from './console-api'
import type { SellerSettlementFilters } from './settlement-console'
import { EMPTY_SETTLEMENT_FILTERS, isNarrowed, sellerSettlementQuery } from './settlement-console'

/**
 * 내 정산서 한 페이지, 그 위의 상태 필터, 그리고 아직 정산서가 되지 않은 돈.
 *
 * `use-seller-coupons.ts` 와 같은 뼈대다 — 커서는 `useCursorPagination` 이 들고,
 * 필터가 바뀌면 첫 페이지로 돌아가며, 서버 렌더에서 아무것도 기다리지 않는다.
 *
 * **예정액을 같은 훅에서 읽는다.** 두 값이 한 화면의 위아래에 있고, 나눠 두면 화면이
 * 두 개의 로딩과 두 개의 오류를 조립하게 된다. 그런데 **실패는 나눠 둔다** —
 * 예정액을 못 읽었다고 정산 내역까지 못 보여 줄 이유가 없고, 그 반대도 마찬가지다.
 *
 * **`sellerId` 를 인자로 받는다.** 목록이 그것 없이는 성립하지 않기 때문이다
 * (`/settlements` 는 `sellerId` 없으면 플랫폼 전체 목록이고 판매자에게는 403 이다).
 * 스토어가 없는 계정에 이 훅을 마운트하지 않는 것은 **화면의 판단**이다.
 */

export type SellerSettlementsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly Settlement[]
      readonly nextCursor: string | null
      /**
       * 지금 **필터가 고른 것 전부**의 합. 페이지의 합이 아니다.
       *
       * 계약이 그렇게 보낸다(`settlementListResponseSchema.totals`). 페이지 합으로
       * 답하면 다음 장을 넘길 때마다 총액이 달라지고, 그 숫자로 「이번 달에 얼마
       * 받나」를 가늠하는 사람에게 그것은 답이 아니다.
       */
      readonly totals: SettlementListResponse['totals']
    }

export type SettlementOutlookState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly outlook: SettlementOutlookResponse }

export interface SellerSettlementsController {
  readonly state: SellerSettlementsState
  readonly outlook: SettlementOutlookState
  readonly filters: SellerSettlementFilters
  readonly setFilters: (filters: SellerSettlementFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
}

export function useSellerSettlements(sellerId: string): SellerSettlementsController {
  const [state, setState] = useState<SellerSettlementsState>({ status: 'loading' })
  const [outlook, setOutlook] = useState<SettlementOutlookState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<SellerSettlementFilters>(EMPTY_SETTLEMENT_FILTERS)
  const [reloadToken, setReloadToken] = useState(0)

  const paging = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = paging

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const page = await fetchSellerSettlements(
          {
            ...sellerSettlementQuery(sellerId, filters),
            ...(cursor === null ? {} : { cursor }),
          },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          items: page.settlements,
          nextCursor: page.nextCursor,
          status: 'ready',
          totals: page.totals,
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sellerId, filters, cursor, reloadToken])

  /*
   * 예정액은 **필터도 커서도 따르지 않는다.** 「지금 걸려 있는 돈」은 이 화면이 어느
   * 페이지를 보고 있든 같은 값이고, 상태 필터를 걸었다고 줄어들면 그것은 다른 뜻이
   * 되어 버린다.
   */
  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setOutlook({ status: 'loading' })

      try {
        const answer = await fetchSettlementOutlook({ signal: controller.signal })

        if (controller.signal.aborted) return

        setOutlook({ outlook: answer, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setOutlook({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sellerId, reloadToken])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로
   * 쓰면 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다.
   */
  const setFilters = useCallback(
    (next: SellerSettlementFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return {
    filters,
    isFiltered: isNarrowed(filters),
    outlook,
    pagination: paging,
    reload,
    setFilters,
    state,
  }
}
