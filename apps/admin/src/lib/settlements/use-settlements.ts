'use client'

import type {
  ApiFailure,
  BulkApproveSettlementsResponse,
  Settlement,
  SettlementListResponse,
} from '@shopping/shared'
import { apiFailure, SETTLEMENT_LIST_MAX_LIMIT } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { approveSettlements, fetchSettlements } from './console-api'
import type { SettlementFilters } from './settlement-console'
import { EMPTY_SETTLEMENT_FILTERS, isNarrowed, queryOf } from './settlement-console'
import { canBulkApprove } from './transitions'

/**
 * 한 페이지의 정산서, 그 위의 필터, 그리고 고른 것들.
 *
 * `lib/claims/use-admin-claims.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지
 * 않고, 커서는 `useCursorPagination` 이 들며, 필터가 바뀌면 첫 페이지로 돌아간다.
 * **닮은 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 저쪽에 없는 것이 셋이고, 셋 다 이 화면이 목록에서 **쓰기를 하기 때문에** 있다:
 * 고른 줄(일괄 승인), 조용한 다시 읽기(승인 뒤에도 무엇을 방금 승인했는지가 화면에
 * 남아야 한다), 그리고 필터 전체를 커서로 훑는 {@link SettlementsController.collectAll}
 * (F8 의 내보내기가 「지금 화면에 보이는 20건」이 아니라 「이 필터가 고른 전부」여야
 * 하기 때문이다).
 */

/**
 * 내보내기가 넘길 수 있는 페이지의 상한.
 *
 * 상한이 있는 이유는 성능이 아니라 **끝나지 않는 일을 만들지 않기 위해서**다. 커서가
 * 잘못되면 이 고리는 영원히 돌고, 그 증상은 「내보내기가 안 된다」가 아니라 탭이
 * 멈추는 것이다 (`apps/seller` 의 주문 내보내기가 같은 이유로 같은 상한을 둔다).
 * 100 페이지 × 100건이면 만 건이고, 정산서는 판매자마다 주에 한 장이다.
 */
const EXPORT_PAGE_LIMIT = 100

export type SettlementsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly settlements: readonly Settlement[]
      readonly nextCursor: string | null
      /**
       * **페이지가 아니라 필터의 합이다** (`settlementListResponseSchema`). 화면이
       * 그 사실을 문장으로도 말해야 한다 — 20건짜리 표 위에 200건의 합계가 서 있는
       * 것은 설명 없이는 틀린 숫자로 보인다.
       */
      readonly totals: SettlementListResponse['totals']
    }

/** 쓰기 한 번의 결과. 실패는 값이고, 문장으로 바꾸는 것은 화면의 몫이다. */
export type SettlementWrite<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ApiFailure }

