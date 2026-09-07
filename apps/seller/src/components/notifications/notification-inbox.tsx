'use client'

import type { ApiFailure } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import {
  Button,
  Checkbox,
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
} from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useNotificationCenter } from '@/lib/notifications/notification-center'
import { EMPTY_NOTIFICATION_FILTERS } from '@/lib/notifications/notification-console'
import { useNotifications } from '@/lib/notifications/use-notifications'
import { count } from '@/lib/orders/format'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { NotificationItem } from './notification-item'

/**
 * `/notifications` — 「무엇이 왔었나」 (TASK-0090).
 *
 * 종이 답하는 물음(「지금 나한테 할 일이 왔나」)의 반대쪽이다. 그래서 여기는 안 읽은
 * 것만 담지 않고, 페이지를 넘길 수 있고, 필터가 있다.
 *
 * 뼈대는 `review-list-workspace.tsx` · `question-list-workspace.tsx` 와 같다 —
 * 건수가 먼저 오고, 그것을 좁히는 필터가 그다음이며, 목록이 그 아래에 온다.
 *
 * ## 여기서는 폴링하지 않는다 (R1)
 *
 * 종이 모든 화면에 있으므로 이 화면에서도 이미 30초마다 돌고 있다. 두 번째 타이머는
 * 같은 것을 두 번 묻는 것이고, 커서로 넘긴 목록의 줄이 읽는 사람 밑에서 조용히
 * 바뀌는 것은 도움이 아니다 — 여기서 사람이 하는 일은 「읽고 눌러 이동」이고, 그
 * 사이에 줄이 밀리면 다른 것을 누르게 된다.
 *
 * ## 읽음 처리는 두 곳에 알린다
 *
 * 이 화면의 목록과 **상단바의 배지**다. 배지를 갱신하지 않으면 방금 「모두 읽음」을
 * 누른 사람의 머리 위에서 숫자가 최대 30초 동안 옛 값을 말한다. 셸이 없는 자리에서
 * 그려질 때는 알릴 곳이 없고(`useNotificationCenter` 가 `null` 을 준다), 그때는
 * 갱신할 배지도 없다.
 */
export interface NotificationInboxProps {
  readonly title: string
  readonly messages?: Messages
}

export function NotificationInbox({ title, messages = messagesFor() }: NotificationInboxProps) {
  const copy = messages.notifications.page
  const center = useNotificationCenter()
  const inbox = useNotifications()
  const { state, pagination } = inbox
  const items = state.status === 'ready' ? state.items : []

  /** 읽음 처리가 거절됐다. 목록은 그대로 두고 한 줄로 말한다. */
  const [readFailure, setReadFailure] = useState<string | null>(null)

  const describe = useCallback(
    (failure: ApiFailure) =>
      failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures }),
    [messages],
  )

  const read = useCallback(
    async (id: string | null) => {
      const result = await inbox.markRead(id)

      if (!result.ok) {
        setReadFailure(describe(result.failure))
        return
      }

      setReadFailure(null)
      // 상단바의 배지. 같은 답을 두 번 묻는 것이 아니라, **다른 질의**를 다시 읽는
      // 것이다 — 종은 안 읽은 다섯 줄을, 이 화면은 자기 페이지를 본다.
      center?.refresh()
    },
    [center, describe, inbox],
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-fg text-2xl font-bold">{title}</h1>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </header>

      {/*
        미읽음 건수. 리뷰·문의의 미답변 뱃지와 같은 자리, 같은 규약이다 — **필터와
        무관하다**(4.5). 그 사실을 `note` 가 적지 않으면 「안 읽은 알림만」을 켠
        사람에게 줄 수와 이 수의 차이가 버그로 읽힌다.
      */}
      <section
        aria-label={copy.unread.regionLabel}
        className="border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border p-3"
      >
        <h2 className="text-fg-muted text-sm">{copy.unread.regionLabel}</h2>
        {state.status === 'ready' ? (
          <p className="text-fg text-xl font-bold">
            {state.unreadCount === 0
              ? copy.unread.none
              : copy.unread.value.replace('{count}', count(state.unreadCount))}
          </p>
        ) : null}
        {state.status === 'ready' && state.unreadCount > 0 ? (
          <Button
            disabled={inbox.reading}
            onClick={() => {
              void read(null)
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.readAllLabel}
          </Button>
        ) : null}
        <p className="text-fg-subtle w-full text-xs">{copy.unread.note}</p>
      </section>

      <form
        className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault()
        }}
        role="search"
      >
        <fieldset className="contents">
          <legend className="sr-only">{copy.filters.legend}</legend>

          <div className="flex min-h-control-md items-center">
            <Checkbox
              checked={inbox.filters.unreadOnly}
              disabled={state.status === 'loading'}
              label={copy.filters.unreadOnlyLabel}
              onCheckedChange={(checked) => {
                // `indeterminate` 는 이 체크박스가 만들 수 있는 상태가 아니다.
                inbox.setFilters({ unreadOnly: checked === true })
              }}
            />
          </div>

          <Button
            onClick={() => {
              inbox.setFilters(EMPTY_NOTIFICATION_FILTERS)
            }}
            type="button"
            variant="ghost"
          >
            {copy.filters.reset}
          </Button>
        </fieldset>
      </form>

      {readFailure === null ? null : (
        <p
          className="border-danger bg-danger-surface text-fg rounded-md border px-4 py-3 text-sm"
          role="alert"
        >
          {`${messages.notifications.readFailureTitle} ${readFailure}`}
        </p>
      )}

      <DataList
        empty={
          inbox.isFiltered ? (
            <EmptyState
              description={copy.filteredEmpty.description}
              title={copy.filteredEmpty.title}
            />
          ) : (
            <EmptyState description={copy.empty.description} title={copy.empty.title} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={inbox.reload}
            retryLabel={copy.retry}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <ul aria-label={copy.listLabel} className="flex flex-col gap-3">
          {items.map((notification) => (
            <NotificationItem
              busy={inbox.reading}
              key={notification.id}
              messages={messages.notifications.item}
              notification={notification}
              onRead={() => {
                void read(notification.id)
              }}
            />
          ))}
        </ul>

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={copy.pagination.label}
          nextLabel={copy.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={copy.pagination.previous}
          status={copy.pagination.page.replace('{page}', String(pagination.pageIndex + 1))}
        />
      </DataList>
    </div>
  )
}
