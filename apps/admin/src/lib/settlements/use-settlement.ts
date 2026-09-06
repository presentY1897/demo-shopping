'use client'

import type { ApiFailure, Settlement, SettlementItem } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { approveSettlement, fetchSettlement, holdSettlement, paySettlement } from './console-api'
import type { SettlementAction } from './transitions'

/**
 * 정산서 한 장과, 관리자가 그것에 대해 할 수 있는 세 가지.
 *
 * `lib/claims/use-admin-claim.ts` 와 같은 뼈대다 — 없는 것은 오류가 아니라 빈
 * 상태이고, 쓰기는 던지지 않고 값으로 답하며, 두 번째 클릭은 두 번째 요청이 되지
 * 않는다.
 *
 * **답을 그대로 앉힌다.** 세 라우트가 전부 갱신된 정산서를 돌려주므로
 * (`settlementResponseSchema`) 다시 읽을 이유가 없다. 항목은 상태 전이로 바뀌지
 * 않는다 — 승인은 금액을 굳히는 선언이지 금액을 만드는 일이 아니다(TASK-0080 이
 * 배치를 그렇게 정했다).
 *
 * 두 번째 클릭이 특히 위험한 자리다. 지급 확정이 두 번 나가면 두 번째는 409 로
 * 거절되지만(`SETTLEMENT_WRONG_STATUS`), 그 거절은 「이미 지급됐다」와 「다른
 * 사람이 방금 지급했다」를 구별하지 못한 채 사람 앞에 선다.
 */

export type SettlementDetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'missing' }
  | {
      readonly status: 'ready'
      readonly settlement: Settlement
      readonly items: readonly SettlementItem[]
    }

/**
 * 쓰기 하나의 결말.
 *
 * **`null` 이 세 번째 답이다** — 「아무것도 보내지 않았다」. 두 번 눌린 두 번째
 * 클릭이 그 자리이고, 그것을 실패로 돌려주면 화면은 방금 시작된 요청 위에 오류를
 * 그린다.
 */
export type SettlementWriteResult =
  | { readonly ok: true; readonly settlement: Settlement }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface SettlementDetailController {
  readonly state: SettlementDetailState
  /** 쓰기가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  readonly reload: () => void
  /**
   * 승인 · 보류 · 지급을 한 문으로.
   *
   * 셋을 한 함수로 받는 이유는 **전이표를 우회하는 길을 하나도 만들지 않기**
   * 위해서다 (`settlement-console.service.ts` 의 `move` 가 같은 모양이다). 화면이
   * 내미는 버튼은 `actionsFor` 가 정하고, 그 값이 그대로 여기 들어온다.
   *
   * 보류의 사유는 여기서 검사하지 않는다 — 빈 사유는 애초에 대화상자를 지나지
   * 못하고(폼 스키마), 계약도 DB 도 같은 것을 거절한다.
   */
  readonly run: (action: SettlementAction, reason: string) => Promise<SettlementWriteResult | null>
}

export function useSettlement(settlementId: string): SettlementDetailController {
  const [state, setState] = useState<SettlementDetailState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState(0)

  /**
   * 도는 중인지를 **ref 로도** 든다.
   *
   * 두 번 눌린 두 번째 클릭은 리액트가 `busy: true` 로 다시 그리기 **전에**
   * 도착한다 (`use-admin-claim.ts` 가 같은 이유로 같은 장치를 쓴다).
   */
  const inFlight = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const answer = await fetchSettlement(settlementId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ status: 'ready', settlement: answer.settlement, items: answer.items })
      } catch (error) {
        if (controller.signal.aborted) return

        const failure = apiFailure(error)

        // 없는 정산서는 오류가 아니라 **빈 상태**다. 「다시 시도」를 내밀면 몇 번을
        // 눌러도 같은 404 가 오고, 할 일은 목록으로 돌아가는 것이다.
        setState(
          failure.kind === 'http' && failure.status === 404
            ? { status: 'missing' }
            : { status: 'error', failure },
        )
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [settlementId, token])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const run = useCallback(
    async (action: SettlementAction, reason: string): Promise<SettlementWriteResult | null> => {
      // 이미 도는 중이면 **아무것도 보내지 않는다.** 실패가 아니라 무행동이다.
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)

      try {
        const answer = await send(settlementId, action, reason)

        // 답이 곧 갱신된 이 정산서다. 항목은 상태 전이로 바뀌지 않으므로 그대로 둔다.
        setState((previous) =>
          previous.status === 'ready' ? { ...previous, settlement: answer.settlement } : previous,
        )

        return { ok: true, settlement: answer.settlement }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [settlementId],
  )

  return { busy, reload, run, state }
}

/** 판단 하나를 그 라우트로. 표는 `transitions.ts` 에 있고 여기는 배선뿐이다. */
function send(id: string, action: SettlementAction, reason: string) {
  if (action === 'approve') return approveSettlement(id)
  if (action === 'hold') return holdSettlement(id, reason)

  return paySettlement(id)
}
