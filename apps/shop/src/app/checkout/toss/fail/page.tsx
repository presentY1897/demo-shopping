import { Suspense } from 'react'

import { TossFailureScreen } from '@/components/checkout/toss-failure-screen'
import { messagesFor } from '@/messages'

/**
 * 결제창이 실패로 돌아오는 곳 (TASK-0055 F3).
 *
 * 성공 쪽과 짝이고 겹치지 않는 이유도 같다 — 정적 세그먼트가 `[id]` 를 이긴다.
 *
 * **여기서는 아무것도 부르지 않는다.** 결제가 시작되지 않았거나 결제창 안에서
 * 끝난 것이라 서버에 물어볼 것이 없고, 주문과 예약은 그대로 살아 있다. 이 화면이
 * 하는 일은 그 사실을 말하고 주문서로 돌려보내는 것뿐이다.
 */
export default function TossFailPage() {
  const messages = messagesFor().checkout

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <h1 className="text-fg text-xl font-bold">{messages.tossFailure.title}</h1>
      <Suspense
        fallback={
          <p className="text-fg-muted py-16 text-center text-sm" role="status">
            {messages.loading}
          </p>
        }
      >
        <TossFailureScreen messages={messages.tossFailure} />
      </Suspense>
    </main>
  )
}
