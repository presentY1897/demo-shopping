import type { Metadata } from 'next'

import { QuestionListWorkspace } from '@/components/questions/question-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const title = screenTitle('/questions')

export const metadata: Metadata = {
  title,
  description: messagesFor().questionList.description,
}

/**
 * `/questions` — 내 상품에 들어온 문의와 그 답변 (TASK-0088).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 문의는
 * 클라이언트 경계가 효과에서 읽는다 — API 가 깨어나는 동안에도 화면의 뼈대가 먼저
 * 도착하고, 그것이 이 화면에 두 상태가 아니라 네 상태가 있는 이유다 (P5).
 *
 * `/reviews` 와 **같은 세 줄**이다. 두 화면이 같은 일을 다른 대상에 하기 때문이다.
 */
export default function Page() {
  return <QuestionListWorkspace title={title} />
}
