import { RequireSignIn } from '@/components/auth/require-sign-in'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { PointScreen } from '@/components/mypage/point-screen'
import { messagesFor } from '@/messages'

/**
 * 적립금 내역 (TASK-0077).
 *
 * 껍데기는 서버에서 그려지고 잔액과 원장은 클라이언트 컴포넌트다 — 카드 지갑·쿠폰함과
 * 같은 이유이고, 여기서는 한 겹 더 있다: 이 화면이 부르는 것이 둘이라(`/me/points` 와
 * 그 원장) 둘 중 하나만 늦는 상태가 실제로 존재한다.
 *
 * 색인되지 않는다 — `/mypage` 레이아웃의 `robots` 가 이미 걸려 있다.
 */
export default function PointsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="points"
      description={copy.points.description}
      nav={copy.nav}
      title={copy.points.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <PointScreen messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
