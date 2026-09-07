/**
 * 알림함 — 상단바의 종과 `/notifications` (TASK-0090).
 *
 * 재는 것은 배지가 **읽히는가**(F3), 링크가 계약이 준 경로 그대로인가(F2), 누르면
 * 읽음으로 넘어가는가(F4), 그리고 **30초마다 다시 묻되 탭이 가려지면 멈추는가**
 * (F8 · R1)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/me/notifications` 의 대역이 아직 없고, 이 TASK 는
 * `apps/admin` 밖을 고치지 않는다. 그래서 `lib/notifications/console-api` 를 대신
 * 세운다 — 경로와 스키마가 그 한 파일에 모여 있는 것이 이것을 가능하게 하고, 답은
 * 여전히 계약 스키마를 지난 값이다(`support/notifications.ts`).
 *
 * ## 시계가 가짜다
 *
 * 폴링을 재려면 30초를 기다릴 수 없다. `shouldAdvanceTime` 을 켠 이유는 세션 부팅과
 * msw 가 여전히 진짜 시간 위에서 끝나야 하기 때문이다 (`apps/shop` 의 자동 확정
 * 검사와 같은 설정).
 */

import { sessionAdminSuper } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationSlot } from '@/components/notifications/notification-slot'
import { BellIcon } from '@/components/layout/console-icons'
import { NOTIFICATION_POLL_MS } from '@/lib/notifications/notification-console'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { notification, notificationList } from './support/notifications'

const api = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
  readNotifications: vi.fn(),
}))

vi.mock('@/lib/notifications/console-api', () => api)

const { notifications: copy } = messagesFor()

/** 종 하나. 셸 없이 슬롯만 세운다 — 재는 것은 메뉴가 아니라 알림함이다. */
function renderSlot(session: MockSession = sessionAdminSuper) {
  return renderWithAuth(
    <NotificationSlot icon={<BellIcon className="size-5" />} messages={copy} />,
    { session },
  )
}

/** 종을 눌러 드롭다운을 연다. 이름에는 안 읽은 수가 들어 있다. */
async function openBell(user: UserEvent, unreadCount: number): Promise<HTMLElement> {
  await user.click(
    await screen.findByRole('button', {
      name:
        unreadCount === 0
          ? copy.slot.label
          : copy.slot.labelWithCount.replace('{count}', String(unreadCount)),
    }),
  )

  return screen.findByRole('dialog')
}

/** `/notifications` 를 연다. */
async function openPage(session: MockSession = sessionAdminSuper): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: NotificationsPage } = await import('@/app/notifications/page')

  renderWithAuth(<NotificationsPage />, { session })
  await screen.findByRole('list', { name: copy.listLabel })

  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api.fetchNotifications.mockResolvedValue(notificationList([notification()]))
  api.readNotifications.mockResolvedValue({ unreadCount: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('상단바의 종 (F3)', () => {
  /**
   * 종 위의 작은 원은 그림이라 읽히지 않는다. 숫자가 **이름에도** 있어야 화면을 볼 수
   * 없는 사람이 「할 일이 세 개」를 안다.
   */
  it('puts the unread count in the control’s name, not only in the badge', async () => {
    api.fetchNotifications.mockResolvedValue(
      notificationList([notification(), notification(), notification()]),
    )

    renderSlot()

    expect(
      await screen.findByRole('button', {
        name: copy.slot.labelWithCount.replace('{count}', '3'),
      }),
    ).toBeVisible()
  })

  /** 늘 켜져 있는 배지는 아무것도 알리지 않는다. */
  it('wears no badge when there is nothing to do', async () => {
    api.fetchNotifications.mockResolvedValue(notificationList([]))

    renderSlot()

    expect(await screen.findByRole('button', { name: copy.slot.label })).toBeVisible()
  })

  /** 헤더는 `limit=5&unreadOnly=true` 한 번으로 목록과 배지를 함께 얻는다 (4.5). */
  it('asks for the five unread the dropdown can show, and nothing else', async () => {
    renderSlot()

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenCalledWith(
        { unreadOnly: true, limit: 5 },
        expect.anything(),
      )
    })
  })

  it('leads to the whole inbox', async () => {
    const user = userEvent.setup()

    renderSlot()

    const dropdown = await openBell(user, 1)

    expect(within(dropdown).getByRole('link', { name: copy.viewAll })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })

  /** 로그인 전에 물으면 답은 401 이고, 그것이 30초마다 되풀이된다. */
  it('asks nothing at all before anybody is signed in, and stays a working control', async () => {
    const user = userEvent.setup()

    renderSlot(null)

    const dropdown = await openBell(user, 0)

    expect(within(dropdown).getByText(copy.signedOut)).toBeVisible()
    expect(api.fetchNotifications).not.toHaveBeenCalled()
  })

  it('offers a retry when the inbox did not arrive', async () => {
    api.fetchNotifications.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'network down' }),
    )

    const user = userEvent.setup()

    renderSlot()

    const dropdown = await openBell(user, 0)

    await user.click(within(dropdown).getByRole('button', { name: copy.retryLabel }))

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenCalledTimes(2)
    })
  })
})

