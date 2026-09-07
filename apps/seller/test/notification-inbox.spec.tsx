/**
 * `/notifications` — 알림함 (TASK-0090 F2 · F3 · F4).
 *
 * 종이 답하는 물음(「지금 나한테 할 일이 왔나」)의 반대쪽이다. 그래서 여기가 재는
 * 것은 종이 재지 않는 것들이다: 지난 알림까지 보이는가, 페이지가 넘어가는가, 필터가
 * 서버로 나가는가.
 *
 * **여기서는 폴링하지 않는다** (R1). 종이 모든 화면에 있으므로 이 화면에서도 이미
 * 돌고 있고, 두 번째 타이머는 30초마다 같은 것을 두 번 묻는다. 그 회귀는 화면에서
 * 보이지 않아 요청의 개수로만 드러난다.
 *
 * **읽음 처리는 배지에도 닿는다.** 마지막 describe 가 셸 안에서 그것을 잰다 — 셸이
 * 없으면 갱신할 배지도 없고, 그때 `useNotificationCenter()` 는 `null` 이다.
 */

import { sessionSellerOwner } from '@shopping/api-mocks'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SellerShell } from '@/components/layout/seller-shell'
import NotificationsPage from '@/app/notifications/page'
import { NOTIFICATION_POLL_INTERVAL_MS } from '@/lib/notifications/notification-console'
import { count } from '@/lib/orders/format'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  answerJsonBy,
  lastCallTo,
  lastRequestTo,
  requestsTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import {
  notificationsAllRead,
  notificationsEmpty,
  notificationsPage1,
  notificationsPage2,
  READ_REPORT_TITLE,
  readAcknowledged,
  UNREAD_ORDER_LINK,
  UNREAD_ORDER_TITLE,
  unreadNotifications,
} from './support/notification-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/notifications',
}))

const messages = messagesFor()

const copy = messages.notifications.page

const item = messages.notifications.item

const LIST_PATH = '/me/notifications'

const READ_PATH = '/me/notifications/read'

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function openInbox(): Promise<HTMLElement> {
  renderWithAuth(<NotificationsPage />)

  return screen.findByRole('list', { name: copy.listLabel })
}

function rows(list: HTMLElement): readonly HTMLElement[] {
  return within(list).getAllByRole('listitem')
}

