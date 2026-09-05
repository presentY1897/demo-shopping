import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/**
 * 「주문하기」가 갈 곳 (TASK-0046 4.4).
 *
 * 죽은 링크나 비활성 버튼 대신 실제 라우트를 둔다 — `/cart` 가 그랬던 방식이고
 * (`pages.md` 3장), TASK-0050 이 이 파일을 그대로 대체한다.
 */
export default function CheckoutPage() {
  const messages = messagesFor().placeholder.checkout

  return <PlaceholderScreen body={messages.body} title={messages.title} />
}
