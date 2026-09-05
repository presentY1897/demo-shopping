'use client'

import { EmptyState } from '@shopping/ui/components'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { checkoutIdOf, tossFailureKind } from '@/lib/payment/toss-return'
import type { TossFailureMessages } from '@/messages'

/**
 * 결제창이 실패로 돌아왔다 (TASK-0055 F3).
 *
 * **먼저 말할 것은 「주문과 예약이 그대로 있다」이다.** 결제창을 닫은 사람이 가장
 * 먼저 걱정하는 것은 장바구니와 잡아 둔 재고이고, 그것이 살아 있다는 사실을
 * 말해 주지 않으면 사람은 처음부터 다시 시작한다 — 그 사이 15분 동안 그 재고는
 * 아무에게도 가지 않는다. TASK-0054 4.3 이 거절당한 카드 결제에서 지키는 것과
 * 같은 것을, 이 화면은 결제창 밖에서 지킨다.
 *
 * **창을 닫은 것과 그 밖을 나눈다.** 마음이 바뀐 사람에게 「결제에 실패했어요」라고
 * 말하면 우리 쪽이 고장 난 것처럼 들린다. 실패로 온 것 중 절대다수가 그 경우다.
 *
 * **오류 화면이 아니다** (`ErrorState` 가 아니라 `EmptyState` 다). 여기서 일어난
 * 일은 사고가 아니라 **끝나지 않은 일**이고, `role="alert"` 로 가로채 읽어 줄 만한
 * 소식도 아니다 — 다음에 할 일이 화면에 그대로 있다.
 *
 * **토스가 실어 보낸 문장(`message`)은 그리지 않는다.** 쿼리스트링은 사용자가 고칠
 * 수 있는 값이고, 남이 쓴 문장을 우리 화면에 옮기면 우리가 한 말과 남이 한 말을
 * 읽는 사람이 구분할 수 없다. 우리가 읽는 것은 갈래를 정하는 `code` 하나다.
 */

export interface TossFailureScreenProps {
  readonly messages: TossFailureMessages
}

export function TossFailureScreen({ messages }: TossFailureScreenProps) {
  const params = useSearchParams()
  const kind = tossFailureKind(params.get('code'))
  const checkoutId = checkoutIdOf(params)

  return (
    <EmptyState
      action={
        checkoutId === null ? (
          <Link className="text-accent text-sm font-medium underline" href="/cart">
            {messages.backToCart}
          </Link>
        ) : (
          <Link
            className="text-accent text-sm font-medium underline"
            href={`/checkout/${checkoutId}`}
          >
            {messages.backToCheckout}
          </Link>
        )
      }
      description={`${messages.bodies[kind]} ${messages.holdKept}`}
      title={messages.titles[kind]}
    />
  )
}
