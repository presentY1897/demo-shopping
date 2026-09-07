'use client'

import { Button, IconButton, Popover, Skeleton } from '@shopping/ui/components'
import NextLink from 'next/link'
import type { ReactNode } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import {
  badgeLabel,
  NOTIFICATION_DROPDOWN_LIMIT,
  NOTIFICATIONS_HREF,
} from '@/lib/notifications/notification-console'
import { useNotifications } from '@/lib/notifications/use-notifications'
import type { NotificationMessages } from '@/messages'

import { NotificationList } from './notification-list'

/**
 * 상단바의 종 (TASK-0090 F3 · F8).
 *
 * TASK-0019 가 자리만 잡아 둔 `ConsoleSlot` 팝오버를 대체한다 — 그 팝오버는 「알림함은
 * M11 에서 이 자리에 들어옵니다」라고 말하고 있었고, 이것이 그 M11 이다. 같은 모양,
 * 같은 크기, 같은 자리다: 세션이 풀릴 때 크기가 달라지는 컨트롤은 그 옆의 계정 메뉴를
 * 매번 밀어낸다.
 *
 * ## 배지의 숫자는 **이름에도** 있다
 *
 * 종 위의 작은 원은 그림이라 읽히지 않는다. `IconButton` 의 `label` 이 「알림 (안 읽은
 * 알림 3건)」이 되고, 원 자체는 `aria-hidden` 이다 — 같은 값이 두 번 읽히면 그것도
 * 소음이다.
 *
 * ## 안 읽은 다섯 개만, 30초마다
 *
 * `limit=5&unreadOnly=true` 한 번으로 목록과 배지를 함께 얻는다(TASK-0090 4.5). **탭이
 * 가려져 있는 동안에는 묻지 않는다** — 안 보는 화면을 위해 30초마다 서버를 두드리면
 * 콘솔을 열어 둔 탭 하나가 하루에 2,880번을 묻고, 이 저장소의 API 는 잠들었다 깨는 무료
 * 인스턴스 위에 있다 (R1 · TASK-0009 R8).
 *
 * ## 로그인 전에는 아무것도 묻지 않는다
 *
 * 답은 401 이고, 그 401 은 아무도 볼 수 없는 자리에서 30초마다 되풀이된다. 그래도
 * **컨트롤은 살아 있다** — 누를 수 없는 컨트롤은 키보드 사용자에게 막다른 길이고, 그것이
 * TASK-0018 4.5 가 이 자리에 대해 정한 규약이다.
 */

export function NotificationSlot({
  messages,
  icon,
}: {
  readonly messages: NotificationMessages
  readonly icon: ReactNode
}) {
  const { state } = useAuth()
  const signedIn = state.status === 'signedIn'

  const inbox = useNotifications({
    unreadOnly: true,
    limit: NOTIFICATION_DROPDOWN_LIMIT,
    poll: true,
    enabled: signedIn,
  })

  const unreadCount = inbox.state.status === 'ready' ? inbox.state.unreadCount : 0
  const badge = badgeLabel(unreadCount, messages.badgeOverflow)

  return (
    <Popover
      align="end"
      closeLabel={messages.slot.closeLabel}
      title={messages.slot.title}
      trigger={
        <IconButton
          className="relative"
          label={
            badge === null
              ? messages.slot.label
              : messages.slot.labelWithCount.replace('{count}', String(unreadCount))
          }
          size="sm"
          variant="ghost"
        >
          {icon}
          {badge === null ? null : (
            <span
              aria-hidden="true"
              className="bg-danger text-danger-fg absolute end-0 top-0 min-w-4 rounded-full px-1 text-2xs leading-4 font-medium tabular-nums"
            >
              {badge}
            </span>
          )}
        </IconButton>
      }
    >
      {signedIn ? (
        <div className="flex flex-col gap-3">
          <SlotBody inbox={inbox} messages={messages} />

          <div className="flex items-center justify-between gap-2">
            <NextLink
              className="text-primary text-sm font-medium underline"
              href={NOTIFICATIONS_HREF}
            >
              {messages.viewAll}
            </NextLink>

            <Button
              disabled={inbox.busy || unreadCount === 0}
              onClick={() => {
                void inbox.markRead()
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {messages.allReadLabel}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-fg-muted">{messages.signedOut}</p>
      )}
    </Popover>
  )
}

/** 드롭다운 안쪽 — 불러오는 중 · 못 불러옴 · 비었음 · 다섯 줄. */
function SlotBody({
  inbox,
  messages,
}: {
  readonly inbox: ReturnType<typeof useNotifications>
  readonly messages: NotificationMessages
}) {
  const { state } = inbox

  if (state.status === 'loading') return <Skeleton label={messages.loadingLabel} lines={3} />

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-fg-muted">{messages.errorTitle}</p>
        <Button onClick={inbox.reload} size="sm" type="button" variant="outline">
          {messages.retryLabel}
        </Button>
      </div>
    )
  }

  if (state.notifications.length === 0) {
    return <p className="text-fg-muted">{messages.unreadEmptyTitle}</p>
  }

  return (
    <NotificationList
      busy={inbox.busy}
      messages={messages}
      notifications={state.notifications}
      onRead={(id) => {
        void inbox.markRead([id])
      }}
    />
  )
}
