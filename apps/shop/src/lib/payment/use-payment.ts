'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { placeOrder } from '@/lib/checkout/checkout-api'

import { availableCredit } from './cards'
import type { IssuedCard } from './payment-api'
import { authorizePayment, capturePayment, fetchCards, startPayment } from './payment-api'

/**
 * 주문서의 결제 한 번 (TASK-0054).
 *
 * **주문을 만드는 것도 이쪽이다.** 결제는 주문에 붙고(`POST /payments` 가 `orderId`
 * 를 받는다) 주문서 화면에서 주문을 만드는 유일한 버튼이 「주문하기」이므로, 그
 * 버튼 하나가 주문을 만든 다음 그 주문에 결제를 건다 — 사람에게 「주문」과 「결제」를
 * 두 번 누르게 하지 않는다.
 *
 * **실패해도 주문과 예약은 그대로 둔다** (4.3). 거절당한 사람이 다음에 할 일은 다른
 * 카드로 **다시 결제하는 것**이지 주문을 다시 만드는 것이 아니다 — 두 번 만들면 한
 * 사람이 같은 물건을 두 몫 잠근다. 그래서 만들어진 주문을 들고 있다가 재시도 때
 * 그대로 쓴다.
 *
 * **거절은 예외가 아니라 상태다** (TASK-0052 4.3). 승인 요청은 200 으로 돌아오고
 * `FAILED` 인 결제가 몸통에 담겨 온다. 그래서 `catch` 로 잡히는 것은 「거절당했다」가
 * 아니라 「결과를 모른다」이고, 사람에게 할 말이 다르다 — 앞의 것은 다른 카드를
 * 권하고 뒤의 것은 다시 시도하기를 권한다.
 */

/** 결제가 지나는 네 걸음. 화면은 지금 어디인지를 문장으로 말한다. */
export const paymentSteps = ['ordering', 'starting', 'authorizing', 'capturing'] as const

export type PaymentStep = (typeof paymentSteps)[number]

/**
 * 결제가 끝나지 못한 이유. 셋을 나눠 두는 이유는 **다음에 할 일이 서로 다르기**
 * 때문이다 — 하나로 뭉치면 「결제할 수 없습니다」가 되고, 그 문장은 셋 중 어느
 * 경우에도 다음 행동을 알려 주지 못한다.
 */
export const paymentRefusals = [
  /** 고른 카드의 사용 가능액이 결제할 금액보다 적었다. 다른 카드면 된다. */
  'exceeds_credit',
  /**
   * 카드가 받아 주지 않았다.
   *
   * 승인이 끊긴 경우(4.5 의 타임아웃)도 화면에는 이것으로 보인다. 저쪽이 실제로
   * 승인했는지를 우리가 모르는 상태이고, 그 불일치를 찾아 고치는 것은 대사의
   * 몫이다(TASK-0056 · 0057) — 화면이 「끊겼다」와 「거절됐다」를 구분해 말해도
   * 사람이 할 일은 같다.
   */
  'declined',
  /** 요청이 오가지 못했다. 결제가 됐는지 안 됐는지를 **우리도 모른다.** */
  'unreachable',
] as const

export type PaymentRefusal = (typeof paymentRefusals)[number]

export type PaymentState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly step: PaymentStep }
  | {
      readonly status: 'failed'
      readonly refusal: PaymentRefusal
      /** 한도가 모자랐을 때 얼마나 모자랐는가. 다른 이유에서는 `null` 이다. */
      readonly shortfall: number | null
    }
  /** 매입까지 끝났다. 주문번호는 이 화면이 마지막으로 보여 줄 것이다. */
  | { readonly status: 'paid'; readonly orderNumber: string }

export interface PaymentInput {
  readonly checkoutId: string
  readonly addressId: string
  readonly card: IssuedCard
  /** 주문서가 보여 준 결제예정금액. 모자란 금액을 세는 데만 쓴다. */
  readonly amount: number
}

export interface PaymentStore {
  readonly cards: readonly IssuedCard[]
  readonly loadingCards: boolean
  readonly state: PaymentState
  /** 주문을 만들지 못했다 — 대부분 그 사이에 주문서가 만료된 것이다. */
  readonly orderFailed: boolean
  readonly pay: (input: PaymentInput) => void
}

