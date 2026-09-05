import type { Metadata } from 'next'

import { OrderDetailWorkspace } from '@/components/orders/order-detail-workspace'
import { messagesFor } from '@/messages'

const title = messagesFor().orderDetail.title

export const metadata: Metadata = {
  title,
  description: messagesFor().orderDetail.description,
}

/**
 * `/orders/[id]` — 주문 상세와 발송 처리 (TASK-0060).
 *
 * `params` 를 여기서 `await` 해서 **prop 으로** 넘긴다. 클라이언트 경계가
 * `useParams()` 로 자기 경로 매개변수를 읽으면 그 화면의 검사는 전부 라우터를 먼저
 * 흉내 내는 데서 시작한다 — 재고 화면과 편집기가 같은 이유로 같은 모양이다.
 */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params

  return <OrderDetailWorkspace sellerOrderId={id} />
}
