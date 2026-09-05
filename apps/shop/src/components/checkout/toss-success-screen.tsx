'use client'

import { EmptyState, ErrorState } from '@shopping/ui/components'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { awaitsResult } from '@/lib/payment/awaiting-result'
import { capturePayment, confirmTossPayment } from '@/lib/payment/payment-api'
import type { TossConfirmFailure, TossSuccessReturn } from '@/lib/payment/toss-return'
import {
  checkoutIdOf,
  confirmFailureOf,
  offersRetry,
  tossSuccessReturn,
} from '@/lib/payment/toss-return'
import type { TossSuccessMessages } from '@/messages'

/**
 * 결제창이 성공으로 돌아왔다 — **그런데 아직 결제는 끝나지 않았다** (TASK-0055 4.2).
 *
 * **이 화면이 이 TASK 의 핵심이다.** PG 연동에서 가장 흔한 실수가 결제창의 성공을
 * 완료로 착각하는 것이고, 그 착각을 하면 결제되지 않은 주문이 `PAID` 가 된다.
 * 결제창이 하는 일은 카드사 인증까지이고, 승인은 **우리 서버가 우리 열쇠로** 부른
 * 뒤에야 끝난다.
 *
 * 그래서 이 화면은 도착하자마자 두 가지를 순서대로 한다.
 *
 * 1. `POST /payments/:id/toss/confirm` — 서버가 **DB 의 승인액과 대조한 뒤**에야
 *    토스를 부른다 (F2). 어긋나면 400 이고, 그때 저쪽에는 아무 승인도 남지 않는다.
 * 2. `POST /payments/:id/capture` — 여기가 끝나야 주문이 `PAID` 로 가고 예약이
 *    확정된다.
 *
 * **1이 실패하면 2를 부르지 않는다.** 승인되지 않은 결제를 매입하려 들면 409 가
 * 하나 더 늘 뿐이고, 그 두 번째 실패가 로그에서 첫 번째 원인을 덮는다.
 *
 * **「승인되지 않았다」에는 거절 말고 하나가 더 있다** (TASK-0057 F5 · D-220).
 * `confirmToss` 는 서버 안에서 `authorize` 를 지나므로 그 응답이 `UNRESOLVED` —
 * 승인됐는지 우리가 모르는 상태 — 로 올 수 있고, 이 화면이 실제로 그것을 만나는
 * 유일한 경로다(가상 카드는 그 결말을 내지 못한다). 그때 매입을 걸면 409 가 돌아와
 * 「카드 승인은 끝났는데 확정을 마치지 못했어요」가 뜨는데, 그것은 **사실이 아니다** —
 * 승인이 끝났는지를 우리가 모르고, 그 문장을 읽은 사람은 「결제는 됐구나」로
 * 이해한다.
 *
 * **`orderId` 는 우리 결제 id 다** (4.3). 토스가 그 이름으로 부르는 값에 우리가
 * `Payment.id` 를 넣어 보냈으므로, 돌아온 것도 결제 id 다 — 주문 id 가 아니다.
 *
 * **한 번만 시도한다.** 승인은 멱등이 아니고, 두 번째 요청은 409 로 끝나 첫 번째의
 * 결과를 지운다. React 가 효과를 두 번 부르는 환경(StrictMode)이 정확히 그 경우라
 * ref 하나로 막는다.
 *
 * **토스가 실어 보낸 문장은 그리지 않는다.** 쿼리스트링은 사용자가 고칠 수 있는
 * 값이고, 남이 쓴 문장을 우리 화면에 그대로 옮기면 우리가 한 말과 남이 한 말을
 * 읽는 사람이 구분할 수 없다.
 */

type TossSuccessState =
  | { readonly status: 'confirming' }
  | { readonly status: 'capturing' }
  | { readonly status: 'done' }
  | { readonly status: 'failed'; readonly failure: TossConfirmFailure }

export interface TossSuccessScreenProps {
  readonly messages: TossSuccessMessages
}

