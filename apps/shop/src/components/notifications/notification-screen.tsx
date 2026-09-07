'use client'

import { NOTIFICATION_LIST_DEFAULT_LIMIT } from '@shopping/shared'
import { Button, EmptyState, Tag } from '@shopping/ui/components'
import { formatDate } from '@shopping/ui/format'
import Link from 'next/link'

import { AccountLoadFailure, AccountLoading } from '@/components/mypage/account-notices'
import { useNotifications } from '@/lib/notifications/use-notifications'
import type { MyPageMessages } from '@/messages'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * `/mypage/notifications` — 알림함 (TASK-0090 F2 · F3 · F4).
 *
 * ## 헤더의 드롭다운과 **같은 훅**이다
 *
 * 다른 것은 질의 둘뿐이다 — 여기서는 읽은 것까지 전부 받고, 30초 폴링을 하지 않는다.
 * 폴링하지 않는 이유는 이것이 **열려 있는 화면**이라 사람이 보고 있고, 새로 온 것을
 * 놓쳐서 곤란한 자리는 헤더의 배지이기 때문이다.
 *
 * ## 미읽음 수는 목록의 길이가 아니다
 *
 * 계약이 필터와 무관한 계정의 수를 함께 보낸다(`unreadCount`). 목록을 세면 다음 장에
 * 남은 안 읽은 알림이 빠지고, 「안 읽음 3」인데 배지는 12인 화면이 만들어진다.
 *
 * ## 누르면 가고, 읽음이 된다
 *
 * `link` 는 앱 안의 경로다. 도메인을 붙이지 않는 것이 계약의 요구이고, 그 이유는
 * 알림을 읽는 앱이 셋이기 때문이다 (`notificationSchema`).
 */
export function NotificationScreen({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.notifications
  const inbox = useNotifications({
    limit: NOTIFICATION_LIST_DEFAULT_LIMIT,
    poll: false,
    unreadOnly: false,
  })

  if (inbox.state.status === 'loading') return <AccountLoading label={copy.loadingLabel} />

  if (inbox.state.status === 'error') {
    return (
      <AccountLoadFailure
        failure={inbox.state.failure}
        messages={messages}
        onRetry={inbox.reload}
      />
    )
  }

  if (inbox.notifications.length === 0) {
    return <EmptyState description={copy.emptyBody} title={copy.emptyTitle} />
  }

  const unread = inbox.unreadCount ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-muted text-sm">
          {copy.unreadCount.replace('{count}', unread.toLocaleString(LOCALE))}
        </p>
        {unread === 0 ? null : (
          <Button onClick={inbox.readAll} size="sm" type="button" variant="outline">
            {copy.readAllLabel}
          </Button>
        )}
      </div>

      {inbox.failed ? (
        <p className="text-danger text-sm" role="status">
          {copy.failedNotice}
        </p>
      ) : null}

      <ul aria-label={copy.listLabel} className="flex flex-col">
        {inbox.notifications.map((notification) => (
          <li
            className="border-border flex flex-col gap-1 border-b py-4 last:border-b-0"
            key={notification.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              {notification.readAt === null ? (
                <Tag variant="primary">{copy.unreadBadge}</Tag>
              ) : null}
              <span className="text-fg-subtle text-xs">
                {formatDate(notification.createdAt, {
                  locale: LOCALE,
                  style: 'dateTime',
                  timeZone: TIME_ZONE,
                })}
              </span>
            </div>

            <p className="text-fg text-sm font-medium">{notification.title}</p>
            <p className="text-fg-muted text-sm">{notification.body}</p>

            <div className="flex flex-wrap items-center gap-2">
              {notification.link === null ? null : (
                <Link
                  className="text-primary min-h-touch inline-flex items-center text-sm underline"
                  href={notification.link}
                  onClick={() => {
                    inbox.read(notification.id)
                  }}
                >
                  {copy.openLabel}
                </Link>
              )}

              {notification.readAt === null ? (
                <Button
                  onClick={() => {
                    inbox.read(notification.id)
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {copy.readLabel.replace('{title}', notification.title)}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {inbox.hasMore ? (
        <div>
          <Button
            loading={inbox.loadingMore}
            onClick={inbox.loadMore}
            size="sm"
            type="button"
            variant="outline"
          >
            {inbox.loadingMore ? copy.moreLoading : copy.moreLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
