'use client'

import type {
  ApiFailure,
  ClaimStatus,
  ClaimType,
  SellerClaimListItem,
  SellerClaimListQuery,
  SellerClaimSummary,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchSellerClaims, fetchSellerClaimSummary } from './console-api'
import type { SellerClaimTab } from './claim-console'
import { stageOf } from './claim-console'

/**
 * 한 페이지의 클레임, 그 위의 필터, 그리고 필터와 **무관한** 뱃지.
 *
 * `use-seller-orders.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고, 커서는
 * `useCursorPagination` 이 들고, 요약은 목록과 다른 요청이다. **닮은 훅을 새 규약으로
 * 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 다른 것이 셋 있고, 셋 다 **이 화면이 아무것도 쓰지 않는다**는 한 사실에서 나온다.
 *
 * **선택이 없다.** 클레임에는 일괄 처리가 없다 — 승인·거절은 건마다 사유와 금액이
 * 다르고, 「20건 일괄 승인」은 그 20건의 환불 예정액을 아무도 보지 않았다는 뜻이다.
 *
 * **조용한 다시 읽기가 없다.** 그것은 「쓰기 뒤에 화면을 스켈레톤으로 되돌리지
 * 않는다」를 위한 장치인데, 승인·거절·수거·검수는 전부 상세에서 일어난다. 목록으로
 * 돌아오는 길은 라우팅이라 그때 이 훅은 처음부터 다시 읽는다 — 부를 사람이 없는
 * `refresh()` 를 남겨 두면 다음 사람은 그것이 **왜** 안 불리는지를 먼저 알아내야 한다.
 *
 * **뱃지는 필터를 보지 않는다.** 「내 가게에 처리할 것이 몇 건인가」에 답하므로
 * 탭·유형·상태를 따라 움직이면 안 된다. 다시 읽는 신호가 없는 것도 위와 같은 이유다.
 */

export type SellerClaimsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly SellerClaimListItem[]
      readonly nextCursor: string | null
    }

/**
 * 필터 바가 들고 있는 것.
 *
 * 단계는 위의 탭이 맡으므로 여기 없다 — 한 조건을 두 자리에서 고를 수 있게 만들면 어느
 * 쪽이 이기는지를 정해야 하고, 그 규칙은 아무도 기억하지 못한다.
 *
 * `null` 은 「전체」다. 계약의 `status` 는 목록이지만 화면이 고르는 것은 한 값이고,
 * 보낼 때 한 원소짜리 목록으로 감싼다 — 문법은 여전히 쉼표 하나다.
 */
export interface SellerClaimFilters {
  readonly tab: SellerClaimTab
  readonly type: ClaimType | null
  readonly status: ClaimStatus | null
}

export const EMPTY_CLAIM_FILTERS: SellerClaimFilters = { tab: 'all', type: null, status: null }

/** 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다. */
export function queryOf(filters: SellerClaimFilters): SellerClaimListQuery {
  const stage = stageOf(filters.tab)

  return {
    ...(stage === null ? {} : { stage }),
    ...(filters.type === null ? {} : { type: filters.type }),
    ...(filters.status === null ? {} : { status: [filters.status] }),
  }
}

/** 쓰기 하나의 결말. 던지지 않는 이유는 부르는 쪽이 계속 그려야 하기 때문이다. */
export type SellerClaimWrite<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ApiFailure }

export interface SellerClaimsController {
  readonly state: SellerClaimsState
  readonly summary: SellerClaimSummary | null
  readonly filters: SellerClaimFilters
  readonly setFilters: (filters: SellerClaimFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
}

export function useSellerClaims(): SellerClaimsController {
  const [state, setState] = useState<SellerClaimsState>({ status: 'loading' })
  const [summary, setSummary] = useState<SellerClaimSummary | null>(null)
  const [filters, setFiltersState] = useState<SellerClaimFilters>(EMPTY_CLAIM_FILTERS)
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
        const page = await fetchSellerClaims(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ status: 'ready', items: page.claims, nextCursor: page.nextCursor })
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
   * 의존 배열이 비어 있는 것이 이 훅에서 가장 쉽게 잘못 고쳐지는 자리다. `filters` 를
   * 넣으면 탭을 옮길 때마다 숫자가 흔들리고, 흔들리는 숫자는 사이드바에 그릴 수 없다.
   *
   * 실패해도 상태를 만들지 않는다 — 뱃지가 없는 화면은 그대로 쓸 수 있고, 목록이
   * 멀쩡한데 「불러오지 못했습니다」를 띄우는 편이 나쁘다.
   */
  useEffect(() => {
    const controller = new AbortController()

    fetchSellerClaimSummary({ signal: controller.signal })
      .then((answer) => {
        if (!controller.signal.aborted) setSummary(answer.summary)
      })
      .catch(() => undefined)

    return () => {
      controller.abort()
    }
  }, [])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로 쓰면
   * 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다.
   */
  const setFilters = useCallback(
    (next: SellerClaimFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const isFiltered = useMemo(
    () => filters.tab !== 'all' || filters.type !== null || filters.status !== null,
    [filters],
  )

  return {
    state,
    summary,
    filters,
    setFilters,
    isFiltered,
    pagination: paging,
    reload,
  }
}
