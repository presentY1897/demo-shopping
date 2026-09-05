'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { placeOrder } from '@/lib/checkout/checkout-api'

import { awaitsResult, refusedWhileAwaiting } from './awaiting-result'
import { availableCredit } from './cards'
import type { PaymentMethod } from './methods'
import type { IssuedCard } from './payment-api'
import {
  authorizePayment,
  capturePayment,
  fetchCards,
  startCardPayment,
  startTossPayment,
} from './payment-api'
import { openTossCheckout, tossClientKey, tossReturnUrls } from './toss'

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
 *
 * ## 갈래가 둘이다 (TASK-0055)
 *
 * **주문을 만드는 데까지는 같고, 그 뒤가 갈린다.** 가상 카드는 승인과 매입을 우리
 * 서버에 물어보고 그 자리에서 끝나지만, 토스는 결제를 연 다음 **브라우저를 결제창으로
 * 보낸다** — 이 훅이 토스 갈래에서 도달할 수 있는 가장 좋은 끝은 `paid` 가 아니라
 * `leaving` 이고, 승인은 돌아온 화면(`checkout/toss/success`)이 한다.
 *
 * 그 구분이 이 TASK 의 핵심이다 (4.2). 결제창이 성공했다고 여기서 완료로 옮기면,
 * 창을 닫고 돌아온 사람이 「결제 완료」를 본 채로 결제되지 않은 주문을 갖는다.
 *
 * ## 끝나지 않은 결제가 있다 (TASK-0057 F5 · D-220)
 *
 * 승인의 결말은 셋이다 — 승인·거절·**답 없음**. 세 번째가 `UNRESOLVED` 이고, 그것은
 * 실패가 아니라 **아직 정해지지 않은 상태**다. 여기서 두 가지가 따라온다.
 *
 * 1. 매입하지 않는다. 승인됐는지 모르는 결제를 확정할 수는 없다.
 * 2. 재시도를 권하지 않는다. 서버가 그 주문의 새 결제를 막아 두었고
 *    (`PAYMENT_AWAITING_RESULT`), 그 막음이 옳다 — 저쪽에 승인이 나 있었다면 다시
 *    결제한 사람의 카드에서 두 번 빠진다.
 *
 * **그 상태가 이 훅에 닿는 길이 둘이다.** 승인 응답이 그렇게 오거나, 새로고침한
 * 사람이 다시 눌러 `POST /payments` 가 409 로 막히거나 — 둘은 같은 사실의 앞뒤이므로
 * 화면에서도 같은 자리(`awaiting_result`)로 모인다.
 */

/**
 * 결제가 지나는 걸음들. 화면은 지금 어디인지를 문장으로 말한다.
 *
 * **두 갈래가 같은 목록을 쓴다.** 가상 카드는 `starting` 다음에 `authorizing` 으로
 * 가고 토스는 `opening` 으로 간다 — 겹치지 않는 걸음이 섞여 있는 것이 아니라,
 * 사람이 보는 문장이 「지금 무엇을 기다리는가」 하나이기 때문이다.
 */
export const paymentSteps = [
  'ordering',
  'starting',
  'authorizing',
  'capturing',
  /** 토스 결제창을 여는 중 (TASK-0055). 이 다음은 이 페이지가 아니다. */
  'opening',
] as const

export type PaymentStep = (typeof paymentSteps)[number]

