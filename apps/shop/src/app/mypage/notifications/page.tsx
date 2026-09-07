import { RequireSignIn } from '@/components/auth/require-sign-in'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { NotificationScreen } from '@/components/notifications/notification-screen'
import { messagesFor } from '@/messages'

/**
 * 알림함 (TASK-0090).
 *
 * 헤더의 드롭다운이 「안 읽은 것 다섯」을 보이는 자리라면, 여기는 **전부**를 보는
 * 자리다. 둘은 같은 훅을 쓰고 질의 둘만 다르다.
 */
export default function NotificationsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="notifications"
      description={copy.notifications.description}
      nav={copy.nav}
      title={copy.notifications.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <NotificationScreen messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
