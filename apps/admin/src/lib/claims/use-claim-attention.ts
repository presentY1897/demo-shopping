'use client'

import type { AdminClaimListItem, AdminFailedRefund, ApiFailure } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchFailedRefunds, fetchOverdueClaims } from './console-api'

/**
 * **지금 손봐야 할 것** — 기한을 넘긴 클레임과 나가지 못한 환불 (F7).
 *
 * 한 훅에 둘이 있는 이유는 **한 질문의 두 답**이기 때문이다. 관리자 대시보드와
 * 클레임 화면이 묻는 것은 「지금 개입이 필요한가」 하나이고, 그것을 두 훅으로 나누면
 * 그 질문에 답하는 자리마다 둘을 다시 조립하게 된다.
 *
 * **두 상태를 따로 든다.** 한 상태로 접으면 환불 목록이 실패했을 때 멀쩡한 지연
 * 목록까지 오류 화면으로 덮이고, 그 반대도 마찬가지다 — 둘은 서로 다른 라우트이고
 * 한쪽만 죽는 것이 정상적인 실패 모양이다.
 *
 * 커서가 없는 것은 계약의 판단이다. 지연은 「지금 처리할 것」이라 페이지가 아니라
 * 상한이 있고(`truncated`), 실패한 환불은 정상 흐름에서 0건이라 페이지가 필요해진
 * 상태 자체가 사고다(`hasMore`).
 */

export type OverdueState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly claims: readonly AdminClaimListItem[]
      readonly truncated: boolean
    }

export type FailedRefundState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly refunds: readonly AdminFailedRefund[]
      readonly hasMore: boolean
    }

export interface ClaimAttention {
  readonly overdue: OverdueState
  readonly refunds: FailedRefundState
  readonly reload: () => void
}

export function useClaimAttention(limit: number): ClaimAttention {
  const [overdue, setOverdue] = useState<OverdueState>({ status: 'loading' })
  const [refunds, setRefunds] = useState<FailedRefundState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    /**
     * 두 요청을 **나란히** 보낸다.
     *
     * 하나가 실패해도 다른 하나는 그대로 도착한다 — 둘은 서로 다른 라우트이고, 한쪽만
     * 죽는 것이 정상적인 실패 모양이다. `await` 로 줄 세우면 앞엣것이 던지는 순간
     * 뒤엣것은 시작조차 하지 않는다.
     */
    async function load(): Promise<void> {
      setOverdue({ status: 'loading' })
      setRefunds({ status: 'loading' })

      await Promise.all([
        fetchOverdueClaims(limit, { signal })
          .then((answer) => {
            if (!signal.aborted) {
              setOverdue({ status: 'ready', claims: answer.claims, truncated: answer.truncated })
            }
          })
          .catch((error: unknown) => {
            if (!signal.aborted) setOverdue({ status: 'error', failure: apiFailure(error) })
          }),
        fetchFailedRefunds(limit, { signal })
          .then((answer) => {
            if (!signal.aborted) {
              setRefunds({ status: 'ready', refunds: answer.refunds, hasMore: answer.hasMore })
            }
          })
          .catch((error: unknown) => {
            if (!signal.aborted) setRefunds({ status: 'error', failure: apiFailure(error) })
          }),
      ])
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [limit, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return { overdue, refunds, reload }
}
