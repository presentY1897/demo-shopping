import { RequireSignIn } from '@/components/auth/require-sign-in'
import { CardWallet } from '@/components/mypage/card-wallet'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { messagesFor } from '@/messages'

/**
 * 가상 카드 관리 (TASK-0058).
 *
 * 껍데기는 서버에서 그려지고 지갑은 클라이언트 컴포넌트다 — 제목과 내비게이션이
 * 화면에 있는 동안 카드 목록이 아직 오는 중일 수 있고, 이 프로젝트의 무료 요금제
 * API 에서 그 사이가 길다 (TASK-0101).
 *
 * **결제 화면의 카드 선택은 여기 없다** (4.3). TASK-0054 가 주문서 안에 만들었고,
 * 주문할 때 카드를 고르는 것과 카드를 관리하는 것은 다른 일이다.
 *
 * 색인되지 않는다 — `/mypage` 레이아웃이 `robots` 를 이미 걸어 두었고, 그것이
 * 레이아웃에 있는 이유가 정확히 이 경우다: 나중에 생긴 라우트가 한 줄을 잊어서
 * 누군가의 카드 목록이 검색 결과에 뜨는 일.
 */
export default function CardsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="cards"
      description={copy.cards.description}
      nav={copy.nav}
      title={copy.cards.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <CardWallet messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
