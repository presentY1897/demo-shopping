'use client'

import type {
  ApiFailure,
  Claim,
  ClaimableResponse,
  ClaimFault,
  ClaimItemInput,
  ClaimReturnDetails,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { createClaim, fetchClaimable } from './claims-api'

/**
 * `/mypage/orders/[id]/claim` 뒤의 신청 하나 (TASK-0066).
 *
 * ## 「무엇을 신청할 수 있나」를 먼저 묻는다
 *
 * 신청서를 그리기 전에 `GET /seller-orders/:id/claimable` 을 부른다. 거절을 오류로만
 * 돌려받으면 화면은 **눌러 보고서야** 알게 되고, 그때 사람은 이미 사유를 다 적은
 * 뒤다. 잔여 수량도 그 답에서 온다 — 화면이 「주문 수량 − 신청한 수량」을 계산하면
 * **다른 탭에서 방금 신청한 것이 반영되지 않는다.**
 *
 * ## 보낸 뒤에 다시 읽지 않는다
 *
 * `POST /claims` 의 답이 만들어진 클레임을 통째로 싣는다. 그 안의 `status` 가
 * 「자동 승인됐다」와 「판매자를 기다린다」를 가르므로, 화면이 그것을 다시 물으면
 * 그 사이의 낡은 답을 그릴 뿐 새로 알게 되는 것이 없다.
 *
 * ## 성공 뒤에 목록을 새로 읽지 않는 이유
 *
 * 신청이 끝나면 이 화면은 **결과 화면**이 된다. 잔여 수량이 줄어든 목록을 다시
 * 그릴 자리가 없고, 다시 신청하려는 사람은 주문 상세를 거쳐 돌아온다 — 그때는
 * 서버가 새 잔여를 답한다.
 */

export type ClaimableState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly claimable: ClaimableResponse }

export type ClaimSubmission =
  | { readonly ok: true; readonly claim: Claim }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface ClaimRequest {
  readonly state: ClaimableState
  readonly reload: () => void
  /**
   * 보낸 결과. 성공하면 이 화면은 결과 화면이 된다.
   *
   * **귀책과 반품 부속이 둘 다 실릴 수 있는 모양인 것은 계약이 그렇기 때문**이고,
   * 정확히 하나만 실어야 한다는 것도 계약이 지킨다 (`createClaimRequestSchema`).
   * 화면이 어느 쪽을 실을지는 `claimable.type` 이 답한 뒤에 정해진다.
   */
  readonly submit: (input: {
    readonly items: readonly ClaimItemInput[]
    readonly reason: string
    readonly fault: ClaimFault | null
    readonly return: ClaimReturnDetails | null
  }) => Promise<ClaimSubmission>
  /** 보내는 중인가. 중복 클릭을 막는 값이다 (U3). */
  readonly submitting: boolean
}

export function useClaimRequest(sellerOrderId: string): ClaimRequest {
  const [state, setState] = useState<ClaimableState>({ status: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const claimable = await fetchClaimable(sellerOrderId, { signal: controller.signal })

        if (controller.signal.aborted) return
        setState({ status: 'ready', claimable })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sellerOrderId, reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  const submit = useCallback<ClaimRequest['submit']>(
    async (input) => {
      setSubmitting(true)

      try {
        // 계약이 `items` 와 `photoKeys` 를 가변 배열로 요구한다 (zod 가 만드는
        // 타입이다). 화면 쪽은 읽기 전용으로 다루므로 여기서 한 번 베낀다.
        const { claim } = await createClaim({
          sellerOrderId,
          ...input,
          items: [...input.items],
          return:
            input.return === null
              ? null
              : { ...input.return, photoKeys: [...input.return.photoKeys] },
        })

        return { ok: true, claim }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        setSubmitting(false)
      }
    },
    [sellerOrderId],
  )

  return { reload, state, submit, submitting }
}