describe('the notification inbox', () => {
  it('carries its own title — the sidebar has no entry for it', async () => {
    answerJson(LIST_PATH, notificationsPage1)
    await openInbox()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title)
  })

  it('asks for the whole inbox rather than the unread five', async () => {
    answerJson(LIST_PATH, notificationsPage1)
    await openInbox()

    const url = new URL(lastRequestTo(LIST_PATH) ?? '')

    // 지난 알림을 보는 물음이다. 종은 안 읽은 것만 담는다.
    expect(url.searchParams.has('unreadOnly')).toBe(false)
    // 한 페이지의 크기는 서버의 기본값이다.
    expect(url.searchParams.has('limit')).toBe(false)
  })

  it('shows read and unread side by side, each with its type', async () => {
    answerJson(LIST_PATH, notificationsPage1)
    const list = await openInbox()

    expect(rows(list)).toHaveLength(3)
    expect(within(list).getByText(UNREAD_ORDER_TITLE)).toBeVisible()
    expect(within(list).getByText(READ_REPORT_TITLE)).toBeVisible()
    expect(within(list).getByText(item.types.SELLER_ORDER)).toBeVisible()
    expect(within(list).getByText(item.types.REPORT_HANDLED)).toBeVisible()
  })

  it('marks the unread ones in words, not in colour alone', async () => {
    answerJson(LIST_PATH, notificationsPage1)
    const list = await openInbox()

    // 이 줄에서 「할 일인가」를 가르는 것이 정확히 이 상태다.
    expect(within(list).getAllByText(item.unreadBadge)).toHaveLength(2)
  })

  it('uses the app-relative link the notification carries (F2 · 4.7)', async () => {
    answerJson(LIST_PATH, notificationsPage1)
    const list = await openInbox()
    const links = within(list).getAllByRole('link', { name: item.openLabel })

    expect(links[0]).toHaveAttribute('href', UNREAD_ORDER_LINK)
    // 링크가 없는 알림은 링크를 그리지 않는다. 셋 중 하나가 그렇다.
    expect(links).toHaveLength(2)
  })

  describe('미읽음 건수 (F3)', () => {
    it('reports what the server counted, not what this page shows', async () => {
      answerJson(LIST_PATH, notificationsPage1)
      await openInbox()

      const region = screen.getByRole('region', { name: copy.unread.regionLabel })

      expect(within(region).getByText(copy.unread.value.replace('{count}', count(6)))).toBeVisible()
      expect(within(region).getByText(copy.unread.note)).toBeVisible()
    })

    it('says "nothing unread" rather than printing a zero', async () => {
      answerJson(LIST_PATH, notificationsEmpty)
      renderWithAuth(<NotificationsPage />)

      const region = await screen.findByRole('region', { name: copy.unread.regionLabel })

      expect(within(region).getByText(copy.unread.none)).toBeVisible()
      // 읽을 것이 없으면 「모두 읽음」도 없다.
      expect(within(region).queryByRole('button', { name: copy.readAllLabel })).toBeNull()
    })
  })

  describe('the filter', () => {
    it('sends unreadOnly and starts again from the first page', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, notificationsPage1)
      await openInbox()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unreadOnlyLabel }))

      await waitFor(() => {
        const url = new URL(lastRequestTo(LIST_PATH) ?? '')

        expect(url.searchParams.get('unreadOnly')).toBe('true')
        expect(url.searchParams.has('cursor')).toBe(false)
      })
    })

    it('says "none like this" rather than "none at all" when it is on', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.has('unreadOnly') ? notificationsEmpty : notificationsPage1,
      )
      await openInbox()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unreadOnlyLabel }))

      expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
    })

    it('clears the axis', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, notificationsPage1)
      await openInbox()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unreadOnlyLabel }))
      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.has('unreadOnly')).toBe(true)
      })

      await user.click(screen.getByRole('button', { name: copy.filters.reset }))

      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.has('unreadOnly')).toBe(false)
      })
    })
  })

  describe('paging', () => {
    it('hands the cursor back unchanged', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.get('cursor') === 'cursor-page-2'
          ? notificationsPage2
          : notificationsPage1,
      )
      const list = await openInbox()
      expect(rows(list)).toHaveLength(3)

      await user.click(screen.getByRole('button', { name: copy.pagination.next }))

      await waitFor(() => {
        expect(rows(screen.getByRole('list', { name: copy.listLabel }))).toHaveLength(1)
      })
      expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.get('cursor')).toBe(
        'cursor-page-2',
      )
    })
  })

  describe('읽음 처리 (F4)', () => {
    it('marks one row by its id', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, notificationsPage1)
      answerJson(READ_PATH, readAcknowledged)
      const list = await openInbox()

      await user.click(within(list).getAllByRole('button', { name: item.readLabel })[0]!)

      await waitFor(() => {
        expect(lastCallTo(READ_PATH)?.body).toEqual({ ids: [expect.any(String)] })
      })
    })

    it('sends no ids at all for "모두 읽음"', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, notificationsPage1)
      answerJson(READ_PATH, readAcknowledged)
      await openInbox()

      await user.click(screen.getByRole('button', { name: copy.readAllLabel }))

      await waitFor(() => {
        expect(lastCallTo(READ_PATH)?.body).toEqual({})
      })
    })

    it('says so when the API refuses, and leaves the list standing', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, notificationsPage1)
      answerFailure(READ_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')
      const list = await openInbox()

      await user.click(screen.getByRole('button', { name: copy.readAllLabel }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        messages.notifications.readFailureTitle,
      )
      expect(within(list).getByText(UNREAD_ORDER_TITLE)).toBeVisible()
    })
  })

  describe('when the API refuses the list', () => {
    it('offers a retry', async () => {
      answerFailure(LIST_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')
      renderWithAuth(<NotificationsPage />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    })
  })

  describe('폴링 (R1)', () => {
    it('does not start a second timer — the bell already has one', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      answerJson(LIST_PATH, notificationsPage1)
      renderWithAuth(<NotificationsPage />)
      await screen.findByRole('list', { name: copy.listLabel })

      await act(async () => {
        vi.advanceTimersByTime(NOTIFICATION_POLL_INTERVAL_MS * 3)
        await Promise.resolve()
      })

      // 읽는 사람 밑에서 줄이 밀리면 다른 것을 누르게 된다.
      expect(requestsTo(LIST_PATH)).toHaveLength(1)
    })
  })

  describe('inside the shell', () => {
    it('refreshes the top bar badge as soon as the inbox marks everything read', async () => {
      const user = userEvent.setup()
      let read = false

      // 종과 알림함이 **다른 질의**를 본다: 종은 안 읽은 다섯 줄, 화면은 자기 페이지.
      answerJsonBy(LIST_PATH, (url) => {
        if (url.searchParams.get('unreadOnly') !== 'true') return notificationsPage1

        return read ? notificationsAllRead : unreadNotifications
      })
      answerJson(READ_PATH, readAcknowledged)

      renderWithAuth(
        <SellerShell messages={messages.layout}>
          <NotificationsPage />
        </SellerShell>,
        { session: sessionSellerOwner },
      )

      await screen.findByRole('button', {
        name: messages.notifications.menu.labelWithUnread.replace('{count}', '6'),
      })

      read = true
      await user.click(await screen.findByRole('button', { name: copy.readAllLabel }))

      // 갱신하지 않으면 방금 「모두 읽음」을 누른 사람의 머리 위에서 숫자가 최대
      // 30초 동안 옛 값을 말한다.
      expect(
        await screen.findByRole('button', { name: messages.notifications.menu.label }),
      ).toBeVisible()
    })
  })
})
