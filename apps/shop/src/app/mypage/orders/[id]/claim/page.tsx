import { PageContainer } from '@shopping/ui/layout'

import { RequireSignIn } from '@/components/auth/require-sign-in'
import { ClaimRequestScreen } from '@/components/mypage/claim-request-screen'
import { messagesFor } from '@/messages'

/**
 * 취소·반품 신청 (TASK-0066).
 *
 * **`MyPageShell` 을 쓰지 않는다.** 주문 상세와 같은 판단이다 — 계정 관리 화면
 * 넷을 오가는 껍데기는 여기서 소음이고, 이 화면의 제목이 h1 이 아니게 된다. 대신
 * 돌아갈 링크 하나를 화면이 직접 갖는다.
 *
 * **어느 판매자 몫인지는 질의 문자열이 말한다.** 신청의 단위가 주문이 아니라
 * 판매자 몫이기 때문이고(D-023), 라우트가 이미 주문 id 를 쓰고 있어 몫 id 를 넣을
 * 자리가 경로에 없다. 없는 경우를 404 로 만들지 않는 이유는 화면에 적혀 있다.
 *
 * 색인되지 않는다 — `/mypage` 레이아웃이 `robots` 를 이미 걸어 두었다.
 */
export default async function ClaimRequestPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const { bundle } = await searchParams
  const messages = messagesFor()

  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <ClaimRequestScreen
          messages={messages.mypage}
          orderId={id}
          sellerOrderId={typeof bundle === 'string' ? bundle : null}
        />
      </RequireSignIn>
    </PageContainer>
  )
}