export interface SettlementsController {
  readonly state: SettlementsState
  readonly filters: SettlementFilters
  readonly setFilters: (filters: SettlementFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  /**
   * 지금 고른 줄들 — **id 가 아니라 정산서 그대로.**
   *
   * 페이지를 넘겨도 유지되므로, id 만 들면 확인 다이얼로그의 합계가 「지금 화면에
   * 있는 줄」만 더한 값이 된다. 그 숫자를 보고 승인을 누르는 사람에게 그것은 답이
   * 아니다. 실패 목록이 앞 페이지의 정산서를 **이름으로** 부를 수 있는 것도 같은
   * 이유에서다.
   */
  readonly selected: ReadonlyMap<string, Settlement>
  readonly toggle: (settlement: Settlement, selected: boolean) => void
  /** 이 페이지에서 **승인할 수 있는 줄** 전부를 고르거나 푼다. */
  readonly togglePage: (selected: boolean) => void
  readonly clearSelection: () => void
  readonly approveSelected: () => Promise<SettlementWrite<BulkApproveSettlementsResponse>>
  /** 지금 필터가 고른 것 **전부** — 커서를 끝까지 따라간다 (F8). */
  readonly collectAll: () => Promise<SettlementWrite<readonly Settlement[]>>
}

export function useSettlements(): SettlementsController {
  const [state, setState] = useState<SettlementsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<SettlementFilters>(EMPTY_SETTLEMENT_FILTERS)
  const [selected, setSelected] = useState<ReadonlyMap<string, Settlement>>(new Map())
  const [token, setToken] = useState(0)

  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 상태가 아니라 참조인 이유는 이 값이 **한 번의 실행**에만 해당하기 때문이다.
   * 상태로 두면 조용히 한 번 읽은 뒤에 「다시 시도」를 누른 사람에게도 「불러오는
   * 중」이 영영 나타나지 않는다 (`use-commissions.ts` 와 같은 판단).
   */
  const quiet = useRef(false)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()
    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchSettlements(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          status: 'ready',
          settlements: page.settlements,
          nextCursor: page.nextCursor,
          totals: page.totals,
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, token])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아가고 **고른 것도 버린다.**
   *
   * 커서는 그 정렬과 그 필터 안에서만 위치를 뜻하므로 되돌리는 것이고(설계서 커서
   * 규약), 선택을 버리는 것은 그것과 다른 이유다: 화면에 보이지 않는 20건을 고른
   * 채로 「선택 승인」을 누르는 일을 만들지 않기 위해서다. 페이지를 **넘기는** 것은
   * 같은 목록을 계속 보는 일이라 선택이 유지된다.
   */
  const setFilters = useCallback(
    (next: SettlementFilters) => {
      setFiltersState(next)
      setSelected(new Map())
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const toggle = useCallback((row: Settlement, next: boolean) => {
    setSelected((previous) => {
      const copy = new Map(previous)

      if (next) copy.set(row.id, row)
      else copy.delete(row.id)

      return copy
    })
  }, [])

  /** 이 페이지에서 승인 대상이 될 수 있는 줄들. 머리글의 체크박스가 이것을 고른다. */
  const approvable = useMemo(
    () =>
      state.status === 'ready'
        ? state.settlements.filter((settlement) => canBulkApprove(settlement.status))
        : [],
    [state],
  )

  const togglePage = useCallback(
    (next: boolean) => {
      setSelected((previous) => {
        const copy = new Map(previous)

        for (const row of approvable) {
          if (next) copy.set(row.id, row)
          else copy.delete(row.id)
        }

        return copy
      })
    },
    [approvable],
  )

  const clearSelection = useCallback(() => {
    setSelected(new Map())
  }, [])

  /**
   * 고른 것을 한꺼번에 승인한다 (F6).
   *
   * **성공한 것을 선택에서 뺀다.** 실패한 것은 남겨 둔다 — 화면이 그 목록을 그리고,
   * 사람은 그것을 다시 보거나 하나씩 열어 봐야 한다. 전부 지워 버리면 「8건
   * 승인됐다」만 남고 남은 2건은 어디에서도 다시 나타나지 않는다.
   */
  const approveSelected = useCallback(async (): Promise<
    SettlementWrite<BulkApproveSettlementsResponse>
  > => {
    try {
      const result = await approveSettlements([...selected.keys()])

      setSelected((previous) => {
        const copy = new Map(previous)

        for (const id of result.approved) copy.delete(id)

        return copy
      })
      quiet.current = true
      setToken((previous) => previous + 1)

      return { ok: true, value: result }
    } catch (error) {
      return { ok: false, failure: apiFailure(error) }
    }
  }, [selected])

  const collectAll = useCallback(async (): Promise<SettlementWrite<readonly Settlement[]>> => {
    const collected: Settlement[] = []
    let cursorAt: string | null = null
    let pages = 0

    try {
      do {
        const page: SettlementListResponse = await fetchSettlements({
          ...queryOf(filters),
          limit: SETTLEMENT_LIST_MAX_LIMIT,
          ...(cursorAt === null ? {} : { cursor: cursorAt }),
        })

        collected.push(...page.settlements)
        cursorAt = page.nextCursor
        pages += 1
      } while (cursorAt !== null && pages < EXPORT_PAGE_LIMIT)

      return { ok: true, value: collected }
    } catch (error) {
      return { ok: false, failure: apiFailure(error) }
    }
  }, [filters])

  const narrowed = useMemo(() => isNarrowed(filters), [filters])

  return {
    approveSelected,
    clearSelection,
    collectAll,
    filters,
    narrowed,
    pagination,
    reload,
    selected,
    setFilters,
    state,
    toggle,
    togglePage,
  }
}
