import { RecentScreen } from '@/components/collections/recent-screen'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { messagesFor } from '@/messages'

/**
 * 최근 본 상품 (TASK-0087 F7).
 *
 * **`RequireSignIn` 이 없는 유일한 계정 화면이다.** 로그인하지 않은 사람의 이력은
 * 브라우저에 있고(F6), 그 사람이 자기 이력을 보거나 지울 자리가 여기 말고 없다 —
 * 로그인 유도로 덮으면 「비로그인은 localStorage 에 기록」이라는 2장의 결정이 화면에
 * 닿지 못한다. 화면은 대신 그 이력이 이 브라우저에만 있다는 사실을 말한다.
 */
export default function RecentPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="recent"
      description={copy.recent.description}
      nav={copy.nav}
      title={copy.recent.title}
    >
      <RecentScreen messages={copy} />
    </MyPageShell>
  )
}
