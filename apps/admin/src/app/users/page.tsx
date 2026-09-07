import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { UserListWorkspace } from '@/components/users/user-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/users')

export const metadata: Metadata = {
  title,
  description: messages.users.description,
}

/**
 * `/users` — 회원을 찾고, 사유를 적고 열어 보고, 조치하는 자리 (TASK-0093).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 *
 * **서버에서 회원을 읽지 않는 것이 여기서는 한 가지 이유가 더 있다.** 목록은 가려진
 * 값만 오지만(F6), 이 라우트가 상세까지 미리 읽어 두면 그것은 아무도 사유를 적지 않은
 * 열람이 된다 (4.3).
 */
export default function UsersPage() {
  const { users, errors } = messagesFor()

  return (
    <>
      <PageHeader description={users.description} title={title} />

      <UserListWorkspace errors={errors} messages={users} />
    </>
  )
}
