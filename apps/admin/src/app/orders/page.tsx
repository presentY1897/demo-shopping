import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { OrderListWorkspace } from '@/components/orders/order-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/orders')

export const metadata: Metadata = {
  title,
  description: messages.adminOrders.description,
}

/**
 * `/orders` — 주문을 사람·스토어·기간으로 가로질러 (TASK-0095).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 *
 * **서버에서 주문을 읽지 않는 것이 여기서는 한 가지 이유가 더 있다.** 목록은 가려진
 * 이름만 오지만, 이 라우트가 아무 조건 없이 첫 페이지를 미리 읽어 두면 그것은 아무도
 * 찾은 적 없는 주문 스무 건을 매 방문마다 끌어오는 일이 된다.
 */
export default function OrdersPage() {
  const { adminOrders, errors } = messagesFor()

  return (
    <>
      <PageHeader description={adminOrders.description} title={title} />

      <OrderListWorkspace errors={errors} messages={adminOrders} />
    </>
  )
}
