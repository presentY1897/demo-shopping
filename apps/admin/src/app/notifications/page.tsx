import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { NotificationWorkspace } from '@/components/notifications/notification-workspace'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.notifications.title,
  description: messages.notifications.description,
}

/**
 * `/notifications` — 알림함 전체 (TASK-0090).
 *
 * **제목이 `screenTitle` 에서 오지 않는다.** 그 함수는 사이드바의 항목에서 이름을
 * 읽는데(`messages/index.ts`), 이 화면은 사이드바에 없다 — 메뉴의 경로와 순서는
 * `docs/design/pages.md` 3장이 유일한 출처이고 그 표에 알림함은 없다. 여기로 오는
 * 길은 상단바의 종이 여는 드롭다운의 「전체 보기」다.
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 (TASK-0101 4.3 · P5).
 */
export default function NotificationsPage() {
  const { notifications, errors } = messagesFor()

  return (
    <>
      <PageHeader description={notifications.description} title={notifications.title} />

      <NotificationWorkspace errors={errors} messages={notifications} />
    </>
  )
}
