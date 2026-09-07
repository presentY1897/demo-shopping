/**
 * 상단바의 종 (TASK-0090 F2 · F3 · F4 · F8 · R1).
 *
 * 셸 안에서 재는 이유는 이 컨트롤이 **셸의 슬롯**이기 때문이다. `console-shell.spec`
 * 이 그 자리에 「M11 이 채운다」고 말하는 팝오버가 있는지를 재고 있었고, 이제 그
 * 자리에 진짜 알림함이 들어왔다.
 *
 * 재는 것 넷.
 *
 * **한 번 물어서 둘을 얻는다** (4.5) — `?unreadOnly=true&limit=5` 하나가 드롭다운의
 * 다섯 줄과 배지의 숫자를 같이 가져온다. 배지를 위한 라우트를 따로 두는 회귀는 요청의
 * 개수로만 드러난다.
 *
 * **배지의 숫자는 목록에서 파생되지 않는다.** 픽스처의 미읽음 수는 6이고 드롭다운에
 * 실려 오는 줄은 둘이다.
 *
 * **「모두 읽음」은 id 를 보내지 않는다** (F4). 보이는 다섯 줄만 읽으면 배지가 0이
 * 되지 않고, 사람은 같은 버튼을 다시 누른다.
 *
 * **탭이 숨으면 폴링이 멈춘다** (R1). 이 회귀는 화면에서 전혀 보이지 않는다 — 달라지는
 * 것은 아무도 보지 않는 탭이 30초마다 서버를 두드리는 일뿐이다.
 */

import { sessionSellerOwner } from '@shopping/api-mocks'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SellerShell } from '@/components/layout/seller-shell'
import { NOTIFICATION_POLL_INTERVAL_MS } from '@/lib/notifications/notification-console'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  lastCallTo,
  requestsTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import {
  notificationsAllRead,
  READ_REPORT_TITLE,
  readAcknowledged,
  UNREAD_ORDER_LINK,
  UNREAD_ORDER_TITLE,
  UNREAD_SETTLEMENT_TITLE,
  unreadNotifications,
} from './support/notification-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

const { layout, notifications } = messagesFor()

const menu = notifications.menu

const LIST_PATH = '/me/notifications'

const READ_PATH = '/me/notifications/read'

/**
 * 탭이 보이는가 — jsdom 은 `document.hidden` 을 늘 `false` 로 답한다.
 *
 * 프로퍼티를 갈아 끼우고 이벤트를 직접 쏘는 것이 브라우저가 하는 일 그대로다.
 */
function setTabHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})

function renderShell() {
  return renderWithAuth(
    <SellerShell messages={layout}>
      <h1>대시보드</h1>
    </SellerShell>,
    { session: sessionSellerOwner },
  )
}

/**
 * 종. 이름이 미읽음 수에 따라 바뀌므로 정규식으로 찾는다.
 *
 * 세션이 도착하기 전에도 **그 자리에 있다** — 나중에 생겨나는 컨트롤은 상단바의
 * 오른쪽을 통째로 민다. `findBy` 인 것은 셸이 세션을 기다리는 첫 프레임 때문이다.
 */
async function findBell(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: new RegExp(menu.label) })
}

