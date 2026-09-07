'use client'

import type { Notification } from '@shopping/shared'
import { Button, ErrorState, IconButton, Popover, Skeleton } from '@shopping/ui/components'
import Link from 'next/link'
import { useState } from 'react'

import { BellIcon } from '@/components/layout/icons'
import type { Inbox } from '@/lib/notifications/use-notifications'
import type { NotificationMenuMessages } from '@/messages'

/**
 * 헤더의 알림 드롭다운 (TASK-0090 F2 · F3 · F4 · F8).
 *
 * ## 로그인한 사람에게만 있다
 *
 * 익명 방문자에게는 알림이 없고, 버튼을 두면 그것은 30초마다 401 을 받는 장치가 된다.
 * 그래서 이 컴포넌트는 로그인했을 때만 마운트되고, 헤더가 그 판단을 한다 —
 * 「자리는 두되 비활성」(TASK-0023 4장)이 아닌 이유는 **없는 기능이 아니라 지금
 * 당신의 것이 아닌 것**이기 때문이다. 로그인 안내는 그 옆 계정 메뉴가 이미 한다.
 *
 * ## 배지는 그림이고 수는 이름 안에 있다
 *
 * `aria-hidden` 인 숫자를 따로 읽어 주면 「알림 3」이 아니라 「알림」 「3」 두
 * 덩어리로 들린다. 장바구니 배지가 같은 이유로 같은 모양이다 (`shop-header.tsx`).
 *
 * ## 안 읽은 것만 보인다
 *
 * 드롭다운은 `unreadOnly` 로 다섯 개를 받는다. 전부를 여기 담으면 이 패널이 알림함
 * 페이지와 같은 화면이 되고, 헤더에서 훑는 사람이 찾는 것은 **아직 안 본 것**이다.
 * 전체는 아래 링크가 데려간다.
 *
 * ## 알림을 누르면 링크로 가고 **읽음이 된다**
 *
 * `link` 는 앱 안의 경로다(`notificationSchema`). 도메인을 붙이지 않는 이유는 알림을
 * 읽는 앱이 셋이고 각자 자기 도메인에서 열기 때문이다 — 붙이면 배포마다 달라지는
 * 값이 링크에 굳는다.
 *
 * 누른 줄을 목록에서 **지우지 않는다.** 안 읽은 것만 보는 패널에서 그렇게 하면 누른
 * 알림이 손가락 아래에서 사라지고, 링크를 따라가려던 사람이 무엇을 눌렀는지 잃는다.
 */
export function NotificationMenu({
  copy,
  inbox,
}: {
  readonly copy: NotificationMenuMessages
  readonly inbox: Inbox
}) {
  const [open, setOpen] = useState(false)
  const unread = inbox.unreadCount ?? 0

  return (
    <Popover
      align="end"
      closeLabel={copy.closeLabel}
      onOpenChange={setOpen}
      open={open}
      title={copy.title}
      trigger={
        <IconButton
          className="relative"
          label={unread === 0 ? copy.label : copy.labelWithCount.replace('{count}', String(unread))}
          size="sm"
          variant="ghost"
        >
          <BellIcon className="size-5" />
          {unread === 0 ? null : (
            <span
              aria-hidden="true"
              className="bg-accent text-on-accent absolute top-0 right-0 min-w-4 rounded-full px-1 text-center text-xs leading-4 font-semibold tabular-nums"
            >
              {unread}
            </span>
          )}
        </IconButton>
      }
    >
      <div className="flex w-72 flex-col gap-2">
        {inbox.state.status === 'loading' ? (
          <div aria-busy="true" aria-label={copy.loadingLabel} role="status">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}

        {inbox.state.status === 'error' ? (
          <ErrorState onRetry={inbox.reload} retryLabel={copy.retryLabel} title={copy.errorTitle} />
        ) : null}

        {inbox.state.status === 'ready' ? (
          inbox.notifications.length === 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-fg text-sm font-medium">{copy.emptyTitle}</p>
              <p className="text-fg-muted text-sm">{copy.emptyBody}</p>
            </div>
          ) : (
            <ul aria-label={copy.listLabel} className="flex flex-col">
              {inbox.notifications.map((notification) => (
                <li className="border-border border-b py-2 last:border-b-0" key={notification.id}>
                  <MenuEntry
                    notification={notification}
                    onOpen={() => {
                      setOpen(false)
                      inbox.read(notification.id)
                    }}
                    onRead={() => {
                      inbox.read(notification.id)
                    }}
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}

        {inbox.failed ? (
          <p className="text-danger text-xs" role="status">
            {copy.failedNotice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            className="text-primary min-h-touch inline-flex items-center text-sm underline"
            href="/mypage/notifications"
            onClick={() => {
              setOpen(false)
            }}
          >
            {copy.allLabel}
          </Link>

          {unread === 0 ? null : (
            <Button onClick={inbox.readAll} size="sm" type="button" variant="ghost">
              {copy.readAllLabel}
            </Button>
          )}
        </div>
      </div>
    </Popover>
  )
}

/**
 * 한 줄 — 갈 곳이 있으면 링크, 없으면 읽음 처리 버튼.
 *
 * `link` 가 `null` 인 알림이 계약에 있다(`notificationSchema`). 그때 줄 전체를 링크로
 * 만들면 아무 데도 가지 않는 링크가 되고, 그것은 눌러 보기 전까지 알 수 없다.
 */
function MenuEntry({
  notification,
  onOpen,
  onRead,
}: {
  readonly notification: Notification
  readonly onOpen: () => void
  readonly onRead: () => void
}) {
  const body = (
    <>
      <span className="text-fg text-sm font-medium">{notification.title}</span>
      <span className="text-fg-muted text-xs">{notification.body}</span>
    </>
  )

  if (notification.link === null) {
    return (
      <button
        className="flex w-full flex-col items-start gap-0.5 text-left"
        onClick={onRead}
        type="button"
      >
        {body}
      </button>
    )
  }

  return (
    <Link className="flex flex-col gap-0.5" href={notification.link} onClick={onOpen}>
      {body}
    </Link>
  )
}
