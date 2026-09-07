import { CheckoutScreen } from '@/components/checkout/checkout-screen'
import { messagesFor } from '@/messages'

/**
 * 주문서 (TASK-0050).
 *
 * 서버 컴포넌트는 제목만 그린다. 내용은 로그인한 사람의 주문서이고, 진입이 재고를
 * 잡지 않으므로(4.1) 서버 렌더로 얻을 것이 없다.
 */
/*
 * `<div>` 이지 `<main>` 이 아니다 (TASK-0099 가 찾은 것).
 *
 * 바깥 레이아웃이 이미 `<main id="main">` 을 그린다. 여기서 또 그리면 **랜드마크가
 * 둘**이 되고, 스크린리더의 랜드마크 목록에 「본문」이 두 개 뜬다 — 「본문 바로가기」가
 * 데려다주는 곳이 그중 어느 쪽인지는 아무도 모른다. Lighthouse 의 기본 접근성
 * 항목에는 이 규칙이 없어서 점수 1.00 인 채로 남아 있었다.
 */
export default async function CheckoutPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const messages = messagesFor().checkout

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <h1 className="text-fg text-xl font-bold">{messages.title}</h1>
      <CheckoutScreen id={id} messages={messages} />
    </div>
  )
}
