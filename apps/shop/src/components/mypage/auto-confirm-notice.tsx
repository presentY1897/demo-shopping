'use client'

import type { SellerOrder } from '@shopping/shared'
import { formatDate } from '@shopping/ui/format'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { AUTO_CONFIRM_DAYS } from '@/lib/orders/auto-confirm'
import type { OrderDetailMessages } from '@/messages'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * 이 묶음의 구매확정이 **언제** 일어나는지, 또는 **이미 일어났으면 그 뒤에 무엇이
 * 닫혔는지** (TASK-0064 F5 · F8).
 *
 * ## 왜 한 컴포넌트인가
 *
 * 둘은 같은 사실의 앞뒤다 — 확정 예정이거나 확정된 것이고, 그 사이에 다른 상태는
 * 없다(`DELIVERED → CONFIRMED` 는 종착으로 가는 화살표다). 나눠 두면 부르는 쪽이
 * 상태로 두 번 분기하게 되고, 그때 「배송완료도 확정도 아닌 묶음에 둘 다 안 그린다」
 * 는 규칙이 두 곳에 적힌다.
 *
 * ## 액션 목록과 다른 것을 말한다
 *
 * 버튼이 있는지 없는지는 서버가 정한다 (`GET /seller-orders/:id/actions`). 이 문단은
 * 버튼이 아니라 **버튼이 없는 이유와 시한**이고, 그 둘은 서버가 답하지 않는다 —
 * 액션 목록은 「지금 무엇을 누를 수 있나」에만 답하므로 확정된 주문에서는 그냥
 * 비어 있다. 사람이 알아야 하는 것은 그 빈 목록의 뜻이다.
 *
 * ## 확정 뒤의 문장은 새 규칙이 아니다
 *
 * 전이표에 `CONFIRMED` 를 떠나는 화살표가 없다 (`seller-order-transitions.ts` —
 * `CONFIRMED: []`). 즉 **반품은 이미 막혀 있고** 화면이 그것을 새로 막는 것이
 * 아니다. 여기서 하는 일은 그 사실을 사람이 읽을 수 있게 적는 것뿐이며, 「하자
 * 반품은 관리자 확인을 거친다」는 TASK-0064 4장이 승인한 규칙을 그대로 옮긴 말이다.
 */
export function AutoConfirmNotice({
  sellerOrder,
  messages,
}: {
  readonly sellerOrder: SellerOrder
  readonly messages: OrderDetailMessages
}) {
  if (sellerOrder.status === 'CONFIRMED') {
    return (
      <Note title={messages.afterConfirm.title}>
        <p className="text-fg-muted text-sm">{messages.afterConfirm.noReturn}</p>
      </Note>
    )
  }

  if (sellerOrder.status !== 'DELIVERED') return null

  const copy = messages.autoConfirm
  // 서버가 계산해 보낸 값이다. 화면이 더하지 않는 이유는 `lib/orders/auto-confirm.ts`
  // 에 적혀 있다 — 압축된 배포에서 그 덧셈은 틀린 날짜가 된다.
  const dueAt = sellerOrder.autoConfirmAt
  const rule = copy.rule.replace('{days}', String(AUTO_CONFIRM_DAYS))

  return (
    <Note title={copy.title}>
      {/*
        날짜를 모르면 지어내지 않는다 — 이력에도 배송 행에도 배송완료 시각이 없는
        묶음이 있고(상태 이력이 쌓이기 전의 주문), 그때 규칙만 말하는 것이 정확하다.
        `order-stages.ts` 의 「시각 정보 없음」과 같은 판단이다.
      */}
      {dueAt === null ? (
        <p className="text-fg text-sm">{copy.unknownAt}</p>
      ) : (
        <p className="text-fg text-sm">
          {copy.dueAt.replace(
            '{date}',
            formatDate(dueAt, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE }),
          )}
        </p>
      )}

      {/*
        **날짜 옆에 규칙이 함께 선다.** 위의 시각은 이 배포가 실제로 확정할 때이고
        이 줄은 실제 서비스의 약속이다 — 둘이 같으면 압축이 없는 것이고, 위가 훨씬
        이르면 이 배포가 시연을 위해 시간을 압축한 것이다.
        **두 문장 다 어느 설정에서도 참인 것이 요점이다**: 화면은
        `FULFILLMENT_PACE` 를 읽을 수 없으므로 「지금은 압축된 시간입니다」라고
        단언할 수 없고, 단언하면 `realistic` 배포에서 그 말이 거짓이 된다.
      */}
      <p className="text-fg-muted text-sm">{rule}</p>
    </Note>
  )
}

/**
 * 문단 하나짜리 알림.
 *
 * `UpcomingEntry` 와 모양이 같지만 **점선 테두리가 아니다** — 저쪽은 「아직 없는
 * 화면」이고 이쪽은 지금 유효한 사실이다. 같은 그림으로 그리면 사람은 이 안내도
 * 언젠가 사라질 자리 표시자로 읽는다.
 */
function Note({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const titleId = useId()

  return (
    // 이름을 제목 줄에서 가져온다 (`aria-labelledby`). `role="note"` 는 내용으로
    // 이름을 만들지 않으므로, 이것이 없으면 묶음이 셋인 화면에서 알림 셋이 전부
    // 이름 없는 덩어리로 읽힌다 — 어느 판매자의 것인지 알 수 없다.
    <div
      aria-labelledby={titleId}
      className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3"
      role="note"
    >
      <p className="text-fg text-sm font-medium" id={titleId}>
        {title}
      </p>
      {children}
    </div>
  )
}
