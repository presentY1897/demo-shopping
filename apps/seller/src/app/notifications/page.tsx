import type { Metadata } from 'next'

import { NotificationInbox } from '@/components/notifications/notification-inbox'
import { messagesFor } from '@/messages'

const copy = messagesFor().notifications.page

export const metadata: Metadata = {
  title: copy.title,
  description: copy.description,
}

/**
 * `/notifications` — 알림함 (TASK-0090).
 *
 * **제목이 `screenTitle` 에서 오지 않는다.** 다른 화면은 사이드바 항목의 이름을
 * 그대로 제목으로 쓰지만(`screenTitle`), 이 화면은 **메뉴에 없다** — 들어오는 문이
 * 상단바의 종이고, `docs/design/pages.md` 2장의 판매자 경로 표에도 이 줄이 없다.
 * 없는 항목을 찾으면 콘솔 이름으로 되돌아오므로, 제목은 카탈로그가 직접 든다 —
 * `/products/new` 가 `products.newTitle` 을 같은 이유로 그렇게 든다.
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 알림은
 * 클라이언트 경계가 효과에서 읽는다 (P5).
 */
export default function Page() {
  return <NotificationInbox title={copy.title} />
}
