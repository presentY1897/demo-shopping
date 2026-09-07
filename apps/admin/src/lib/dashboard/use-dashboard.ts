'use client'

import type {
  ApiFailure,
  DashboardMetricsResponse,
  DashboardPendingResponse,
  DashboardSystemResponse,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchDashboardMetrics, fetchDashboardPending, fetchDashboardSystem } from './console-api'
import type { DashboardPeriod, PeriodProblem } from './dashboard-console'
import { defaultDashboardPeriod, periodProblem } from './dashboard-console'

/**
 * 세 문을 **따로** 읽는다 (TASK-0092 4.1).
 *
 * 훅이 셋인 것이 설계다. 하나로 묶어 `Promise.all` 로 기다리면 가장 느린 것이 나머지를
 * 붙잡고, 하나라도 실패하면 화면이 통째로 빈다 — 대시보드에서 그것은 「지표를 못
 * 읽었다」가 아니라 「플랫폼이 죽었나」로 읽힌다. 나눠 두면 섹션 하나가 비어도 나머지는
 * 그려지고, **그것이 문이 셋인 이유다.**
 *
 * 뼈대는 `use-seller-revenue.ts` · `use-reports.ts` 와 같다 — 서버 렌더에서 아무것도
 * 기다리지 않고, 효과 안에서 한 번 부르며, 다시 읽기는 토큰 하나가 연다. **닮은 훅을
 * 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 */

/** 섹션 하나가 있을 수 있는 세 상태. 넷째(빈 상태)는 답의 내용이지 요청의 결과가 아니다. */
export type SectionState<TData> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly data: TData }

export interface DashboardSection<TData> {
  readonly state: SectionState<TData>
  /** 이 섹션만 다시 읽는다. 옆 섹션이 살아 있는데 함께 껌뻑일 이유가 없다. */
  readonly reload: () => void
}

/**
 * 한 섹션의 읽기 한 번.
 *
 * `load` 는 **부르는 쪽이 기억해 둔 함수**여야 한다(`useCallback`). 매 렌더마다 새
 * 함수를 넘기면 이 효과가 매 렌더마다 다시 돌고, 그것은 대시보드가 스스로를 무한히
 * 다시 읽는 일이다 — 화면은 멀쩡히 그려지고 달라지는 것은 서버 부하뿐이라 조용하다.
 *
 * `enabled` 가 거짓이면 **아무것도 하지 않는다.** 상태를 `loading` 으로 되돌리지도
 * 않는다 — 답이 오는 중이 아니므로 뼈대를 그리면 그것이 영영 돈다. 마지막으로 읽은
 * 답을 그대로 들고 있는 것이 사실에 맞다.
 */
function useSection<TData>(
  load: (signal: AbortSignal) => Promise<TData>,
  enabled = true,
): DashboardSection<TData> {
  const [state, setState] = useState<SectionState<TData>>({ status: 'loading' })
  const [token, setToken] = useState(0)

  useEffect(() => {
    if (!enabled) return undefined

    const controller = new AbortController()

    async function run(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const data = await load(controller.signal)

        // 이미 떠난 화면이다. 벗어난 컴포넌트에 상태를 앉히지 않는다.
        if (controller.signal.aborted) return

        setState({ data, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void run()

    return () => {
      controller.abort()
    }
  }, [enabled, load, token])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  return { reload, state }
}

export interface DashboardMetricsController extends DashboardSection<DashboardMetricsResponse> {
  readonly period: DashboardPeriod
  readonly setPeriod: (period: DashboardPeriod) => void
  /** 지금 고른 기간이 물을 수 없는 것이면 왜인지. 물을 수 있으면 `null`. */
  readonly problem: PeriodProblem | null
}

/**
 * 지표 · 추이 · 순위, 그리고 그 기간을 고르는 일 (F1 · F3).
 *
 * **잘못 고른 기간에서는 부르지 않는다.** 서버는 거꾸로 고른 기간을 하루로, 너무 긴
 * 기간을 끝에서부터 잘라 200 으로 답한다(`rangeOf`) — 그대로 보내면 운영자가 보는 것은
 * 「거래액 0원」이나 자기가 고른 적 없는 90일이고, 둘 다 「날짜를 거꾸로 골랐다」와
 * 전혀 다른 문장이다. 무엇이 잘못됐는지는 `problem` 이 들고 있고 화면이 그 칸 옆에
 * 적는다 (`revenue-console.ts` 와 같은 규약).
 */
export function useDashboardMetrics(now: Date = new Date()): DashboardMetricsController {
  // 첫 기간은 **마운트 순간에 한 번** 정한다. 매 렌더마다 다시 계산하면 자정을 넘길 때
  // 화면이 스스로 다른 기간으로 옮겨 간다.
  const [period, setPeriod] = useState<DashboardPeriod>(() => defaultDashboardPeriod(now))
  const problem = periodProblem(period)

  const load = useCallback(
    (signal: AbortSignal) => fetchDashboardMetrics(period, { signal }),
    [period],
  )
  // 물을 수 없는 기간에서는 **직전에 읽은 것을 그대로 둔다.** 날짜 한 칸을 고치는
  // 도중(사람이 「2026-09-」까지 친 순간)에 화면까지 비면 고치는 내내 깜빡인다.
  const section = useSection(load, problem === null)

  return { period, problem, reload: section.reload, setPeriod, state: section.state }
}

/** 지금 사람이 해야 할 일 (F2). 기간을 받지 않는다 — 계약이 그렇게 정해 두었다. */
export function useDashboardPending(): DashboardSection<DashboardPendingResponse> {
  return useSection(useCallback((signal: AbortSignal) => fetchDashboardPending({ signal }), []))
}

/** 배치들이 돌고 있는가 (F4). */
export function useDashboardSystem(): DashboardSection<DashboardSystemResponse> {
  return useSection(useCallback((signal: AbortSignal) => fetchDashboardSystem({ signal }), []))
}