/**
 * 결제가 끝나지 못한 이유. 나눠 두는 이유는 **다음에 할 일이 서로 다르기**
 * 때문이다 — 하나로 뭉치면 「결제할 수 없습니다」가 되고, 그 문장은 어느 경우에도
 * 다음 행동을 알려 주지 못한다.
 *
 * **하나는 나머지와 종류가 다르다.** `awaiting_result` 를 뺀 넷은 전부 **끝난 일**이라
 * 다음 차례가 사람에게 있지만, 그것은 아직 끝나지 않았고 다음 차례가 **우리에게**
 * 있다 (D-220). 그래서 그 하나에만 「다시 결제하기」가 없고, 그 갈림을
 * {@link offersRetry} 가 쥔다.
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
  /**
   * 요청이 오가지 못했다. 결제가 됐는지 안 됐는지를 **우리도 모른다.**
   *
   * `awaiting_result` 와 헷갈리기 쉬운데, 갈리는 것은 「누가 모르는가」다. 여기서는
   * **우리 API 의 대답조차 못 받았다** — 서버가 그 요청을 받았는지도 모르므로 지금
   * 아는 사람이 아무도 없고, 그래서 다시 눌러 보는 것이 맞는 다음 행동이다. 저쪽이
   * 답을 못 준 것을 **서버가 알고 있는** 경우가 `awaiting_result` 이고, 그때는 그
   * 재시도를 서버가 막는다.
   */
  'unreachable',
  /**
   * **승인됐는지 우리가 모른다 — 확인 중이다** (D-220).
   *
   * 결제사에 닿지 못해 승인 여부가 정해지지 않은 결제(`UNRESOLVED`)가 이 주문에
   * 걸려 있다. 위의 셋과 갈리는 것은 **끝났는가**다: 한도 초과도, 거절도, 오가지
   * 못한 요청도 끝난 일이라 다음 차례가 사람에게 있지만, 이것은 아직 끝나지
   * 않았고 다음 차례가 **대사에게** 있다. 이름이 「모른다」가 아니라 「결과를
   * 기다린다」인 이유가 그것이고, 서버가 새 결제를 막을 때 쓰는 코드
   * (`PAYMENT_AWAITING_RESULT`)와 같은 말이다.
   *
   * 그래서 할 말도 반대다. 나머지는 「다시 해 보세요」로 끝나지만 여기서 다시
   * 하는 것은 **정확히 하지 말아야 할 일**이다 — 저쪽에 승인이 나 있었다면 카드에서
   * 두 번 빠지고, 그 두 번째는 우리가 만든 것이다.
   */
  'awaiting_result',
  /**
   * 토스 결제창을 열지 못했다 (TASK-0055).
   *
   * 스크립트가 차단됐거나, 뜨지 않았거나, 저쪽이 요청을 되돌린 경우다. **아직
   * 아무 돈도 움직이지 않았다**는 점에서 위의 셋과 다르고, 그래서 다음에 할 일도
   * 다르다 — 다시 눌러 보거나 가상 카드로 바꾸는 것이다.
   */
  'toss_unavailable',
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
  /**
   * 결제창이 열렸다 — **브라우저가 이 페이지를 떠나는 중**이다 (TASK-0055).
   *
   * 끝이 아니라 **넘어감**이다. 여기서 「결제가 완료됐어요」를 그리면 이 TASK 가
   * 막으려는 바로 그 착각(결제창 성공 = 승인 완료, 4.2)을 화면이 먼저 저지르는
   * 것이 되고, 창을 닫고 돌아온 사람은 완료 화면을 본 채로 결제되지 않은 주문을
   * 갖게 된다.
   */
  | { readonly status: 'leaving' }

export interface PaymentInput {
  readonly checkoutId: string
  readonly addressId: string
  readonly method: PaymentMethod
  /** 주문서가 보여 준 결제예정금액. 모자란 금액을 세는 데만 쓴다. */
  readonly amount: number
  /**
   * 결제창에 뜰 주문 이름 (`checkoutOrderName`).
   *
   * 토스만 쓰지만 입력에 늘 있는 이유는, 무엇으로 결제할지가 **누르는 순간**
   * 정해지기 때문이다. 고른 뒤에 이름을 만들면 그 계산이 결제 경로 안으로 들어오고,
   * 문구를 아는 곳(화면)과 결제하는 곳(이 훅)이 뒤섞인다.
   */
  readonly orderName: string
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

        if (input.method.kind === 'toss') {
          await leaveForToss(placed.id, input)

          return
        }

