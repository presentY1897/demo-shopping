'use client'

import type { CartResponse } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { publishCartCount } from './cart-count'
import { fetchCart, removeItems, updateQuantity } from './cart-api'
import type { Selection } from './selection'
import { initialSelection, reconcile } from './selection'

/**
 * 장바구니 화면의 상태 (TASK-0046).
 *
 * **선택은 서버에 없다.** 무엇을 고를지는 이 탭에서 지금 일어나는 일이고, 저장하면
 * 다른 기기에서 연 장바구니가 남이 고른 것을 보여 준다. 그래서 선택은 여기 살고,
 * 응답이 새로 올 때마다 사라진 줄을 털어 낸다({@link reconcile}) — 없는 줄의 id 가
 * 남으면 합계가 화면과 다른 숫자를 낸다.
 *
 * 실패는 **화면 전체의 상태**다. 홈의 섹션과 다르다 — 신상품 줄이 비어 있는 홈은
 * 여전히 쓸 수 있지만, 장바구니가 비어 보이는 장바구니는 「비었다」는 거짓말이다.
 */

export type CartState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly cart: CartResponse }

export interface CartStore {
  readonly state: CartState
  readonly selection: Selection
  readonly busy: boolean
  readonly setSelection: (next: Selection) => void
  readonly changeQuantity: (itemId: string, quantity: number) => void
  readonly remove: (itemIds: readonly string[]) => void
  readonly retry: () => void
}

export function useCart(): CartStore {
  const [state, setState] = useState<CartState>({ status: 'loading' })
  const [selection, setSelection] = useState<Selection>(new Set())
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const cart = await fetchCart({ signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ status: 'ready', cart })
        setSelection(initialSelection(cart))
        publishCartCount(cart.itemCount)
      } catch {
        if (!controller.signal.aborted) setState({ status: 'failed' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [attempt])

  /**
   * 쓰기 하나를 보내고 그 응답으로 화면을 갈아 끼운다.
   *
   * 낙관적 갱신을 하지 않는다. 수량 하나를 바꾸면 그 줄만 달라지는 것이 아니라
   * 그룹 소계와 알림이 함께 움직이고, 그것을 미리 그려 두면 서버가 거절했을 때
   * **되돌릴 것이 화면 전체**가 된다. 대신 그동안 컨트롤을 잠근다.
   */
  const send = useCallback(async (work: () => Promise<CartResponse>): Promise<void> => {
    setBusy(true)

    try {
      const cart = await work()

      setState({ status: 'ready', cart })
      setSelection((held) => reconcile(cart, held))
      publishCartCount(cart.itemCount)
    } catch {
      // 실패해도 화면을 버리지 않는다 — 지금 보이는 장바구니는 여전히 사실이고,
      // 사람이 할 일은 다시 눌러 보는 것이다.
      setState((held) => held)
    } finally {
      setBusy(false)
    }
  }, [])

  const changeQuantity = useCallback(
    (itemId: string, quantity: number) => {
      void send(() => updateQuantity(itemId, quantity))
    },
    [send],
  )

  const remove = useCallback(
    (itemIds: readonly string[]) => {
      void send(() => removeItems(itemIds))
    },
    [send],
  )

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((held) => held + 1)
  }, [])

  return { state, selection, busy, setSelection, changeQuantity, remove, retry }
}
