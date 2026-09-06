'use client'

import type { ApiFailure, SettlementDetailResponse } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchSellerSettlement } from './console-api'

/**
 * 정산서 한 장과 그 계산 근거.
 *
 * `use-seller-claim.ts` 와 같은 뼈대이고, **쓰기가 하나도 없다** — 판매자가 정산서에
 * 대해 할 수 있는 일은 읽는 것뿐이다. 승인·보류·지급은 관리자의 것이고(TASK-0081),
 * 여기에 버튼을 두면 누를 수 없는 버튼을 설명하는 문장이 따라붙는다.
 *
 * 정산서와 항목을 **한 응답**으로 읽는다. 나눠 부르면 두 답이 서로 다른 순간을 보고,
 * 그때 판매자는 합계와 맞지 않는 항목 목록을 본다.
 */

export type SellerSettlementState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly detail: SettlementDetailResponse }

export interface SellerSettlementController {
  readonly state: SellerSettlementState
  readonly reload: () => void
}

export function useSellerSettlement(settlementId: string): SellerSettlementController {
  const [state, setState] = useState<SellerSettlementState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const detail = await fetchSellerSettlement(settlementId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ detail, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [settlementId, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return { reload, state }
}
