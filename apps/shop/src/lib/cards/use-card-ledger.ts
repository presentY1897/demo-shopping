'use client'

import type { ApiFailure } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import type { CardTransaction } from './cards-api'
import { fetchCardTransactions } from './cards-api'

/**
 * 카드 한 장의 사용 내역 (TASK-0058 F3 · F4).
 *
 * **카드마다 하나씩 걸리는 훅이지, 열린 카드를 갈아 끼우는 훅이 아니다.** 부르는
 * 쪽(`CardLedger`)이 열린 카드 안에서만 마운트되므로 `cardId` 는 이 훅이 사는 동안
 * 바뀌지 않고, 그래서 「카드가 바뀌었으니 `loading` 으로 되돌린다」는 상태 갱신이
 * 아예 필요 없다 — `useEffect` 안에서 동기적으로 `setState` 를 부르는 모양(React 19
 * 가 경고하는 그것)이 여기서는 만들어지지 않는다. 첫 상태가 곧 `loading` 이다.
 *
 * 목록과 따로 부르는 이유는 **원장이 카드마다 길기 때문**이다. 세 장을 그리려고 세
 * 벌의 원장을 미리 받아 두면, 대부분의 방문에서 아무도 펴 보지 않는 데이터를 세 번
 * 받는다. 펴 볼 때 부르는 것이 그 화면이 실제로 쓰는 만큼이다.
 */

export type CardLedgerState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly rows: readonly CardTransaction[] }

export interface CardLedgerConsole {
  readonly state: CardLedgerState
  readonly reload: () => void
}

export function useCardLedger(cardId: string): CardLedgerConsole {
  const [state, setState] = useState<CardLedgerState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const rows = await fetchCardTransactions(cardId, { signal: controller.signal })
        if (controller.signal.aborted) return

        setState({ status: 'ready', rows })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [cardId, reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  return { reload, state }
}
