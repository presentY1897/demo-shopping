'use client'

import type { ApiFailure, CommissionRate, CommissionSimulationResponse } from '@shopping/shared'
import type { SetCommissionRateRequest } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchCommissionHistory,
  fetchCommissionSimulation,
  fetchOpenCommissionRates,
  setCommissionRate,
} from './console-api'
import type { CommissionChange, CommissionScopeSelection } from './scopes'
import { commissionChanges, scopeKey } from './scopes'

/**
 * 이 화면이 서버에 묻는 세 가지, 훅 셋으로.
 *
 * **하나로 합치지 않았다.** 셋의 수명이 다르기 때문이다: 열려 있는 요율은 화면이 열릴
 * 때 한 번과 저장 뒤에 다시 읽히고, 이력은 **고른 범위**가 바뀔 때마다, 미리보기는
 * 거기에 더해 **타이핑할 때마다** 읽힌다. 한 훅이 셋을 들면 요율 칸에 글자 하나를
 * 칠 때마다 목록과 이력이 함께 다시 나간다.
 *
 * `use-platform-coupons.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고,
 * 쓰기는 던지지 않고 값으로 답하며(부르는 쪽이 전부 폼과 토스트다), 쓰기 뒤의 다시
 * 읽기는 **조용하다**. 저장 한 번에 목록이 통째로 사라졌다가 돌아오면, 방금 무엇을
 * 바꿨는지가 화면에서 사라진다.
 */

export type CommissionRatesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      /** 지금 열려 있는 요율 전부. 범위별로 나누는 것은 화면의 몫이다. */
      readonly rates: readonly CommissionRate[]
      /**
       * 아무 요율도 설정되지 않았을 때 쓰이는 값 (`commissionRateListResponseSchema`).
       *
       * **0이 아니다.** 화면이 이 값을 그려야 「아직 정하지 않았다」가 보인다.
       */
      readonly fallbackRateBp: number
    }

/** 저장 한 번의 결과. 실패는 값이고, 문장으로 바꾸는 것은 화면의 몫이다. */
export type CommissionMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: ApiFailure }

export interface CommissionRatesController {
  readonly state: CommissionRatesState
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  readonly save: (request: SetCommissionRateRequest) => Promise<CommissionMutationResult>
}

export function useCommissionRates(): CommissionRatesController {
  const [state, setState] = useState<CommissionRatesState>({ status: 'loading' })
  const [token, setToken] = useState(0)
  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 상태가 아니라 참조인 이유는 이 값이 **한 번의 실행**에만 해당하기 때문이다.
   * 상태로 두면 조용히 한 번 읽은 뒤에 「다시 시도」를 누른 사람에게도 「불러오는
   * 중」이 영영 나타나지 않는다 (`use-platform-coupons.ts` 와 같은 판단).
   */
  const quiet = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchOpenCommissionRates({ signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ fallbackRateBp: page.fallbackRateBp, rates: page.rates, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [token])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setToken((previous) => previous + 1)
  }, [])

  const save = useCallback(
    async (request: SetCommissionRateRequest): Promise<CommissionMutationResult> => {
      try {
        await setCommissionRate(request)
        // 응답의 요율 한 줄로 목록을 갈아 끼우지 않는다. 바뀐 것은 그 줄만이 아니라
        // **어느 범위가 어느 범위를 이기는가**이고, 그것은 목록 전체를 읽어야 보인다.
        quiet.current = true
        setToken((previous) => previous + 1)

        return { ok: true }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      }
    },
    [],
  )

  return { reload, save, state }
}

export type CommissionHistoryState =
  /** 범위가 아직 완결되지 않았다 — 「카테고리별」인데 카테고리를 고르지 않은 자리. */
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly changes: readonly CommissionChange[] }

export interface CommissionHistoryController {
  readonly state: CommissionHistoryState
  readonly reload: () => void
}

/**
 * 도착한 답과, **그 답이 어느 질문의 것인지.**
 *
 * 범위가 바뀌었는데 상태에는 앞 범위의 답이 남아 있으면, 새 답이 오기 전 한 프레임
 * 동안 **다른 범위의 이력이 이 범위의 것처럼** 그려진다. 효과가 먼저 「불러오는 중」을
 * 써 넣는 것으로도 막을 수 있지만 그것은 효과 안의 동기 `setState` 이고, 답에 질문을
 * 붙여 두면 그 판단이 렌더에서 끝난다 — 지금 그릴 것은 「이 답이 지금 묻고 있는
 * 것에 대한 답인가」 하나다.
 */