describe('the notification bell', () => {
  it('asks once for the list and the badge together (4.5)', async () => {
    answerJson(LIST_PATH, unreadNotifications)
    renderShell()
    await findBell()

    await waitFor(() => {
      expect(requestsTo(LIST_PATH)).toHaveLength(1)
    })

    const url = new URL(requestsTo(LIST_PATH)[0] ?? '')

    expect(url.searchParams.get('unreadOnly')).toBe('true')
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('says how many are unread in the button name, not only in the badge', async () => {
    answerJson(LIST_PATH, unreadNotifications)
    renderShell()

    // 보조 기술에게 「알림」 옆에 붙은 6은 아무 관계도 아니다.
    expect(
      await screen.findByRole('button', {
        name: menu.labelWithUnread.replace('{count}', '6'),
      }),
    ).toBeVisible()
  })

  it('counts what the server counted, not the rows it was handed', async () => {
    answerJson(LIST_PATH, unreadNotifications)
    renderShell()

    // 드롭다운에 실린 줄은 둘이다. 배지가 목록에서 파생되면 여기서 2가 나온다.
    await screen.findByRole('button', { name: menu.labelWithUnread.replace('{count}', '6') })
    expect(
      screen.queryByRole('button', { name: menu.labelWithUnread.replace('{count}', '2') }),
    ).toBeNull()
  })

  it('is named without a count when there is nothing to do', async () => {
    answerJson(LIST_PATH, notificationsAllRead)
    renderShell()

    // 늘 켜져 있는 배지는 아무것도 알리지 않는다.
    expect(await screen.findByRole('button', { name: menu.label })).toBeVisible()
  })

  it('lists the unread ones with their link, and says how many did not fit', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, unreadNotifications)
    renderShell()

    await user.click(await findBell())

    const list = await screen.findByRole('list', { name: menu.listLabel })

    expect(within(list).getByText(UNREAD_ORDER_TITLE)).toBeVisible()
    expect(within(list).getByText(UNREAD_SETTLEMENT_TITLE)).toBeVisible()
    // 링크는 앱 안의 경로다 (4.7). 조합하지 않고 그대로 쓴다.
    expect(
      within(list).getAllByRole('link', { name: notifications.item.openLabel })[0],
    ).toHaveAttribute('href', UNREAD_ORDER_LINK)
    // 6 − 2. 나머지는 알림함에 있다.
    expect(screen.getByText(menu.moreNote.replace('{count}', '4'))).toBeVisible()
  })

  it('offers a way to the inbox, which the sidebar does not carry', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, unreadNotifications)
    renderShell()

    await user.click(await findBell())

    expect(await screen.findByRole('link', { name: menu.seeAllLabel })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })

  it('says there is nothing to do rather than showing an empty box', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, notificationsAllRead)
    renderShell()

    await user.click(await findBell())

    expect(await screen.findByText(menu.empty)).toBeVisible()
  })

  it('offers a retry when the API refuses', async () => {
    const user = userEvent.setup()
    answerFailure(LIST_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')
    renderShell()

    await user.click(await findBell())

    expect(await screen.findByText(menu.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: menu.retry })).toBeVisible()
  })

  describe('읽음 처리 (F4)', () => {
    it('marks one row by its id', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, unreadNotifications)
      answerJson(READ_PATH, readAcknowledged)
      renderShell()

      await user.click(await findBell())

      const list = await screen.findByRole('list', { name: menu.listLabel })
      const rows = within(list).getAllByRole('button', { name: notifications.item.readLabel })

      await user.click(rows[0]!)

      await waitFor(() => {
        expect(lastCallTo(READ_PATH)?.body).toEqual({ ids: [expect.any(String)] })
      })
    })

    it('sends no ids at all for "모두 읽음" — that is what 전부 means', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, unreadNotifications)
      answerJson(READ_PATH, readAcknowledged)
      renderShell()

      await user.click(await findBell())
      await user.click(await screen.findByRole('button', { name: menu.readAllLabel }))

      await waitFor(() => {
        // 보이는 것만 읽으면 배지가 0이 되지 않는다.
        expect(lastCallTo(READ_PATH)?.body).toEqual({})
      })
    })

    it('offers no "모두 읽음" when there is nothing unread', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, notificationsAllRead)
      renderShell()

      await user.click(await findBell())
      await screen.findByText(menu.empty)

      expect(screen.queryByRole('button', { name: menu.readAllLabel })).toBeNull()
    })
  })

  describe('폴링 (F8 · R1)', () => {
    it('asks again after 30 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      answerJson(LIST_PATH, unreadNotifications)
      renderShell()

      await waitFor(() => {
        expect(requestsTo(LIST_PATH)).toHaveLength(1)
      })

      await act(async () => {
        vi.advanceTimersByTime(NOTIFICATION_POLL_INTERVAL_MS)
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(requestsTo(LIST_PATH)).toHaveLength(2)
      })
    })

    it('stops while the tab is hidden', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      answerJson(LIST_PATH, unreadNotifications)
      renderShell()

      await waitFor(() => {
        expect(requestsTo(LIST_PATH)).toHaveLength(1)
      })

      act(() => {
        setTabHidden(true)
      })

      await act(async () => {
        vi.advanceTimersByTime(NOTIFICATION_POLL_INTERVAL_MS * 3)
        await Promise.resolve()
      })

      // 아무도 보지 않는 화면을 위해 서버를 두드리는 일이다.
      expect(requestsTo(LIST_PATH)).toHaveLength(1)
    })

    it('asks straight away when the tab comes back, rather than waiting out the interval', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      answerJson(LIST_PATH, unreadNotifications)
      renderShell()

      await waitFor(() => {
        expect(requestsTo(LIST_PATH)).toHaveLength(1)
      })

      act(() => {
        setTabHidden(true)
      })
      act(() => {
        setTabHidden(false)
      })

      // 탭을 다시 여는 행위 자체가 「지금 확인하겠다」다.
      await waitFor(() => {
        expect(requestsTo(LIST_PATH)).toHaveLength(2)
      })
    })
  })

  describe('an account that cannot ask', () => {
    it('keeps the control in place and asks the API for nothing', async () => {
      const user = userEvent.setup()

      renderWithAuth(
        <SellerShell messages={layout}>
          <h1>대시보드</h1>
        </SellerShell>,
        { session: null },
      )

      // 계정 메뉴가 나타난 뒤에도 — 세션이 「없음」으로 결론난 뒤에도 — 종은 그 자리에
      // 있다. 나중에 생겨나는 컨트롤은 상단바의 오른쪽을 통째로 민다.
      await screen.findByRole('button', { name: messagesFor().auth.menu.label })
      await user.click(await findBell())

      expect(await screen.findByText(menu.unavailable)).toBeVisible()
      // 401 이 30초마다 되풀이되는 자리를 만들지 않는다.
      expect(requestsTo(LIST_PATH)).toHaveLength(0)
    })

    it('does not tear the console down when the session finally arrives', async () => {
      answerJson(LIST_PATH, unreadNotifications)
      renderShell()

      const heading = screen.getByRole('heading', { level: 1 })

      // 「못 묻는다」에서 「묻는다」로 넘어갈 때 엘리먼트의 **종류**가 바뀌면 리액트는
      // 그 아래 — 콘솔 전체 — 를 버리고 다시 만든다. 열린 팝오버가 닫히고 스크롤과
      // 포커스와 폼의 입력이 사라진다.
      await screen.findByRole('button', { name: menu.labelWithUnread.replace('{count}', '6') })

      expect(screen.getByRole('heading', { level: 1 })).toBe(heading)
    })
  })

  describe('a row with nowhere to go', () => {
    it('draws no link when the notification carries none (4.7)', async () => {
      const user = userEvent.setup()
      // 읽은 줄 하나뿐인 답. `unreadOnly` 를 무시하는 대역이라 드롭다운에 그대로 실린다.
      answerJson(LIST_PATH, {
        nextCursor: null,
        notifications: [
          {
            body: '신고해 주신 내용을 확인했습니다.',
            createdAt: '2026-09-02T02:00:00.000Z',
            id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f9003',
            link: null,
            readAt: null,
            title: READ_REPORT_TITLE,
            type: 'REPORT_HANDLED',
          },
        ],
        unreadCount: 1,
      })
      renderShell()

      await user.click(await findBell())

      const list = await screen.findByRole('list', { name: menu.listLabel })

      expect(within(list).getByText(READ_REPORT_TITLE)).toBeVisible()
      // 아무 데도 가지 않는 링크를 그리지 않는다.
      expect(within(list).queryByRole('link', { name: notifications.item.openLabel })).toBeNull()
    })
  })
})
