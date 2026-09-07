'use client'

import type { ApiFailure, ErrorMessages } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import {
  Button,
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  Switch,
} from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { useNotifications } from '@/lib/notifications/use-notifications'
import type { NotificationMessages } from '@/messages'

import { NotificationList } from './notification-list'

/**
 * `/notifications` — 알림함 전체 (TASK-0090 F2 · F3 · F4).
 *
 * ## 사이드바에 없는 화면이다
 *
 * 메뉴의 경로와 순서는 `docs/design/pages.md` 3장이 유일한 출처이고 그 표에 알림함은
 * 없다. 여기로 오는 길은 상단바의 종이 여는 드롭다운의 「전체 보기」 하나다 — 콘솔의
 * 사이드바는 **관리하는 대상**의 목록이고 알림함은 내 것이라, `auth` 슬롯의 계정
 * 메뉴와 같은 성질이다.
 *
 * ## 여기는 폴링하지 않는다
 *
 * 30초 폴링은 **배지**를 위한 것이고, 배지는 상단바에 있다(F8). 열어 놓고 보는 목록이
 * 30초마다 손 밑에서 다시 그려질 이유는 없다 — 사람이 「다시 시도」나 필터로 스스로
 * 다시 읽는다.
 *
 * ## 「안 읽은 것만」은 스위치다
 *
 * 하나의 사실을 즉시 바꾸고 다른 칸과 합의할 것이 없으므로, 저장 버튼이 사이에 있을
 * 이유가 없다 (WAI-ARIA switch 패턴). 켜고 끄면 첫 페이지로 돌아간다 — 커서는 그
 * 필터 안에서만 위치를 뜻하기 때문이다.
 */

export interface NotificationWorkspaceProps {
  readonly messages: NotificationMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function NotificationWorkspace({ messages, errors }: NotificationWorkspaceProps) {
  const { state: session } = useAuth()
  const [unreadOnly, setUnreadOnly] = useState(false)

  const inbox = useNotifications({
    unreadOnly,
    limit: null,
    poll: false,
    enabled: session.status === 'signedIn',
  })

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  // 아직 묻는 중이다. 여기서 「로그인이 필요합니다」를 그리면 부팅 갱신이 도는 동안
  // 모든 운영자에게 그 문장이 한 번씩 스친다 (`auth-context.tsx`).
  if (session.status === 'checking') return <Skeleton label={messages.loadingLabel} lines={6} />

  if (session.status !== 'signedIn') {
    return <EmptyState description={messages.signedOut} title={messages.emptyTitle} />
  }

  const { state, pagination } = inbox
  const rows = state.status === 'ready' ? state.notifications : []
  const unreadCount = state.status === 'ready' ? state.unreadCount : 0

  return (
    <div className="flex flex-col gap-4">
      <section className="border-border bg-surface-muted flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
        <p className="text-fg text-sm font-medium">
          {messages.unreadCount.replace('{count}', String(unreadCount))}
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Switch
            checked={unreadOnly}
            description={messages.unreadOnlyDescription}
            label={messages.unreadOnlyLabel}
            name="unreadOnly"
            onCheckedChange={setUnreadOnly}
          />

          <Button
            disabled={inbox.busy || unreadCount === 0}
            onClick={() => {
              void inbox.markRead()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {messages.allReadLabel}
          </Button>
        </div>
      </section>

      <DataList
        empty={
          unreadOnly ? (
            <EmptyState
              description={messages.unreadEmptyDescription}
              title={messages.unreadEmptyTitle}
            />
          ) : (
            <EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={inbox.reload}
            retryLabel={messages.retryLabel}
            title={messages.errorTitle}
          />
        }
        loading={<Skeleton label={messages.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <NotificationList
          busy={inbox.busy}
          messages={messages}
          notifications={rows}
          onRead={(id) => {
            void inbox.markRead([id])
          }}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.pagination.label}
          nextLabel={messages.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>
    </div>
  )
}

/** `2 페이지 · 20건`. 카탈로그의 조각을 이어 붙인다 (다른 목록 화면과 같은 방식). */
function pageStatus(messages: NotificationMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
