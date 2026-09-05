import { CartScreen } from '@/components/cart/cart-screen'
import { messagesFor } from '@/messages'

/**
 * 장바구니 (TASK-0046).
 *
 * 서버 컴포넌트는 제목만 그린다. 내용은 로그인한 사람의 것이고 — 경로에 사용자 id
 * 가 없다(TASK-0045 4.3) — 서버 렌더로 얻을 것이 없다.
 */
export default function CartPage() {
  const messages = messagesFor().cart

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <h1 className="text-fg text-xl font-bold">{messages.title}</h1>
      <CartScreen messages={messages} />
    </main>
  )
}
