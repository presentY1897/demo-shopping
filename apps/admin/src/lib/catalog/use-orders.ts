'use client'

import type { AdminOrderPaymentsResponse, AdminOrderRow, ApiFailure } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchOrderPayments, fetchOrders } from './console-api'
import type { OrderFilters } from './order-console'
import { EMPTY_ORDER_FILTERS, orderQueryOf, ordersNarrowed } from './order-console'

/**
 * 주문 한 페이지, 그리고 **연 주문 하나의 결제 내역** (TASK-0095).
 *
 * 훅이 둘인 것이 계약이 둘인 것과 같은 이유다. 목록은 「그 주문이 어디 있나」에
 * 답하고(F4 · F5) 결제는 「돈이 어떻게 움직였나」에 답한다(F6) — 목록에 결제까지 실으면
 * 스무 줄마다 결제를 끌고 오면서 첫 질문에는 아무것도 더하지 못한다.
 *
 * **묶음은 이미 줄에 있다.** `sellerOrders` 가 목록 응답에 실려 오므로(4.3), 주문
 * 하나를 열 때 다시 묻는 것은 결제뿐이다 — 줄을 그리다가 묶음을 한 번 더 부르면 스무
 * 줄이 스물한 번이 된다 (A5).
 *
 * **주문 상태를 바꾸는 함수가 없다.** 일부러 없다 (F7 · 4.4).
 */

export type OrdersState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly orders: readonly AdminOrderRow[]
      readonly nextCursor: string | null
    }

export interface OrdersController {
  readonly state: OrdersState
  readonly filters: OrderFilters
  readonly setFilters: (filters: OrderFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
}

export function useOrders(): OrdersController {
  const [state, setState] = useState<OrdersState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<OrderFilters>(EMPTY_ORDER_FILTERS)
  const [token, setToken] = useState(0)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const page = await fetchOrders(
          { ...orderQueryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ nextCursor: page.nextCursor, orders: page.orders, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, token])

  const setFilters = useCallback(
    (next: OrderFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const narrowed = useMemo(() => ordersNarrowed(filters), [filters])

  return { filters, narrowed, pagination, reload, setFilters, state }
}

/* ------------------------------------------------- 한 주문의 결제 내역 -- */

export type OrderPaymentsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly payments: AdminOrderPaymentsResponse }

export interface OrderPaymentsController {
  readonly state: OrderPaymentsState
  readonly reload: () => void
}

/**
 * 한 주문의 결제와 환불 (F6).
 *
 * `orderId` 가 바뀌면 다시 읽는다 — 목록에서 다른 줄을 열었을 때가 그 자리다. 답을
 * 기다리는 사이에 패널이 닫히면 요청은 취소되고, 취소된 요청은 상태를 건드리지 않는다.
 */
export function useOrderPayments(orderId: string): OrderPaymentsController {
  const [state, setState] = useState<OrderPaymentsState>({ status: 'loading' })
  const [token, setToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const payments = await fetchOrderPayments(orderId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ payments, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [orderId, token])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  return { reload, state }
}
