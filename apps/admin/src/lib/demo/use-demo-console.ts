'use client'

import type { AdminDemoAccount, ApiFailure, DemoPolicy, DemoStatsResponse } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { DemoSweepResponse } from './console-api'
import {
  expireDemoAccount,
  fetchDemoAccounts,
  fetchDemoPolicy,
  fetchDemoStats,
  sweepDemoAccounts,
  updateDemoPolicy,
} from './console-api'
import type { DemoPeriodProblem, DemoStatsPeriod } from './demo-console'
import { defaultDemoStatsPeriod, periodProblem } from './demo-console'

/**
 * 데모 관리 화면이 읽는 것들 — **세 갈래로 따로** (TASK-0096).
 *
 * 훅이 셋인 것이 설계다(`use-dashboard.ts` 와 같은 판단). 정책은 거의 안 바뀌고,
 * 계정 목록은 정리가 돌 때마다 바뀌며, 통계는 기간이 바뀔 때만 다시 묻는다. 하나로
 * 묶어 `Promise.all` 로 기다리면 가장 느린 것이 나머지를 붙잡고, 하나라도 실패하면
 * 화면이 통째로 빈다 — 이 화면에서 그것은 「데모가 죽었나」로 읽힌다.
 *
 * **정리를 여기서 다시 만들지 않는다** (4.1). 강제 만료도 재시도도 청소기의 문을
 * 지나고, 이 파일이 하는 일은 그 문을 부른 뒤 **무엇이 달라졌는지 다시 읽는 것**뿐이다.
 */

export type DemoSectionState<TData> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly data: TData }

/** `use-users.ts` 의 `UserWrite` 와 같은 모양. `null` 은 「아무것도 보내지 않았다」다. */
export type DemoWrite<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: ApiFailure }

/**
 * 한 섹션의 읽기 한 번.
 *
 * `load` 는 **부르는 쪽이 기억해 둔 함수**여야 한다(`useCallback`). 매 렌더마다 새
 * 함수를 넘기면 이 효과가 매 렌더마다 다시 돌고, 그것은 화면이 스스로를 무한히 다시
 * 읽는 일이다 — 화면은 멀쩡히 그려지고 달라지는 것은 서버 부하뿐이라 조용하다
 * (`lib/dashboard/use-dashboard.ts` 의 `useSection` 과 같은 규약).
 *
 * `enabled` 가 거짓이면 **아무것도 하지 않는다.** 상태를 `loading` 으로 되돌리지도
 * 않는다 — 답이 오는 중이 아니므로 뼈대를 그리면 그것이 영영 돈다.
 */