export function TossSuccessScreen({ messages }: TossSuccessScreenProps) {
  const params = useSearchParams()
  const [state, setState] = useState<TossSuccessState>({ status: 'confirming' })
  /** 승인은 한 번뿐이다. 효과가 두 번 불려도 요청은 한 번이어야 한다. */
  const started = useRef(false)
  const checkoutId = checkoutIdOf(params)
  /**
   * 결제창에서 온 주소인가.
   *
   * 상태가 아니라 **주소에서 바로 읽는 값**이다. 효과 안에서 알아내 상태로 옮기면
   * 첫 프레임이 「승인하는 중」을 그렸다가 곧바로 실패로 바뀌고, 그 깜빡임은
   * 아무것도 시작하지 않은 사람에게 무언가 시작됐다고 말하는 것이 된다.
   */
  const returned = tossSuccessReturn(params)

  useEffect(() => {
    if (returned === null || started.current) return

    started.current = true

    async function settle(paid: TossSuccessReturn): Promise<void> {
      let confirmed

      try {
        confirmed = await confirmTossPayment(paid.paymentId, paid.paymentKey, paid.amount)
      } catch (error: unknown) {
        setState({ failure: confirmFailureOf(error), status: 'failed' })

        return
      }

      // 거절은 예외가 아니라 값이다 (TASK-0052 4.3). 200 으로 `FAILED` 인 결제가
      // 오고, 그때 매입할 것은 없다.
      if (confirmed.status === 'FAILED') {
        setState({ failure: 'declined', status: 'failed' })

        return
      }

      // 결말이 정해지지 않은 결제도 매입할 것이 없다 (D-220). 승인됐는지 모르는
      // 것을 확정할 수는 없고, 걸어 봐야 409 가 하나 더 늘면서 화면이 「승인은
      // 끝났다」는 틀린 말을 하게 된다.
      if (awaitsResult(confirmed)) {
        setState({ failure: 'awaiting_result', status: 'failed' })

        return
      }

      setState({ status: 'capturing' })

      try {
        await capturePayment(confirmed.id)
      } catch {
        // 승인은 이미 됐다 — 저쪽에 승인이 남아 있고 우리 쪽만 확정되지 않았다.
        // 그래서 사유가 무엇이든 여기서는 하나다: 다시 결제하라고 말하면 두 번 낸다.
        setState({ failure: 'unsettled', status: 'failed' })

        return
      }

      setState({ status: 'done' })
    }

    void settle(returned)
  }, [returned])

  if (returned === null) {
    return (
      <ErrorState
        action={<Escape checkoutId={checkoutId} failure="invalid_return" messages={messages} />}
        description={messages.failures.invalid_return}
        title={messages.failedTitle}
      />
    )
  }

  if (state.status === 'done') {
    return (
      <EmptyState
        action={
          <Link className="text-accent text-sm font-medium underline" href="/">
            {messages.backHome}
          </Link>
        }
        description={messages.doneBody}
        title={messages.doneTitle}
      />
    )
  }

  // **확인 중은 사고가 아니다** (D-220). `ErrorState` 는 `role="alert"` 로 가로채
  // 읽고 위험 색을 쓰는데, 그 둘이 여기서는 사실과 다른 말을 한다 — 결제가 실패한
  // 것이 아니라 결말이 아직 정해지지 않은 것이고, 「실패했다」로 읽은 사람이 다음에
  // 하는 일이 정확히 우리가 막으려는 것(다시 결제)이다. 실패 주소가 「창을 닫은
  // 것」을 따로 그리는 것과 같은 판단이다.
  if (state.status === 'failed' && state.failure === 'awaiting_result') {
    return (
      <EmptyState
        action={<Escape checkoutId={checkoutId} failure={state.failure} messages={messages} />}
        description={messages.failures.awaiting_result}
        title={messages.awaitingTitle}
      />
    )
  }

  if (state.status === 'failed') {
    return (
      <ErrorState
        action={<Escape checkoutId={checkoutId} failure={state.failure} messages={messages} />}
        description={messages.failures[state.failure]}
        title={messages.failedTitle}
      />
    )
  }

  return (
    // `polite` 다. 여기서 사람이 할 수 있는 일이 없으므로 가로채 읽어 줄 이유가 없고,
    // 두 걸음이 문장 하나로 이어져 「지금 무엇을 기다리는가」가 계속 들린다.
    <p aria-live="polite" className="text-fg-muted py-16 text-center text-sm">
      {state.status === 'confirming' ? messages.confirming : messages.capturing}
    </p>
  )
}

/**
 * 여기서 나가는 길.
 *
 * **「이미 처리된 결제」에는 다시 결제하기를 주지 않는다.** 그 결제는 이미 끝났을
 * 수 있고 — 새로고침이나 뒤로가기가 정확히 그 경우다 — 우리는 이 응답만으로
 * 성공인지 실패인지를 모른다. 모르는 상태에서 「다시 결제하기」를 권하면 한 사람이
 * 같은 물건을 두 번 살 수 있다.
 *
 * 주문서 id 를 모르면 홈으로 보낸다. 우리가 `successUrl` 에 실어 보낸 값이라 없을
 * 이유가 없지만, 없을 때 갈 곳이 없는 화면을 만들 이유도 없다.
 */
function Escape({
  checkoutId,
  failure,
  messages,
}: {
  readonly checkoutId: string | null
  readonly failure: TossConfirmFailure
  readonly messages: TossSuccessMessages
}) {
  if (checkoutId === null || !offersRetry(failure)) {
    return (
      <Link className="text-accent text-sm font-medium underline" href="/">
        {messages.backHome}
      </Link>
    )
  }

  return (
    <Link className="text-accent text-sm font-medium underline" href={`/checkout/${checkoutId}`}>
      {messages.backToCheckout}
    </Link>
  )
}
