'use client'

import type { ApiFailure, ClaimAction, ClaimStatus, SellerClaimDetail } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import type { ClaimActionCommand } from './claim-console'
import { commandFor } from './claim-console'
import { fetchSellerClaim, inspectReturn, pickUpReturn, transitionClaim } from './console-api'
import type { SellerClaimWrite } from './use-seller-claims'

/**
 * 클레임 하나와 **지금 밟을 수 있는 걸음**.
 *
 * 주문 상세(`use-seller-order.ts`)와 다른 것이 하나 있다: 버튼을 따로 부르지 않는다.
 * `GET /seller-claims/:id` 가 항목·사진·환불 예정액·기한·버튼을 **한 응답**에 싣기
 * 때문이고, 나눠 부르면 그 응답들이 서로 다른 순간을 본다 — 그때 판매자는 「1,000원」을
 * 보면서 「2,000원」을 승인한다.
 *
 * 쓰기가 끝나면 다시 읽는다. 상태가 바뀌면 버튼도 금액도 반드시 바뀌고, 응답의 조각으로
 * 화면을 기우는 것보다 한 번 더 읽는 편이 싸고 무엇보다 **틀리지 않는다.**
 */

export type SellerClaimState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly claim: SellerClaimDetail }

/**
 * 걸음 하나의 결말.
 *
 * `changed` 를 함께 돌려주는 것은 전이가 **멱등**이기 때문이다 — 이미 그 상태면 아무
 * 일도 하지 않고 성공한다. 화면이 그 둘을 구분하지 않으면 두 번 누른 사람이 「처리
 * 했습니다」를 두 번 보고, 두 번째가 실제로 무엇을 했는지는 아무도 모른다.
 */
export interface SellerClaimOutcome {
  readonly status: ClaimStatus
  readonly changed: boolean
}

export interface SellerClaimController {
  readonly state: SellerClaimState
  readonly reload: () => void
  /**
   * 서버가 준 걸음 하나를 실제로 밟는다.
   *
   * **`route` 로 세 문을 가르는 자리가 여기다.** 화면은 어느 문인지 묻지 않고 버튼만
   * 그린다 — 그 판단이 화면에 흩어지면 「반품완료인데 아무 일도 일어나지 않은 반품」이
   * 만들어지고, 그것은 아무 오류도 내지 않는다.
   */
  readonly run: (
    action: ClaimAction,
    input?: { readonly reason?: string },
  ) => Promise<SellerClaimWrite<SellerClaimOutcome>>
  /** 쓰기가 도는 동안. 중복 클릭을 막는 데 쓴다 (U3). */
  readonly busy: boolean
}

export function useSellerClaim(claimId: string): SellerClaimController {
  const [state, setState] = useState<SellerClaimState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const answer = await fetchSellerClaim(claimId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ status: 'ready', claim: answer.claim })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [claimId, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const run = useCallback(
    async (
      action: ClaimAction,
      input: { readonly reason?: string } = {},
    ): Promise<SellerClaimWrite<SellerClaimOutcome>> => {
      setBusy(true)

      try {
        const outcome = await runCommand(claimId, commandFor(action, input))

        setReloadToken((token) => token + 1)

        return { ok: true, value: outcome }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        setBusy(false)
      }
    },
    [claimId],
  )

  return { state, reload, run, busy }
}

/**
 * 명령 하나를, 그것을 여는 문으로.
 *
 * 훅 밖의 함수인 것은 이 판단이 렌더와 아무 상관이 없기 때문이다 — `switch` 의 세 갈래
 * 전부가 판별 유니온에서 나오므로, 문이 하나 늘면 컴파일러가 여기서 답을 요구한다.
 *
 * **수거와 검수도 클레임 상태를 옮긴다.** 그래서 셋 다 옮겨진 상태를 돌려줄 수 있고,
 * 그 값이 「처리했습니다」의 주어가 된다.
 */
async function runCommand(
  claimId: string,
  command: ClaimActionCommand,
): Promise<SellerClaimOutcome> {
  switch (command.route) {
    case 'pickup': {
      const answer = await pickUpReturn(claimId)

      return { status: answer.claim.status, changed: true }
    }
    case 'inspection': {
      const answer = await inspectReturn(claimId, {
        passed: command.passed,
        ...(command.note === null ? {} : { note: command.note }),
      })

      return { status: answer.claim.status, changed: true }
    }
    case 'transition': {
      const answer = await transitionClaim(claimId, {
        to: command.to,
        ...(command.reason === null ? {} : { reason: command.reason }),
      })

      return { status: answer.claim.status, changed: answer.changed }
    }
  }
}