        await payWithCard(placed, input.method.card, input.amount)
      }

      /** 가상 카드: 열고 · 승인하고 · 매입한다. 셋 다 우리 서버 안에서 끝난다. */
      async function payWithCard(
        placed: { readonly id: string; readonly orderNumber: string },
        card: IssuedCard,
        amount: number,
      ): Promise<void> {
        try {
          setState({ status: 'running', step: 'starting' })

          const opened = await startCardPayment(placed.id, card.id)

          setState({ status: 'running', step: 'authorizing' })

          const authorized = await authorizePayment(opened.id)

          // 승인이 거절된 것은 값으로 온다. 여기서 끝내되 주문과 예약은 그대로 둔다.
          if (authorized.status === 'FAILED') {
            setState(refusalOf(card, amount))

            return
          }

          // **`FAILED` 가 아니라고 승인된 것이 아니다** (D-220). 승인됐는지 모르는
          // 결제는 매입할 수 없고, 걸어 봐야 409 가 하나 더 늘 뿐이다 — 그리고 그
          // 409 는 `catch` 에서 「잠시 후 다시 결제해 주세요」가 되어, 저쪽에 승인이
          // 나 있었을지 모르는 사람에게 두 번째 결제를 권하는 문장이 된다.
          if (awaitsResult(authorized)) {
            setState({ refusal: 'awaiting_result', shortfall: null, status: 'failed' })

            return
          }

          setState({ status: 'running', step: 'capturing' })
          await capturePayment(authorized.id)
          setState({ status: 'paid', orderNumber: placed.orderNumber })
        } catch (error: unknown) {
          setState({ refusal: refusalOfFailure(error), shortfall: null, status: 'failed' })
        }
      }

      /**
       * 토스: 결제를 열고 결제창으로 **넘어간다** (TASK-0055 4.2).
       *
       * 여기서 끝나는 것은 이 화면이지 결제가 아니다. 승인은 결제창이 돌아온 뒤
       * `checkout/toss/success` 가 하고, 이 함수의 성공은 「브라우저가 곧 이 페이지를
       * 떠난다」는 뜻뿐이다.
       *
       * **두 실패를 나눈다.** 결제를 열지 못한 것은 요청이 저쪽에 닿았는지조차
       * 모르는 상태이고, 결제창을 열지 못한 것은 **확실히 아무 일도 일어나지
       * 않은** 상태다 — 뒤의 사람에게 「가상 카드로 해 보세요」는 맞는 말이지만
       * 앞의 사람에게는 아니다.
       */
      async function leaveForToss(orderId: string, next: PaymentInput): Promise<void> {
        const clientKey = tossClientKey()

        // 목록에 토스가 있었다는 것은 키가 있었다는 뜻이다. 그래도 다시 묻는 이유는
        // 이 경로가 화면의 판단에 기대지 않아야 하기 때문이다 — 기대는 순간, 키 없이
        // 결제창을 여는 코드가 이 안에 조용히 남는다.
        if (clientKey === null) {
          setState({ status: 'failed', refusal: 'toss_unavailable', shortfall: null })

          return
        }

        let opened
        try {
          setState({ status: 'running', step: 'starting' })
          opened = await startTossPayment(orderId)
        } catch (error: unknown) {
          setState({ refusal: refusalOfFailure(error), shortfall: null, status: 'failed' })

          return
        }

        try {
          setState({ status: 'running', step: 'opening' })

          // 금액도 결제 id 도 **서버가 정한 값**이다 (4.3). 화면이 들고 있던 숫자를
          // 넣으면 승인 단계의 금액 대조가 사용자의 조작뿐 아니라 우리 화면의
          // 실수까지 잡아내는 장치가 되고, 그 실수는 사용자에게 결제 실패로 보인다.
          await openTossCheckout({
            amount: opened.authorizedAmount,
            clientKey,
            orderName: next.orderName,
            paymentId: opened.id,
            ...tossReturnUrls(window.location.origin, next.checkoutId),
          })
        } catch {
          setState({ status: 'failed', refusal: 'toss_unavailable', shortfall: null })

          return
        }

        setState({ status: 'leaving' })
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
function refusalOf(card: IssuedCard, amount: number): PaymentState {
  const shortfall = amount - availableCredit(card)

  if (shortfall > 0) return { refusal: 'exceeds_credit', shortfall, status: 'failed' }

  return { refusal: 'declined', shortfall: null, status: 'failed' }
}

/**
 * 던져진 것을 사람에게 할 말로 옮긴다.
 *
 * **알아보는 판단은 `awaiting-result.ts` 의 것이다.** 결제창에서 돌아온 화면도 같은
 * 코드를 읽어야 하고(`toss-return.ts` 의 `confirmFailureOf`), 그 판단이 두 벌이면
 * 한쪽의 오타가 아무 데도 드러나지 않는다 — 화면은 조용히 「잠시 후 다시 결제해
 * 주세요」로 되돌아가고, 그것이 이 갈래에서 하지 말아야 할 바로 그 말이다.
 *
 * 여기 남은 것은 **그 사실을 이 화면의 어휘로 옮기는 일**뿐이다. 모르는 거절은
 * `unreachable` 로 접힌다 — 이름을 아는 것만 이름값을 한다.
 */
function refusalOfFailure(error: unknown): PaymentRefusal {
  return refusedWhileAwaiting(error) ? 'awaiting_result' : 'unreachable'
}

/**
 * 이 실패 뒤에 「다시 결제하기」를 줘도 되는가.
 *
 * **누르면 409 가 돌아올 버튼은 주지 않는다.** 결과를 확인하는 중인 주문에는 서버가
 * 새 결제를 막아 두었고(`PAYMENT_AWAITING_RESULT`), 그 버튼이 하는 일은 한 사람을
 * 두 번 실패시키는 것뿐이다. 그리고 **그 막음이 옳다** — 저쪽에 승인이 나 있었다면
 * 다시 결제한 사람의 카드에서 두 번 빠진다.
 *
 * `toss-return.ts` 에 같은 이름의 함수가 있고 같은 것을 지킨다. 한곳으로 합치지 않은
 * 이유는 두 화면이 세는 실패의 어휘가 다르기 때문이다 — 합치려면 그 둘을 먼저
 * 합쳐야 하고, 그것은 「다시 결제해도 되는가」와 상관없는 변경이다.
 */
export function offersRetry(refusal: PaymentRefusal): boolean {
  return refusal !== 'awaiting_result'
}
