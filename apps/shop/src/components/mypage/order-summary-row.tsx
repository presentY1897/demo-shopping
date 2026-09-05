import type { OrderSummary } from '@shopping/shared'
import { formatDate, formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import type { OrderHistoryMessages } from '@/messages'

import { OrderStatusBadge } from './order-status-badge'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'
/** 시간대를 고정한다. 넘기지 않으면 서버는 UTC, 브라우저는 방문자의 시간대로 찍는다. */
const TIME_ZONE = 'Asia/Seoul'

/**
 * 목록의 한 줄 (TASK-0063).
 *
 * ## 배지가 여럿일 수 있다
 *
 * `statuses` 는 **판매자별 상태의 목록**이다. 한 줄에 「배송완료」와 「상품 준비중」이
 * 나란히 있는 것이 이 구조의 정상이고, 그것을 대표 상태 하나로 뭉치면 목록에서
 * 이미 거짓말이 시작된다 (D-023). 그래서 서버가 보낸 만큼 그린다.
 *
 * 같은 상태가 두 판매자에게 있으면 배지도 둘이다 — 중복을 지우면 「세 곳 중 두 곳이
 * 배송완료」가 「배송완료」가 되고, 개수가 정보인 자리에서 개수가 사라진다.
 *
 * ## 카드 전체가 링크다
 *
 * 「상세보기」 버튼을 따로 두지 않는다. 목록의 한 줄이 하는 일이 하나뿐이면 그 줄이
 * 곧 링크여야 하고, 그래야 탭 정지가 줄마다 하나다. 접근성 이름은 주문번호를 싣는다
 * — 「주문 상세」가 스무 개 있는 목록은 링크 목록을 훑는 사람에게 아무 말도 하지
 * 않는다 (WCAG 2.4.4).
 */
export function OrderSummaryRow({
  order,
  messages,
}: {
  readonly order: OrderSummary
  readonly messages: OrderHistoryMessages
}) {
  return (
    <li>
      <Link
        aria-label={messages.detailLabel.replace('{number}', order.orderNumber)}
        className="border-border bg-surface hover:border-border-strong focus-visible:outline-primary flex flex-col gap-3 rounded-lg border p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        href={`/mypage/orders/${order.id}`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <time className="text-fg-muted text-sm" dateTime={order.createdAt}>
            {formatDate(order.createdAt, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })}
          </time>
          <span className="text-fg-subtle text-xs">
            {messages.orderNumberLabel} <span className="font-mono">{order.orderNumber}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {order.statuses.map((status, index) => (
            <OrderStatusBadge
              // 같은 상태가 두 번 나올 수 있다. 그것이 정보이므로 지우지 않고,
              // 지우지 않으니 키는 자리로 잡는다.
              key={`${status}-${String(index)}`}
              labels={messages.statuses}
              status={status}
            />
          ))}
        </div>

        <p className="text-fg font-medium">{order.headline}</p>

        <div className="text-fg-muted flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span>{messages.itemCountLabel.replace('{count}', String(order.itemCount))}</span>
          <span className="text-fg font-semibold tabular-nums">
            {messages.paidAmountLabel}{' '}
            {formatMoney({ amount: order.paidAmount, currency: CURRENCY })}
          </span>
        </div>
      </Link>
    </li>
  )
}