export function usePayment(
  /**
   * 주문이 만들어졌을 때 불린다.
   *
   * 주문서 훅에게 「이 예약은 이제 주문의 것」이라고 알려 주는 자리다. 이것이
   * 없으면 결제가 거절돼 다른 카드로 다시 하려는 사람이 화면을 벗어나는 순간
   * 우리가 그 재고를 풀어 버린다 — TASK-0054 4.3 이 지키려는 것이 정확히 그것이다.
   */
  onOrdered: () => void = () => undefined,
): PaymentStore {
  const [cards, setCards] = useState<readonly IssuedCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [state, setState] = useState<PaymentState>({ status: 'idle' })
  const [orderFailed, setOrderFailed] = useState(false)
  /**
   * 이미 만든 주문.
   *
   * 상태가 아니라 ref 인 이유는 이 값이 **그려지지 않기** 때문이다 — 화면에 나오는
   * 것은 결제가 끝난 뒤의 주문번호뿐이고, 주문 id 는 다음 요청을 어디로 보낼지만
   * 정한다. 상태로 두면 재시도가 그 갱신을 기다려야 한다.
   */
  const order = useRef<{ readonly id: string; readonly orderNumber: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await fetchCards({ signal: controller.signal })

        if (!controller.signal.aborted) setCards(answer.cards)
      } catch {
        // 빈 목록으로 남는다 — 배송지와 같은 판단이다(`use-address-book.ts`).
        // 카드를 못 읽었다고 주문서 전체를 오류 화면으로 바꾸면 사람이 할 수 있는
        // 일이 아무것도 없어지고, 빈 목록은 「카드를 발급받으러 간다」는 길을 남긴다.
      } finally {
        if (!controller.signal.aborted) setLoadingCards(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [])

  const pay = useCallback(
    (input: PaymentInput) => {
      setOrderFailed(false)

      async function run(): Promise<void> {
        const placed = order.current ?? (await place(input))

        if (placed === null) {
          setOrderFailed(true)
          setState({ status: 'idle' })

          return
        }

        order.current = placed

        try {
          setState({ status: 'running', step: 'starting' })

          const opened = await startPayment(placed.id, input.card.id)

          setState({ status: 'running', step: 'authorizing' })

          const authorized = await authorizePayment(opened.id)

          // 승인이 거절된 것은 값으로 온다. 여기서 끝내되 주문과 예약은 그대로 둔다.
          if (authorized.status === 'FAILED') {
            setState(refusalOf(input))

            return
          }

          setState({ status: 'running', step: 'capturing' })
          await capturePayment(authorized.id)
          setState({ status: 'paid', orderNumber: placed.orderNumber })
        } catch {
          setState({ status: 'failed', refusal: 'unreachable', shortfall: null })
        }
      }

      async function place(
        next: PaymentInput,
      ): Promise<{ readonly id: string; readonly orderNumber: string } | null> {
        setState({ status: 'running', step: 'ordering' })

        try {
          const { order: made } = await placeOrder(next.checkoutId, next.addressId)

          onOrdered()

          return { id: made.id, orderNumber: made.orderNumber }
        } catch {
          return null
        }
      }

      void run()
    },
    [onOrdered],
  )

  return { cards, loadingCards, orderFailed, pay, state }
}

/**
 * 왜 거절당했는지를 화면이 고른다.
 *
 * **몸통에 사유가 없기 때문이다.** `paymentSchema` 에는 실패 사유 필드가 없고, 서버는
 * 그것을 이벤트 로그(`PaymentEvent`)에 남긴다 — 분쟁과 대사의 근거는 그쪽이지 화면이
 * 아니다. 화면이 아는 것은 **자기가 고른 카드**이고, 그 카드의 사용 가능액이 결제할
 * 금액보다 적었다면 이유는 하나로 좁혀진다. 그 밖의 거절은 이유를 모르는 거절이고,
 * 모르는 것을 아는 척하는 문장보다 「다른 카드로 해 보세요」가 정확하다.
 */
function refusalOf(input: PaymentInput): PaymentState {
  const shortfall = input.amount - availableCredit(input.card)

  if (shortfall > 0) return { refusal: 'exceeds_credit', shortfall, status: 'failed' }

  return { refusal: 'declined', shortfall: null, status: 'failed' }
}
