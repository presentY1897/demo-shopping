import { RequireSignIn } from '@/components/auth/require-sign-in'
import { FollowingScreen } from '@/components/collections/following-screen'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { messagesFor } from '@/messages'

/** 팔로우한 브랜드 (TASK-0089). 신상품 알림이 어디서 오는지를 보여 주는 자리다. */
export default function FollowingPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="following"
      description={copy.following.description}
      nav={copy.nav}
      title={copy.following.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <FollowingScreen messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