describe('폴링 (F8 · R1)', () => {
  it('asks again thirty seconds later', async () => {
    renderSlot()

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenCalledTimes(1)
    })

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS)

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * 안 보는 화면을 위해 30초마다 두드리면 콘솔을 열어 둔 탭 하나가 하루에 2,880번을
   * 묻는다 — 그리고 이 저장소의 API 는 잠들었다 깨는 무료 인스턴스 위에 있다.
   */
  it('stops asking while the tab is hidden, and starts again when it comes back', async () => {
    renderSlot()

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenCalledTimes(1)
    })

    hide(true)
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS * 3)

    expect(api.fetchNotifications).toHaveBeenCalledTimes(1)

    hide(false)
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS)

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * 폴링은 **조용해야** 한다. 30초마다 뼈대로 되돌아가는 드롭다운은 읽을 수 없고,
   * 열려 있는 목록이 그 순간 비면 누르려던 줄이 손 밑에서 사라진다.
   */
  it('never blanks the list it is refreshing', async () => {
    const user = userEvent.setup()

    renderSlot()

    const dropdown = await openBell(user, 1)

    expect(within(dropdown).getByText('입점 신청이 들어왔어요')).toBeVisible()

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS)

    expect(within(dropdown).getByText('입점 신청이 들어왔어요')).toBeVisible()
    expect(within(dropdown).queryByRole('status', { name: copy.loadingLabel })).toBeNull()
  })
})

describe('읽음 (F2 · F4)', () => {
  /**
   * 계약의 `link` 는 앱 안의 경로다. 앞에 무엇을 붙이는 순간 그것은 이 콘솔이 지어낸
   * 주소가 되고, 도메인을 옮기는 날 지난 알림이 전부 남의 사이트를 가리킨다.
   */
  it('uses the contract’s path as it stands, and reads the notification on the way', async () => {
    const user = userEvent.setup()
    const row = notification({ link: '/sellers' })

    api.fetchNotifications.mockResolvedValue(notificationList([row]))
    renderSlot()

    const dropdown = await openBell(user, 1)
    const link = within(dropdown).getByRole('link', { name: row.title })

    expect(link).toHaveAttribute('href', '/sellers')

    await user.click(link)

    await waitFor(() => {
      expect(api.readNotifications).toHaveBeenCalledWith([row.id])
    })
  })

  /** 신고 처리 알림에는 갈 곳이 없다. 누를 수 없는 링크를 섞어 두지 않는다. */
  it('says so rather than drawing a link that goes nowhere', async () => {
    const user = userEvent.setup()

    api.fetchNotifications.mockResolvedValue(
      notificationList([
        notification({ type: 'REPORT_HANDLED', title: '신고가 처리됐어요', link: null }),
      ]),
    )
    renderSlot()

    const dropdown = await openBell(user, 1)

    expect(within(dropdown).getByText(copy.noLink)).toBeVisible()
    expect(within(dropdown).queryByRole('link', { name: '신고가 처리됐어요' })).toBeNull()
  })

  /** id 를 주지 않으면 전부다. 계약이 나누지 않은 것을 화면이 나누지 않는다. */
  it('reads everything with a request that names nothing', async () => {
    const user = userEvent.setup()

    renderSlot()

    const dropdown = await openBell(user, 1)

    await user.click(within(dropdown).getByRole('button', { name: copy.allReadLabel }))

    await waitFor(() => {
      // 인자가 `undefined` 다 — 「어느 것」을 고르지 않았다는 뜻이고, 계약은 그것을
      // 「전부」로 읽는다 (`readNotificationsRequestSchema`).
      expect(api.readNotifications).toHaveBeenCalledWith(undefined)
    })
  })
})

describe('/notifications', () => {
  it('draws every notification, read or not', async () => {
    api.fetchNotifications.mockResolvedValue(
      notificationList([notification(), notification({ readAt: '2026-09-06T02:00:00.000Z' })]),
    )

    await openPage()

    const list = screen.getByRole('list', { name: copy.listLabel })

    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getAllByText(copy.unreadLabel)).toHaveLength(1)
    expect(screen.getByText(copy.unreadCount.replace('{count}', '1'))).toBeVisible()
  })

  it('narrows to the unread on request, without sending a false flag when it is off', async () => {
    const user = await openPage()

    expect(api.fetchNotifications).toHaveBeenLastCalledWith({}, expect.anything())

    await user.click(screen.getByRole('switch', { name: new RegExp(`^${copy.unreadOnlyLabel}`) }))

    await waitFor(() => {
      expect(api.fetchNotifications).toHaveBeenLastCalledWith(
        { unreadOnly: true },
        expect.anything(),
      )
    })
  })

  it('tells an empty inbox apart from an inbox with nothing unread in it', async () => {
    api.fetchNotifications.mockResolvedValue(notificationList([]))

    const user = userEvent.setup()
    const { default: NotificationsPage } = await import('@/app/notifications/page')

    renderWithAuth(<NotificationsPage />, { session: sessionAdminSuper })

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()

    await user.click(screen.getByRole('switch', { name: new RegExp(`^${copy.unreadOnlyLabel}`) }))

    expect(await screen.findByText(copy.unreadEmptyTitle)).toBeVisible()
  })

  /** 이 화면은 폴링하지 않는다 — 30초 폴링은 상단바의 배지를 위한 것이다. */
  it('does not refetch on a timer', async () => {
    await openPage()

    expect(api.fetchNotifications).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS * 2)

    expect(api.fetchNotifications).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to read when there is nothing unread', async () => {
    api.fetchNotifications.mockResolvedValue(
      notificationList([notification({ readAt: '2026-09-06T02:00:00.000Z' })]),
    )

    await openPage()

    expect(screen.getByRole('button', { name: copy.allReadLabel })).toBeDisabled()
  })
})

/** 탭을 가리거나 되돌린다. jsdom 의 `document.hidden` 은 읽기 전용이라 바꿔 끼운다. */
function hide(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

describe('접근성 (P2)', () => {
  it('has no violations on the inbox page', async () => {
    api.fetchNotifications.mockResolvedValue(
      notificationList([notification(), notification({ readAt: '2026-09-06T02:00:00.000Z' })]),
    )

    await openPage()

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
