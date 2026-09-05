import type { OrderStatus } from '@shopping/shared'
import { Badge } from '@shopping/ui/components'
import type { BadgeVariant } from '@shopping/ui/components'

import type { OrderStatusMessages } from '@/messages'

/**
 * 주문 상태 하나를 배지로 (TASK-0063).
 *
 * **목록과 상세가 같은 것을 쓴다.** 「배송중」이 두 화면에서 다른 색이면 사람은
 * 그것이 다른 상태라고 읽는다.
 *
 * **색은 거들 뿐이고 배지 안의 글자가 본문이다.** 배지를 전부 회색으로 바꿔도 화면이
 * 말하는 내용은 줄지 않아야 한다 (WCAG 1.4.1) — `ShipmentTracking` 이 같은 판단을
 * 이미 했고, 여기 표는 그것과 결이 맞게 짰다.
 *
 * `Record` 라 상태가 하나 늘면 **컴파일이 깨진다.** 색이 없는 상태는 조용히 회색으로
 * 떨어지는 대신 여기서 걸린다.
 */
const STATUS_VARIANT: Readonly<Record<OrderStatus, BadgeVariant>> = {
  // 아직 돈이 넘어가지 않았다. 실패는 사람이 뭔가 해야 하는 유일한 상태라 붉다.
  PAYMENT_PENDING: 'neutral',
  PAYMENT_FAILED: 'danger',
  PAID: 'primary',
  PREPARING: 'primary',
  SHIPPED: 'warning',
  DELIVERED: 'success',
  CONFIRMED: 'success',
  // 끝난 것들. 나쁜 일이 아니라 더 할 일이 없다는 뜻이라 회색이다.
  CANCELED: 'neutral',
  RETURNED: 'neutral',
}

export function OrderStatusBadge({
  status,
  labels,
}: {
  readonly status: OrderStatus
  readonly labels: OrderStatusMessages
}) {
  return (
    <Badge data-status={status} variant={STATUS_VARIANT[status]}>
      {labels[status]}
    </Badge>
  )
}
