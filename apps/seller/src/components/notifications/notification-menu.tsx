'use client'

import { Button, IconButton, Popover, linkClassName } from '@shopping/ui/components'
import NextLink from 'next/link'

import { useNotificationCenter } from '@/lib/notifications/notification-center'
import { badgeLabel } from '@/lib/notifications/notification-console'
import { count } from '@/lib/orders/format'
import type { NotificationCenterMessages } from '@/messages'

import { BellIcon } from '../layout/console-icons'
import { NotificationItem } from './notification-item'

/**
 * 상단바의 종 (TASK-0090 F3 · 4.5).
 *
 * TASK-0018 이 「알림함은 M11 에서 이 자리에 들어옵니다」라고 말하던 팝오버를
 * 대체한다 — M04 가 `layout.account` 자리에 진짜 계정 메뉴를 넣은 것과 같은 걸음이다.
 *
 * ## 한 번 물어서 둘을 얻는다
 *
 * 배지를 위한 라우트가 따로 없다. 목록이 미읽음 수를 함께 답하므로
 * `?unreadOnly=true&limit=5` 한 번이 **드롭다운의 다섯 줄과 배지의 숫자**를 같이
 * 가져온다 (`use-notifications.ts` 가 그 질의를 만든다). 따로 두면 알림함을 연 화면이
 * 같은 것을 두 번 묻는다.
 *
 * ## 배지의 숫자는 장식이다
 *
 * 보조 기술에게 「알림」 옆에 붙은 3은 아무 관계도 아니다. 그래서 숫자는
 * `aria-hidden` 으로 그리고, **개수는 버튼의 이름 안에 문장으로** 들어간다
 * (`labelWithUnread`). 리뷰 카드의 별 다섯 개가 같은 규약이다.
 *
 * ## 안 읽은 것만 담는다
 *
 * 계약이 그렇게 쓰라고 적어 두었고(`notificationListQueryParamsSchema`), 이유는
 * 종이 답하는 물음이 「지금 나한테 할 일이 왔나」이기 때문이다. 지난 알림을 보는
 * 물음은 알림함의 것이고, 그래서 패널의 마지막 줄이 거기로 보낸다.
 */

/** 알림함. 종에서만 닿는다 — 사이드바에 없는 화면이다. */
const INBOX_HREF = '/notifications'

export function NotificationMenu({ messages }: { readonly messages: NotificationCenterMessages }) {
  const center = useNotificationCenter()
  const copy = messages.menu
  const state = center?.state ?? null
  const unreadCount = state?.status === 'ready' ? state.unreadCount : 0
  const items = state?.status === 'ready' ? state.items : []
  // 다섯 줄에 다 담기지 않은 나머지. 배지의 수는 알림함 전체의 것이므로 이 뺄셈은
  // 「여기 안 보이는 것이 몇 개인가」를 정확히 답한다.
  const hidden = unreadCount - items.length
  const badge = badgeLabel(unreadCount, copy.badgeOverflow)

  return (
    <Popover
      align="end"
      closeLabel={copy.closeLabel}
      title={copy.title}
      trigger={
        <IconButton
          className="relative"
          label={
            unreadCount === 0
              ? copy.label
              : copy.labelWithUnread.replace('{count}', count(unreadCount))
          }
          size="sm"
          variant="ghost"
        >
          <BellIcon className="size-5" />
          {badge === null ? null : (
            <span
              aria-hidden="true"
              className="bg-primary text-primary-fg absolute end-0 top-0 min-w-4 rounded-full px-1 text-2xs leading-4 font-medium"
            >
              {badge}
            </span>
          )}
        </IconButton>
      }
    >
      {/*
        물을 수 없는 계정. 종은 그 자리에 그대로 서 있고 — 컨트롤이 나중에 생겨나면
        상단바의 오른쪽이 통째로 밀린다 — 패널이 사실만 말한다. 로그인이라는 다음
        걸음은 옆의 계정 메뉴가 이미 들고 있다.
      */}
      {center === null ? <p className="text-fg-muted">{copy.unavailable}</p> : null}

      {/*
        네 상태를 `DataList` 로 그리지 않는다. 그 컴포넌트는 화면 폭의 목록을 위한
        것이고 — 스켈레톤도 빈 상태도 카드 크기다 — 여기 들어가는 것은 팝오버 안의
        문장 한 줄이다. 강제되는 네 갈래는 그대로 지킨다.
      */}
      {state?.status === 'loading' ? <p className="text-fg-muted">{copy.loadingLabel}</p> : null}

      {center !== null && state?.status === 'error' ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-fg">{copy.errorTitle}</p>
          <Button onClick={center.reload} size="sm" type="button" variant="outline">
            {copy.retry}
          </Button>
        </div>
      ) : null}

      {state?.status === 'ready' && items.length === 0 ? (
        <p className="text-fg-muted">{copy.empty}</p>
      ) : null}

      {center === null || items.length === 0 ? null : (
        <ul aria-label={copy.listLabel} className="flex flex-col gap-2">
          {items.map((notification) => (
            <NotificationItem
              busy={center.reading}
              key={notification.id}
              messages={messages.item}
              notification={notification}
              onRead={() => {
                void center.markRead(notification.id)
              }}
            />
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="text-fg-subtle text-xs">{copy.moreNote.replace('{count}', count(hidden))}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/*
          알림함으로 가는 유일한 문이다 — 사이드바에 이 화면의 항목이 없다. 물을 수
          없는 계정에는 그리지 않는다: 거기서 열리는 것은 알림함이 아니라 콘솔 가드다.
        */}
        {center === null ? null : (
          <NextLink className={linkClassName('standalone')} href={INBOX_HREF}>
            {copy.seeAllLabel}
          </NextLink>
        )}
        {/*
          **id 를 주지 않는 읽음 처리다** — 「모두」는 이 다섯 줄이 아니라 알림함
          전체를 뜻한다 (F4). 보이는 것만 읽으면 배지가 0이 되지 않고, 사람은 같은
          버튼을 다시 누른다.
        */}
        {center === null || unreadCount === 0 ? null : (
          <Button
            disabled={center.reading}
            onClick={() => {
              void center.markRead(null)
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {copy.readAllLabel}
          </Button>
        )}
      </div>
    </Popover>
  )
}
