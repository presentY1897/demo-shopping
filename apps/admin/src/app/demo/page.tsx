import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { DemoConsoleWorkspace } from '@/components/demo/demo-console-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/demo')

export const metadata: Metadata = {
  title,
  description: messages.demoConsole.description,
}

/**
 * `/demo` — 발급된 데모 계정과 정리 상태를 보는 자리 (TASK-0096).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 세 섹션은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 *
 * **역할 이름은 회원 화면의 카탈로그에서 온다.** 역할별 통계가 그것을 쓰고, 두 화면이
 * 같은 역할을 다르게 부르면 그것이 표를 하나로 두는 이유다. 그 표를 여기서 넘긴다.
 */
export default function DemoPage() {
  const { demoConsole, users, errors } = messagesFor()

  return (
    <>
      <PageHeader description={demoConsole.description} title={title} />

      <DemoConsoleWorkspace errors={errors} messages={demoConsole} roleNames={users.roleNames} />
    </>
  )
}
