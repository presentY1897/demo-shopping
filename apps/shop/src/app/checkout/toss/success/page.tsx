import { Suspense } from 'react'

import { TossSuccessScreen } from '@/components/checkout/toss-success-screen'
import { messagesFor } from '@/messages'

/**
 * 결제창이 성공으로 돌아오는 곳 (TASK-0055).
 *
 * **`checkout/[id]` 와 겹치지 않는다.** App Router 는 정적 세그먼트를 동적
 * 세그먼트보다 먼저 맞추므로 `/checkout/toss/success` 는 언제나 이 화면이고,
 * `/checkout/<uuid>` 는 그대로 주문서다. 남는 주소 `/checkout/toss` 는 「toss 라는
 * id 의 주문서」로 읽혀 만료 화면이 되는데, 아무도 열 이유가 없는 주소라 그대로 둔다.
 *
 * 서버 컴포넌트는 제목만 그린다. 승인은 로그인한 사람의 토큰으로 부르는 것이라
 * 서버 렌더로 얻을 것이 없다 — 주문서 화면과 같은 판단이다.
 *
 * `useSearchParams` 를 쓰는 화면은 Next 가 `Suspense` 아래를 요구한다. 폴백이
 * 진행 문장과 같은 이유는 그 경계가 보이지 않아야 하기 때문이다 — 여기 도착한
 * 사람이 기다리는 것은 하나뿐이다.
 */
export default function TossSuccessPage() {
  const messages = messagesFor().checkout

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <h1 className="text-fg text-xl font-bold">{messages.tossSuccess.title}</h1>
      <Suspense
        fallback={
          <p className="text-fg-muted py-16 text-center text-sm" role="status">
            {messages.tossSuccess.confirming}
          </p>
        }
      >
        <TossSuccessScreen messages={messages.tossSuccess} />
      </Suspense>
    </main>
  )
}
