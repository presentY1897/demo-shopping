import { RequireSignIn } from '@/components/auth/require-sign-in'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { MyQuestionsScreen } from '@/components/questions/my-questions-screen'
import { messagesFor } from '@/messages'

/** 내 문의 (TASK-0088 F7). 비공개로 남긴 것을 다시 볼 수 있는 유일한 자리다. */
export default function QuestionsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="questions"
      description={copy.questions.description}
      nav={copy.nav}
      title={copy.questions.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <MyQuestionsScreen messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
