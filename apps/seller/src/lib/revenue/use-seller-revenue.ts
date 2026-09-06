'use client'

import type { ApiFailure, SellerRevenueResponse } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchSellerRevenue } from './console-api'
import type { RevenuePeriod } from './revenue-console'
import { defaultRevenuePeriod, periodProblem } from './revenue-console'

/**
 * 한 기간의 매출과, 그 기간을 고르는 일.
 *
 * `use-seller-claim.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고,
 * 효과 안에서 한 번 부르며, 다시 읽기는 토큰 하나가 연다. **닮은 훅을 새 규약으로
 * 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 다른 것이 둘 있다.
 *
 * **기간이 상태이면서 질의다.** 그래서 잘못 고른 기간에서는 **부르지 않는다** —
 * 거꾸로 고른 날짜를 그대로 보내면 서버는 0원으로 답하고, 판매자가 보는 것은
 * 「매출이 없다」이지 「날짜를 거꾸로 골랐다」가 아니다. 무엇이 잘못됐는지는
 * `problem` 이 들고 있고 화면이 그 칸 옆에 적는다.
 *
 * **`sellerId` 를 받지 않는다.** 서버가 부르는 사람의 스토어에서 정한다. 스토어가
 * 없는 계정에 이 훅을 마운트하지 않는 것은 **화면의 판단**이고(쿠폰 목록과 같은
 * 규약), 그 판단을 훅이 알면 부르지 않는 이유가 두 곳에 적히게 된다.
 */

export type SellerRevenueState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly revenue: SellerRevenueResponse }

export interface SellerRevenueController {
  readonly state: SellerRevenueState
  readonly period: RevenuePeriod
  readonly setPeriod: (period: RevenuePeriod) => void
  /** 지금 고른 기간이 물을 수 없는 것이면 왜인지. 물을 수 있으면 `null`. */
  readonly problem: ReturnType<typeof periodProblem>
  readonly reload: () => void
}

export function useSellerRevenue(now: Date = new Date()): SellerRevenueController {
  // 첫 기간은 **마운트 순간에 한 번** 정한다. 매 렌더마다 다시 계산하면 자정을 넘길
  // 때 화면이 스스로 다른 기간으로 옮겨 간다.
  const [period, setPeriod] = useState<RevenuePeriod>(() => defaultRevenuePeriod(now))
  const [state, setState] = useState<SellerRevenueState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  const problem = periodProblem(period)

  useEffect(() => {
    if (problem !== null) return undefined

    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const revenue = await fetchSellerRevenue(period, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ revenue, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [period, problem, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return { period, problem, reload, setPeriod, state }
}
