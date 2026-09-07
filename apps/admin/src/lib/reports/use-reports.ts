'use client'

import type { ApiFailure, HandleReportRequest, Report } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchReports, handleReport } from './console-api'
import type { ReportFilters } from './report-console'
import { EMPTY_REPORT_FILTERS, isNarrowed, queryOf } from './report-console'

/**
 * 한 페이지의 신고, 그 위의 필터, 그리고 처리 한 번.
 *
 * `lib/settlements/use-settlements.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도
 * 기다리지 않고, 커서는 `useCursorPagination` 이 들며, 필터가 바뀌면 첫 페이지로
 * 돌아간다. **닮은 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * ## 처리한 뒤에는 목록을 다시 읽는다
 *
 * 답으로 오는 것은 **그 신고 한 건**이지만 실제로 바뀌는 것은 그보다 많다: 서버는
 * 같은 대상의 다른 대기 신고도 함께 닫고(TASK-0091 4.7), `pendingCount` 도 그만큼
 * 줄며, 대상의 `targetHidden` 은 같은 대상을 가리키는 **다른 줄**에서도 달라진다.
 * 답을 그 줄에만 앉히면 화면은 방금 처리한 줄만 맞고 나머지는 틀린 상태로 남는다.
 *
 * 다시 읽기는 **조용하다.** 뼈대부터 다시 그리면 방금 무엇을 처리했는지가 화면에서
 * 사라지고, 그 자리에 「불러오는 중」이 한 번 스친다.
 */

export type ReportsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly reports: readonly Report[]
      readonly nextCursor: string | null
      /**
       * 처리 대기 건수 — **필터와 무관하다** (`reportListResponseSchema`). 화면이
       * 그 사실을 문장으로도 말해야 한다: 「반려」만 보고 있는 사람 앞에 12라는
       * 숫자가 서 있는 것은 설명 없이는 틀린 숫자로 보인다.
       */
      readonly pendingCount: number
    }

/**
 * 쓰기 하나의 결말.
 *
 * **`null` 이 세 번째 답이다** — 「아무것도 보내지 않았다」. 두 번 눌린 두 번째
 * 클릭이 그 자리이고, 그것을 실패로 돌려주면 화면은 방금 시작된 요청 위에 오류를
 * 그린다 (`use-settlement.ts` 와 같은 규약).
 */
export type ReportWrite =
  | { readonly ok: true; readonly report: Report }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface ReportsController {
  readonly state: ReportsState
  readonly filters: ReportFilters
  readonly setFilters: (filters: ReportFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  /** 쓰기가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  /** 숨김 · 삭제 · 반려 (F4 · F5 · F6). 셋이 한 문을 지난다. */
  readonly handle: (id: string, request: HandleReportRequest) => Promise<ReportWrite | null>
}

export function useReports(): ReportsController {
  const [state, setState] = useState<ReportsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<ReportFilters>(EMPTY_REPORT_FILTERS)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState(0)

  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 상태가 아니라 참조인 이유는 이 값이 **한 번의 실행**에만 해당하기 때문이다.
   * 상태로 두면 조용히 한 번 읽은 뒤에 「다시 시도」를 누른 사람에게도 「불러오는
   * 중」이 영영 나타나지 않는다 (`use-settlements.ts` 와 같은 판단).
   */
  const quiet = useRef(false)

  /**
   * 도는 중인지를 **ref 로도** 든다.
   *
   * 두 번 눌린 두 번째 클릭은 리액트가 `busy: true` 로 다시 그리기 **전에**
   * 도착한다 (`use-settlement.ts` 가 같은 이유로 같은 장치를 쓴다).
   */
  const inFlight = useRef(false)

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
        const page = await fetchReports(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          status: 'ready',
          reports: page.reports,
          nextCursor: page.nextCursor,
          pendingCount: page.pendingCount,
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
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 그 정렬과 그 필터 안에서만 위치를 뜻하므로 되돌리는 것이다 (설계서 커서
   * 규약).
   */
  const setFilters = useCallback(
    (next: ReportFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const handle = useCallback(
    async (id: string, request: HandleReportRequest): Promise<ReportWrite | null> => {
      // 이미 도는 중이면 **아무것도 보내지 않는다.** 실패가 아니라 무행동이다.
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)

      try {
        const answer = await handleReport(id, request)

        // 같은 대상의 다른 대기 신고도 함께 닫혔고 대기 건수도 줄었다. 그것을 아는
        // 유일한 방법이 다시 읽는 것이다 — 조용히.
        quiet.current = true
        setToken((previous) => previous + 1)

        return { ok: true, report: answer.report }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [],
  )

  const narrowed = useMemo(() => isNarrowed(filters), [filters])

  return { busy, filters, handle, narrowed, pagination, reload, setFilters, state }
}
