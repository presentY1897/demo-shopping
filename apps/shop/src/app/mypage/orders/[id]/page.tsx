import { PageContainer } from '@shopping/ui/layout'

import { RequireSignIn } from '@/components/auth/require-sign-in'
import { OrderDetailScreen } from '@/components/mypage/order-detail-screen'
import { messagesFor } from '@/messages'

/**
 * 주문 하나 — 판매자별 묶음 (TASK-0063).
 *
 * **`MyPageShell` 을 쓰지 않는다.** 그 껍데기는 계정 관리 화면 넷이 서로를 오가는
 * 자리이고, 여기는 그 목록에서 한 건으로 **들어온** 곳이다 — 네 개짜리 내비게이션을
 * 다시 그리면 지금 어디 있는지가 흐려지고, 이 화면의 제목이 h1 이 아니게 된다.
 * 대신 목록으로 돌아가는 링크 하나를 화면이 직접 갖는다.
 *
 * 제목까지 클라이언트 컴포넌트 안에 있는 것도 그래서다: 제목이 주문번호를 싣는데
 * 그 번호는 로그인한 사람의 것이라 서버에서 얻을 수 없다.
 */
export default async function OrderDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const messages = messagesFor()

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <OrderDetailScreen id={id} messages={messages.mypage} />
      </RequireSignIn>
    </PageContainer>
  )
}
