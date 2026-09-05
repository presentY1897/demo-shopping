'use client'

import type { ApiFailure, Order, OrderStatus, SellerOrderAction } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchOrder, fetchSellerOrderActions, transitionSellerOrder } from './orders-api'

/**
 * `/mypage/orders/[id]` 뒤의 주문 하나 (TASK-0063).
 *
 * ## 액션은 묶음마다 따로 묻는다
 *
 * `GET /orders/:id` 는 「이 주문이 무엇인가」를 답하고, 「이 묶음에 무엇을 할 수
 * 있는가」는 `GET /seller-orders/:id/actions` 가 답한다. 묶음이 셋이면 요청이 셋이고,
 * 그것을 한 번에 묻는 라우트는 계약에 없다 (TASK-0063 — 보고된 빈자리).
 *
 * **셋을 병렬로 부르되 결과는 따로 둔다.** 하나가 실패했다고 나머지 두 묶음의 버튼이
 * 사라지면 안 되고, 실패한 묶음에 「할 수 있는 것이 없다」고 말해서도 안 된다 — 그
 * 둘은 다른 사실이고, 그래서 상태가 셋이다 (`loading` · `failed` · `ready`).
 *
 * ## 전이 뒤에 다시 읽지 않는다
 *
 * `POST .../transitions` 의 답이 **새 상태와 새 액션 목록을 함께** 싣는다. 계약이
 * 그렇게 생긴 이유가 이것이다 — 상태가 바뀌면 버튼도 반드시 바뀌므로, 두 번 묻는
 * 화면은 그 사이에 낡은 버튼을 그린다. 주문 전체를 다시 읽지 않는 것도 같은 이유다:
 * 바뀐 것은 이 묶음의 상태 하나이고, 나머지는 방금 읽은 그대로다.
 */

/** 한 묶음의 액션. **셋인 이유**는 위 문단에 있다. */
export type BundleActions =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly actions: readonly SellerOrderAction[] }

const LOADING: BundleActions = { status: 'loading' }

export type OrderDetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly order: Order }

/**
 * 전이 요청의 결과.
 *
 * `changed` 가 남아 있는 것이 중요하다. 이미 확정된 묶음에 다시 요청이 가면 서버는
 * 성공으로 답하지만 아무것도 옮기지 않았고, 화면은 「확정했습니다」와 「이미
 * 확정돼 있었습니다」를 다르게 말해야 한다.
 */
export type TransitionResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface OrderDetail {
  readonly state: OrderDetailState
  /** 묶음 id → 그 묶음에 열려 있는 것. 아직 안 온 묶음은 `loading` 이다. */
  readonly actionsOf: (sellerOrderId: string) => BundleActions
  readonly reload: () => void
  /** 이 묶음을 다음 상태로. 구매자에게 열려 있는 것은 구매확정 하나다. */
  readonly transition: (sellerOrderId: string, to: OrderStatus) => Promise<TransitionResult>
  /** 전이가 진행 중인 묶음. 중복 클릭을 막는 값이다 (U3). */
  readonly busyId: string | null
}

export function useOrderDetail(id: string): OrderDetail {
  const [state, setState] = useState<OrderDetailState>({ status: 'loading' })
  const [actions, setActions] = useState<Readonly<Record<string, BundleActions>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadActions(sellerOrderId: string): Promise<void> {
      try {
        const answer = await fetchSellerOrderActions(sellerOrderId, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return

        setActions((current) => ({
          ...current,
          [sellerOrderId]: { status: 'ready', actions: answer.actions },
        }))
      } catch {
        if (controller.signal.aborted) return
        // 무엇이 잘못됐는지는 이 자리에서 할 말이 아니다. 주문은 화면에 있고,
        // 이 묶음의 버튼만 「지금은 알 수 없다」로 남는다.
        setActions((current) => ({ ...current, [sellerOrderId]: { status: 'failed' } }))
      }
    }

    async function load(): Promise<void> {
      try {
        const { order } = await fetchOrder(id, { signal: controller.signal })
        if (controller.signal.aborted) return

        setState({ status: 'ready', order })
        setActions(
          Object.fromEntries(order.sellerOrders.map((bundle) => [bundle.id, LOADING] as const)),
        )

        // 병렬이다. 묶음이 셋이면 세 왕복이고, 줄 세우면 화면이 그만큼 늦게 산다.
        await Promise.all(order.sellerOrders.map((bundle) => loadActions(bundle.id)))
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [id, reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setActions({})
    setReloadToken((token) => token + 1)
  }, [])

  const transition = useCallback(
    async (sellerOrderId: string, to: OrderStatus): Promise<TransitionResult> => {
      setBusyId(sellerOrderId)

      try {
        const answer = await transitionSellerOrder(sellerOrderId, to)

        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                order: {
                  ...current.order,
                  sellerOrders: current.order.sellerOrders.map((bundle) =>
                    bundle.id === sellerOrderId ? { ...bundle, status: answer.status } : bundle,
                  ),
                },
              }
            : current,
        )
        setActions((current) => ({
          ...current,
          [sellerOrderId]: { status: 'ready', actions: answer.actions },
        }))

        return { ok: true, changed: answer.changed }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        setBusyId(null)
      }
    },
    [],
  )

  const actionsOf = useCallback(
    (sellerOrderId: string): BundleActions => actions[sellerOrderId] ?? LOADING,
    [actions],
  )

  return { actionsOf, busyId, reload, state, transition }
}