function useSection<TData>(
  load: (signal: AbortSignal) => Promise<TData>,
  enabled = true,
): {
  readonly state: DemoSectionState<TData>
  readonly reload: () => void
} {
  const [state, setState] = useState<DemoSectionState<TData>>({ status: 'loading' })
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

/** 도는 중이면 아무것도 보내지 않는다. 두 번째 클릭이 두 번째 요청이 되지 않게 (U3). */
function useWriter(): {
  readonly busy: boolean
  readonly run: <TValue>(call: () => Promise<TValue>) => Promise<DemoWrite<TValue> | null>
} {
  const [busy, setBusy] = useState(false)

  /** 두 번 눌린 두 번째 클릭은 리액트가 다시 그리기 **전에** 도착한다. */
  const inFlight = useRef(false)

  const run = useCallback(
    async <TValue>(call: () => Promise<TValue>): Promise<DemoWrite<TValue> | null> => {
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)

      try {
        return { ok: true, value: await call() }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [],
  )

  return { busy, run }
}

/* --------------------------------------------------------------- 정책 -- */

export interface DemoPolicyController {
  readonly state: DemoSectionState<DemoPolicy>
  readonly reload: () => void
  readonly busy: boolean
  /** 저장한다 (F6). 답이 **저장된 정책 전체**라 그대로 앉힌다. */
  readonly save: (policy: DemoPolicy) => Promise<DemoWrite<DemoPolicy> | null>
}

export function useDemoPolicy(): DemoPolicyController {
  const section = useSection(
    // 껍데기를 여기서 벗긴다. 화면이 읽는 것은 정책이지 「정책을 담은 봉투」가 아니고,
    // 봉투를 그대로 들고 다니면 모든 사용처가 `.policy` 를 한 번씩 적게 된다.
    useCallback(async (signal: AbortSignal) => (await fetchDemoPolicy({ signal })).policy, []),
  )
  const { busy, run } = useWriter()
  const { reload } = section

  const save = useCallback(
    async (policy: DemoPolicy): Promise<DemoWrite<DemoPolicy> | null> => {
      const result = await run(() => updateDemoPolicy(policy))

      // 답을 그대로 다시 읽는다. 화면이 자기가 보낸 값을 앉히면, 서버가 다른 값을
      // 저장한 날(정규화·상한 적용) 화면만 옛 값을 보여 준다.
      if (result?.ok === true) {
        reload()

        return { ok: true, value: result.value.policy }
      }

      return result
    },
    [reload, run],
  )

  return { busy, reload, save, state: section.state }
}

/* ------------------------------------------------------------- 계정 목록 -- */

export interface DemoAccountsPage {
  readonly accounts: readonly AdminDemoAccount[]
  readonly nextCursor: string | null
}

export interface DemoAccountsController {
  readonly state: DemoSectionState<DemoAccountsPage>
  /** 정리에 실패한 계정만 보기 (F4). */
  readonly failedOnly: boolean
  readonly setFailedOnly: (next: boolean) => void
  readonly pagination: CursorPagination
  readonly reload: () => void
  readonly busy: boolean
  /** 강제 만료 (F2). **지우지 않는다** — 만료 시각이 앞으로 당겨질 뿐이다. */
  readonly expire: (userId: string) => Promise<DemoWrite<undefined> | null>
  /** 지금 한 번 정리한다 (F5). 실패 건의 「재시도」가 부르는 것과 같은 문이다. */
  readonly sweep: () => Promise<DemoWrite<DemoSweepResponse> | null>
}

/**
 * 계정 목록만 `useSection` 을 쓰지 않는다.
 *
 * 커서가 그 이유다. `useCursorPagination` 은 **지금 답이 준** `nextCursor` 를 받아야
 * 하고 질의는 그것이 정한 커서를 실어야 하므로, 상태를 훅 안에 감춘 `useSection` 으로는
 * 그 두 방향을 이을 수 없다 — 이으려면 상태를 하나 더 만들어 답을 베껴 두게 되고, 그
 * 베끼기는 한 박자 늦는다 (`use-reports.ts` 가 같은 이유로 같은 모양이다).
 */
export function useDemoAccounts(): DemoAccountsController {
  const [state, setState] = useState<DemoSectionState<DemoAccountsPage>>({ status: 'loading' })
  const [failedOnly, setFailedOnlyState] = useState(false)
  const [token, setToken] = useState(0)

  /** 이번 다시 읽기가 조용한 것인가. 한 번의 실행에만 해당하므로 상태가 아니다. */
  const quiet = useRef(false)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.data.nextCursor : null,
  })
  const { cursor, reset } = pagination
  const { busy, run } = useWriter()

  useEffect(() => {
    const controller = new AbortController()
    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchDemoAccounts(
          { ...(failedOnly ? { failedOnly: true } : {}), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ data: page, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [cursor, failedOnly, token])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const refresh = useCallback(() => {
    quiet.current = true
    setToken((previous) => previous + 1)
  }, [])

  const setFailedOnly = useCallback(
    (next: boolean) => {
      setFailedOnlyState(next)
      reset()
    },
    [reset],
  )

  const expire = useCallback(
    async (userId: string): Promise<DemoWrite<undefined> | null> => {
      const result = await run(() => expireDemoAccount(userId))

      // 만료 시각이 바뀌었을 뿐 계정은 그대로 목록에 있다. 조용히 다시 읽어 그
      // 시각을 최신으로 만든다 — 뼈대부터 다시 그리면 방금 무엇을 했는지가 사라진다.
      if (result?.ok === true) refresh()

      return result
    },
    [refresh, run],
  )

  const sweep = useCallback(async (): Promise<DemoWrite<DemoSweepResponse> | null> => {
    const result = await run(sweepDemoAccounts)

    if (result?.ok === true) refresh()

    return result
  }, [refresh, run])

  return {
    busy,
    expire,
    failedOnly,
    pagination,
    reload,
    setFailedOnly,
    state,
    sweep,
  }
}

/* --------------------------------------------------------------- 통계 -- */

export interface DemoStatsController {
  readonly state: DemoSectionState<DemoStatsResponse>
  readonly period: DemoStatsPeriod
  readonly setPeriod: (period: DemoStatsPeriod) => void
  /** 지금 고른 기간이 물을 수 없는 것이면 왜인지. 물을 수 있으면 `null`. */
  readonly problem: DemoPeriodProblem | null
  readonly reload: () => void
}

/**
 * 발급 통계 (F7).
 *
 * **잘못 고른 기간에서는 부르지 않는다.** 서버는 거꾸로 고른 기간을 하루로, 너무 긴
 * 기간을 끝에서부터 잘라 200 으로 답한다(`rangeOf`) — 그대로 보내면 운영자가 보는
 * 것은 자기가 고른 적 없는 기간이고, 그것은 「날짜를 거꾸로 골랐다」와 전혀 다른
 * 문장이다 (`use-dashboard.ts` 와 같은 규약).
 */
export function useDemoStats(now: Date = new Date()): DemoStatsController {
  // 첫 기간은 **마운트 순간에 한 번** 정한다. 매 렌더마다 다시 계산하면 자정을 넘길
  // 때 화면이 스스로 다른 기간으로 옮겨 간다.
  const [period, setPeriod] = useState<DemoStatsPeriod>(() => defaultDemoStatsPeriod(now))
  const problem = periodProblem(period)

  const load = useCallback((signal: AbortSignal) => fetchDemoStats(period, { signal }), [period])
  // 물을 수 없는 기간에서는 **직전에 읽은 것을 그대로 둔다.** 날짜 한 칸을 고치는
  // 도중에 화면까지 비면 고치는 내내 깜빡인다.
  const section = useSection(load, problem === null)

  return { period, problem, reload: section.reload, setPeriod, state: section.state }
}
