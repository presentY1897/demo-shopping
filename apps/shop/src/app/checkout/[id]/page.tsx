import { CheckoutScreen } from '@/components/checkout/checkout-screen'
import { messagesFor } from '@/messages'

/**
 * 주문서 (TASK-0050).
 *
 * 서버 컴포넌트는 제목만 그린다. 내용은 로그인한 사람의 주문서이고, 진입이 재고를
 * 잡지 않으므로(4.1) 서버 렌더로 얻을 것이 없다.
 */
export default async function CheckoutPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const messages = messagesFor().checkout

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <h1 className="text-fg text-xl font-bold">{messages.title}</h1>
      <CheckoutScreen id={id} messages={messages} />
    </main>
  )
}
