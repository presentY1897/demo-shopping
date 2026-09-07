'use client'

import type { Notification } from '@shopping/shared'
import { Badge, Button, linkClassName } from '@shopping/ui/components'
import NextLink from 'next/link'

import { notificationDateTime } from '@/lib/notifications/format'
import { isUnread } from '@/lib/notifications/notification-console'
import type { NotificationMessages } from '@/messages'

/**
 * 알림 줄들 — 드롭다운과 `/notifications` 가 같은 것을 그린다.
 *
 * ## 링크는 **앱 안의 경로**다
 *
 * 계약의 `link` 는 `/sellers` 같은 상대 경로이고(`notifications.ts`), 도메인이
 * 실려 오지 않는 이유는 알림을 읽는 앱이 셋이기 때문이다. 그러므로 **그대로**
 * `next/link` 에 넘긴다 — 앞에 무엇을 붙이는 순간 그것은 이 콘솔이 지어낸 주소가
 * 되고, 배포마다 달라진다.
 *
 * `link` 가 없는 알림도 있다(신고 처리 결과가 그렇다). 그때는 링크를 만들지 않고
 * 그렇다고 말한다 — 누를 수 없는 링크가 목록에 섞여 있으면 어느 것이 눌리는지 알
 * 방법이 없다.
 *
 * ## 안 읽음은 **색이 아니라 낱말**로 말한다
 *
 * 굵은 글씨와 점만으로 구분하면 그 구분은 화면을 볼 수 없는 사람에게 존재하지
 * 않는다 (WCAG 1.4.1). 뱃지 하나가 그 일을 한다.
 *
 * ## 누르면 읽힌다
 *
 * 링크를 누르는 것은 「이 알림을 봤다」는 뜻이므로 그 자리에서 읽음으로 넘긴다.
 * 이동하지 않고 읽음만 표시하고 싶은 사람을 위해 버튼도 따로 있다 — 목록을 정리하는
 * 일과 알림을 따라가는 일은 다른 일이다.
 */

export interface NotificationListProps {
  readonly notifications: readonly Notification[]
  readonly messages: NotificationMessages
  /** 이 알림을 읽음으로. 이동과 별개로 부를 수 있다. */
  readonly onRead: (id: string) => void
  readonly busy: boolean
}

export function NotificationList({ notifications, messages, onRead, busy }: NotificationListProps) {
  return (
    <ul aria-label={messages.listLabel} className="flex flex-col gap-2">
      {notifications.map((notification) => (
        <li
          className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm"
          key={notification.id}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="neutral">
              {messages.typeLabels[notification.type]}
            </Badge>
            {isUnread(notification) ? (
              <Badge size="sm" variant="primary">
                {messages.unreadLabel}
              </Badge>
            ) : null}
            <span className="text-fg-subtle text-xs">
              {notificationDateTime(notification.createdAt)}
            </span>
          </div>

          {notification.link === null ? (
            <p className="text-fg font-medium">{notification.title}</p>
          ) : (
            <NextLink
              className={`${linkClassName()} font-medium`}
              href={notification.link}
              onClick={() => {
                if (isUnread(notification)) onRead(notification.id)
              }}
            >
              {notification.title}
            </NextLink>
          )}

          <p className="text-fg-muted whitespace-pre-wrap">{notification.body}</p>

          {notification.link === null ? (
            <p className="text-fg-subtle text-xs">{messages.noLink}</p>
          ) : null}

          {isUnread(notification) ? (
            <div>
              <Button
                disabled={busy}
                onClick={() => {
                  onRead(notification.id)
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {messages.markReadLabel}
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
