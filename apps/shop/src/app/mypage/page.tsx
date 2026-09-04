import { RequireSignIn } from '@/components/auth/require-sign-in'
import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/**
 * The account menu's destination. The screen itself is still a placeholder —
 * M04's own account screens are TASK-0025 and TASK-0112 — but the *guard* is
 * this task's, and putting it here now is what makes F1 measurable.
 */
export default function MyPage() {
  const messages = messagesFor()

  return (
    <RequireSignIn messages={messages.auth.requireSignIn}>
      <PlaceholderScreen
        body={messages.placeholder.mypage.body}
        title={messages.placeholder.mypage.title}
      />
    </RequireSignIn>
  )
}
