'use client'

import type {
  ApiFailure,
  DemoCarrierCode,
  OrderStatus,
  SellerOrderAction,
  SellerOrderResponse,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import {
  fetchSellerOrder,
  fetchSellerOrderActions,
  markSellerOrderDelivered,
  shipSellerOrder,
  transitionSellerOrder,
} from './console-api'
import { actionRouteOf } from './order-console'
import type { SellerOrderWrite } from './use-seller-orders'

/**
 * 몫 하나와 **지금 할 수 있는 것**.
 *
 * 둘을 함께 읽는 이유는 화면이 둘을 함께 그리기 때문이다. 상세만 읽고 버튼을 상태에서
 * 만들면 그 판단이 세 앱에 흩어지고, 규칙이 바뀔 때 한 곳만 고쳐진다 —
 * `GET …/actions` 가 있는 이유가 그것이다 (설계서 4장).
 *
 * 쓰기가 끝나면 **둘 다** 다시 읽는다. 상태가 바뀌면 버튼도 반드시 바뀌고, 한쪽만
 * 새로 읽은 화면은 낡은 짝을 그린다.
 */

export type SellerOrderState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly order: SellerOrderResponse
      readonly actions: readonly SellerOrderAction[]
    }

/** 액션 하나를 실행할 때 함께 넘기는 것. 문마다 쓰는 것이 다르다. */
export interface SellerOrderActionInput {
  /** 발송에서 고른 운송사. 없으면 서버가 고른다 (`ShipSellerOrderRequest`). */
  readonly carrierCode?: DemoCarrierCode
  /** 취소·반품의 사유. 이력에 남는 한 줄이다. */
  readonly reason?: string
}

export interface SellerOrderController {
  readonly state: SellerOrderState
  readonly reload: () => void
  /**
   * 서버가 준 버튼 하나를 실제로 누른다.
   *
   * 목적지에 따라 세 문 중 하나로 간다 (`actionRouteOf`). 돌려주는 것은 **옮겨진
   * 상태**이고, 화면은 그것으로 「처리했습니다」와 「이미 처리돼 있었습니다」를
   * 가른다.
   */
  readonly run: (
    to: OrderStatus,
    input?: SellerOrderActionInput,
  ) => Promise<SellerOrderWrite<OrderStatus>>
  /** 쓰기가 도는 동안. 중복 클릭을 막는 데 쓴다 (U3). */
  readonly busy: boolean
}

export function useSellerOrder(sellerOrderId: string): SellerOrderController {
  const [state, setState] = useState<SellerOrderState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        // 나란히 보낸다. 둘 중 하나를 기다렸다 다른 하나를 보내면 상세 화면의 첫
        // 그림이 한 왕복만큼 늦고, 그 왕복은 콜드 스타트에서 몇 초다.
        const [order, actions] = await Promise.all([
          fetchSellerOrder(sellerOrderId, { signal: controller.signal }),
          fetchSellerOrderActions(sellerOrderId, { signal: controller.signal }),
        ])

        if (controller.signal.aborted) return

        setState({ status: 'ready', order, actions: actions.actions })
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
    setReloadToken((token) => token + 1)
  }, [])

  const run = useCallback(
    async (
      to: OrderStatus,
      input: SellerOrderActionInput = {},
    ): Promise<SellerOrderWrite<OrderStatus>> => {
      setBusy(true)

      try {
        const status = await runAction(sellerOrderId, to, input)

        // 다시 읽는다. 상태·버튼·배송·이력이 한 번에 바뀌므로 응답의 조각으로 화면을
        // 기우는 것보다 한 번 더 읽는 편이 싸고, 무엇보다 **틀리지 않는다**.
        setReloadToken((token) => token + 1)

        return { ok: true, value: status }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        setBusy(false)
      }
    },
    [sellerOrderId],
  )

  return { state, reload, run, busy }
}

/**
 * 목적지 하나를, 그것을 여는 문으로.
 *
 * 훅 밖의 함수인 것은 일괄 발송이 같은 판단을 목록 화면에서 써야 하기 때문이다 —
 * 두 곳이 각자 `if (to === 'SHIPPED')` 를 적으면 그중 하나가 나중에 안 고쳐진다.
 */
export async function runAction(
  sellerOrderId: string,
  to: OrderStatus,
  input: SellerOrderActionInput = {},
): Promise<OrderStatus> {
  switch (actionRouteOf(to)) {
    case 'shipment': {
      await shipSellerOrder(
        sellerOrderId,
        input.carrierCode === undefined ? {} : { carrierCode: input.carrierCode },
      )

      return 'SHIPPED'
    }
    case 'delivery': {
      const answer = await markSellerOrderDelivered(sellerOrderId)

      return answer.transition.status
    }
    case 'transition': {
      const answer = await transitionSellerOrder(sellerOrderId, {
        to,
        ...(input.reason === undefined || input.reason === '' ? {} : { reason: input.reason }),
      })

      return answer.status
    }
  }
}
