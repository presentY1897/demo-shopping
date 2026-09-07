import { RequireSignIn } from '@/components/auth/require-sign-in'
import { WishlistScreen } from '@/components/collections/wishlist-screen'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { messagesFor } from '@/messages'

/**
 * 위시리스트 (TASK-0086 F3).
 *
 * 껍데기는 서버에서 그려지고 목록은 클라이언트 컴포넌트다 — 제목과 내비게이션이
 * 화면에 있는 동안 목록이 아직 오는 중일 수 있고, 이 프로젝트의 무료 요금제 API 에서
 * 그 사이가 길다 (TASK-0101).
 *
 * 색인되지 않는다 — `/mypage` 레이아웃이 `robots` 를 이미 걸어 두었다.
 */
export default function WishlistPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="wishlist"
      description={copy.wishlist.description}
      nav={copy.nav}
      title={copy.wishlist.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <WishlistScreen messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
