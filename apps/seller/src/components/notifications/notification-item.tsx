'use client'

import type { Notification } from '@shopping/shared'
import { Badge, Button, linkClassName } from '@shopping/ui/components'
import NextLink from 'next/link'
import { useId } from 'react'

import { isUnread } from '@/lib/notifications/notification-console'
import { dateTime } from '@/lib/orders/format'
import type { NotificationItemMessages } from '@/messages'

/**
 * 알림 한 줄 (TASK-0090).
 *
 * **상단바의 종과 알림함이 같은 줄을 그린다.** 두 벌을 두면 종에서는 「읽음」이고
 * 목록에서는 「확인」인 날이 오고, 그때 같은 알림이 두 곳에서 다르게 읽힌다.
 *
 * ## 제목과 본문은 서버가 만든 문장이다
 *
 * 「새 주문이 들어왔어요」와 주문번호는 알림이 만들어질 때 굳는 값이다. 화면이 유형을
 * 보고 문장을 다시 조립하면, 오늘 문구를 고쳤을 때 **지난 알림까지 새 문구로 다시
 * 쓰인다** — 주문서를 스냅샷으로 남기는 것과 같은 이유다.
 *
 * ## 링크는 그대로 쓴다 (4.7)
 *
 * `link` 는 **앱 안의 경로**다(`/orders/…`). 도메인을 붙이지 않는 이유는 알림을 읽는
 * 앱이 셋이고 각자 자기 도메인에서 열기 때문이고, 그래서 여기서 할 일은 `next/link`
 * 에 그대로 넘기는 것뿐이다. 조합하면 배포마다 달라지는 값이 화면에 굳는다.
 *
 * `link` 가 `null` 인 알림이 있다 — 갈 곳이 없는 소식이다. 그때 버튼을 그리면 아무
 * 데도 가지 않는 링크가 되므로 그리지 않는다.
 */
export interface NotificationItemProps {
  readonly notification: Notification
  /** 이 줄만 읽음 처리. 읽은 줄에는 그릴 것이 없다. */
  readonly onRead: () => void
  /** 읽음 처리가 나가 있다. 두 번째 클릭이 두 번째 요청이 되지 않는다. */
  readonly busy: boolean
  readonly messages: NotificationItemMessages
}

export function NotificationItem({ notification, onRead, busy, messages }: NotificationItemProps) {
  const titleId = useId()
  const unread = isUnread(notification)

  return (
    <li
      aria-labelledby={titleId}
      className="border-border flex flex-col gap-1 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge size="sm" variant="neutral">
          {messages.types[notification.type]}
        </Badge>
        {/*
          **읽지 않았다는 것을 색만으로 말하지 않는다.** 굵기나 점 하나로 표시하면
          그 상태는 보조 기술에게 존재하지 않고, 이 줄에서 「할 일인가」를 가르는
          것이 정확히 그 상태다.
        */}
        {unread ? (
          <Badge size="sm" variant="primary">
            {messages.unreadBadge}
          </Badge>
        ) : null}
      </div>

      <p className="text-fg text-sm font-medium" id={titleId}>
        {notification.title}
      </p>
      <p className="text-fg-muted text-sm">{notification.body}</p>
      <p className="text-fg-subtle text-xs">
        {messages.receivedAt.replace('{date}', dateTime(notification.createdAt))}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {notification.link === null ? null : (
          // `next/link` 를 직접 쓴다. `packages/ui` 의 `Link` 는 평범한 `<a>` 라
          // 클라이언트 전환을 하지 않고, 콘솔 안의 이동은 전부 전환이어야 한다.
          // 생김새는 `linkClassName()` 이 그 패키지에서 그대로 가져온다.
          <NextLink className={linkClassName('standalone')} href={notification.link}>
            {messages.openLabel}
          </NextLink>
        )}
        {unread ? (
          <Button disabled={busy} onClick={onRead} size="sm" type="button" variant="ghost">
            {messages.readLabel}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