interface Answer<TState> {
  readonly key: string
  readonly state: TState
}

const IDLE = { status: 'idle' } as const

const LOADING = { status: 'loading' } as const

/**
 * **한 범위의** 이력 (F5).
 *
 * 범위 객체를 그대로 의존성에 두므로, 부르는 쪽은 그것을 `useMemo` 로 붙잡아 두어야
 * 한다. 렌더마다 새 객체를 넘기면 요청이 끝없이 다시 나간다.
 */
export function useCommissionHistory(
  scope: CommissionScopeSelection | null,
): CommissionHistoryController {
  const [answer, setAnswer] = useState<Answer<CommissionHistoryState> | null>(null)
  const [token, setToken] = useState(0)

  useEffect(() => {
    if (scope === null) return

    const controller = new AbortController()
    const key = scopeKey(scope)

    async function load(target: CommissionScopeSelection): Promise<void> {
      try {
        const page = await fetchCommissionHistory(target, { signal: controller.signal })

        if (controller.signal.aborted) return

        setAnswer({ key, state: { changes: commissionChanges(page.rates), status: 'ready' } })
      } catch (error) {
        if (controller.signal.aborted) return

        setAnswer({ key, state: { failure: apiFailure(error), status: 'error' } })
      }
    }

    void load(scope)

    return () => {
      controller.abort()
    }
  }, [scope, token])

  const reload = useCallback(() => {
    // 들고 있던 답을 버린다. 저장 직후의 다시 읽기도, 실패 뒤의 「다시 시도」도
    // **묻는 중**으로 돌아가야 누른 것이 화면에 나타난다.
    setAnswer(null)
    setToken((previous) => previous + 1)
  }, [])

  return { reload, state: stateOf(answer, scope === null ? null : scopeKey(scope)) }
}

/** 지금 묻고 있는 것에 대한 답, 또는 아직 묻지 않았다 · 묻는 중. */
function stateOf<TState>(
  answer: Answer<TState> | null,
  key: string | null,
): TState | typeof IDLE | typeof LOADING {
  if (key === null) return IDLE
  if (answer?.key !== key) return LOADING

  return answer.state
}

/**
 * 타이핑이 멈춘 뒤 미리보기를 부르기까지 기다리는 시간.
 *
 * 「3.5」를 치는 동안 `3` · `3.` · `3.5` 로 세 번 물어보는 것을 막는다. 중간의 두
 * 요청은 답이 오기 전에 버려지지만, 버려지는 요청도 서버가 30일치를 훑고 나서야
 * 버려진다.
 */
export const SIMULATION_DEBOUNCE_MS = 350

export type CommissionSimulationState =
  /** 범위나 요율이 아직 없다. 물어볼 것이 없다. */
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly result: CommissionSimulationResponse }

/**
 * 이 요율로 바꾸면 얼마가 달라지나 — **저장 버튼 옆에서** (F6).
 *
 * 저장한 뒤에 보여 주는 숫자는 통계이지 경고가 아니다. 요율은 모든 판매자의 다음
 * 정산을 한 번에 옮기는 값이라(`permissions.ts`), 그 크기를 누르기 **전에** 봐야
 * 뜻이 있다.
 *
 * 질문은 **범위와 요율의 쌍**이다. 요율만 바뀌어도 다른 질문이므로, 앞 요율의 답이
 * 새 요율의 답인 것처럼 서 있는 프레임이 없다.
 */
export function useCommissionSimulation(
  scope: CommissionScopeSelection | null,
  rateBp: number | null,
): CommissionSimulationState {
  const [answer, setAnswer] = useState<Answer<CommissionSimulationState> | null>(null)

  useEffect(() => {
    if (scope === null || rateBp === null) return

    const controller = new AbortController()
    const key = simulationKey(scope, rateBp)

    async function load(target: CommissionScopeSelection, proposed: number): Promise<void> {
      try {
        const result = await fetchCommissionSimulation(target, proposed, {
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        setAnswer({ key, state: { result, status: 'ready' } })
      } catch (error) {
        if (controller.signal.aborted) return

        setAnswer({ key, state: { failure: apiFailure(error), status: 'error' } })
      }
    }

    const timer = setTimeout(() => {
      void load(scope, rateBp)
    }, SIMULATION_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [scope, rateBp])

  return stateOf(answer, scope === null || rateBp === null ? null : simulationKey(scope, rateBp))
}

function simulationKey(scope: CommissionScopeSelection, rateBp: number): string {
  return `${scopeKey(scope)}#${String(rateBp)}`
}
