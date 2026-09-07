/**
 * 알림함 (TASK-0090 F2 · F3 · F4 · F7 · F8).
 *
 * **API 대역은 `test/support/community.ts` 다** — `@shopping/api-mocks` 에 이 라우트의
 * 핸들러가 아직 없다. 읽음 처리의 본문도 `readNotificationsRequestSchema` 로 읽힌다.
 *
 * **이 파일이 확인하는 것 다섯으로 줄이면**:
 *
 * ① **배지의 수는 서버가 센 것이다** (F3). 목록의 길이를 세면 다섯 개만 받는 헤더가
 *    「미읽음 5」에서 멈춘다.
 * ② **개별·전체 읽음이 계약 하나로 간다** (F4). id 를 주지 않으면 전부다.
 * ③ **판매자·관리자 알림은 그리지 않는다** (F7). 한 계정이 두 역할을 가질 수 있다.
 * ④ **숨은 탭에서는 묻지 않는다** (R1), **돌아오면 즉시 한 번 묻는다** (F8).
 * ⑤ **링크는 앱 안의 경로 그대로다.** 도메인을 붙이지 않는다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionResponse } from '@shopping/shared'

import { NotificationScreen } from '@/components/notifications/notification-screen'
import { ShopHeader } from '@/components/layout/shop-header'
import { NOTIFICATION_POLL_MS } from '@/lib/notifications/polling'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import { resetCommunityStores, stubCommunityApi } from './support/community'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const messages = messagesFor()
const menu = messages.layout.notifications
const page = messages.mypage.notifications

let stub: CommunityApiStub

/** 헤더는 밀도 컨텍스트 안에 있다 — 셸 전체가 그 안에 들어간다 (`app/layout.tsx`). */
function renderHeader(session: SessionResponse | null) {
  return renderWithAuth(
    <DensityProvider>
      <ShopHeader brand={messages.app.name} messages={messages.layout} />
    </DensityProvider>,
    { session },
  )
}

/** `document.visibilityState` 는 읽기 전용이라 대신 정의한다. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** 헤더가 알림을 묻는 요청만. 폴링이 실제로 돌았는지는 이것만이 답한다. */
function polls(): readonly unknown[] {
  return stub.requests.filter(
    (one) => one.method === 'GET' && one.url.pathname.endsWith('/me/notifications'),
  )
}

beforeEach(() => {
  localStorage.clear()
  resetDensity()
  resetCommunityStores()
  stubViewport(VIEWPORTS.desktop)
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.useRealTimers()
  setVisibility('visible')
  vi.unstubAllGlobals()
})

describe('F3 헤더의 배지', () => {
  it('carries the unread count inside the control’s own name', async () => {
    renderHeader(sessionBuyer)

    // 아이콘 옆의 작은 수를 따로 읽어 주면 「알림 3」이 아니라 「알림」 「3」 두
    // 덩어리로 들린다. 그래서 수는 이름 안에 있다.
    expect(
      await screen.findByRole('button', { name: menu.labelWithCount.replace('{count}', '3') }),
    ).toBeVisible()
  })

  it('is not there at all for a visitor, who would only ever get a 401', async () => {
    renderHeader(null)

    await screen.findByRole('button', { name: messages.auth.menu.label })

    expect(screen.queryByRole('button', { name: menu.label })).toBeNull()
    expect(polls()).toEqual([])
  })
})

describe('F2 · F4 · F7 드롭다운', () => {
  async function openMenu(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()

    renderHeader(sessionBuyer)

    await user.click(
      await screen.findByRole('button', { name: menu.labelWithCount.replace('{count}', '3') }),
    )

    return user
  }

  it('draws the shop’s own notifications and leaves the consoles’ out (F7)', async () => {
    await openMenu()

    const list = await screen.findByRole('list', { name: menu.listLabel })

    // 한 계정이 두 역할을 가질 수 있다 — 판매자도 물건을 산다. 상점이 「정산이
    // 지급되었습니다」를 그리면 그 링크는 상점에 없는 화면을 가리킨다.
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).queryByText('정산이 지급되었습니다')).toBeNull()
  })

  it('uses the link as an app path, with no domain in front of it (F2)', async () => {
    await openMenu()

    const list = await screen.findByRole('list', { name: menu.listLabel })

    expect(within(list).getByRole('link', { name: /주문이 발송되었습니다/ })).toHaveAttribute(
      'href',
      '/mypage/orders/019596d0-1f1c-7c2e-9a0e-620000000001',
    )
  })

  it('marks one read when it is opened, and keeps the row where it was (F4)', async () => {
    const user = await openMenu()
    const list = await screen.findByRole('list', { name: menu.listLabel })

    await user.click(within(list).getByRole('link', { name: /주문이 발송되었습니다/ }))

    await waitFor(() => {
      expect(stub.writes).toEqual([{ ids: ['019596d0-1f1c-7c2e-9a0e-720000000001'] }])
    })
  })

  it('marks everything read with no ids at all (F4)', async () => {
    const user = await openMenu()

    await screen.findByRole('list', { name: menu.listLabel })
    await user.click(screen.getByRole('button', { name: menu.readAllLabel }))

    // 「개별」과 「전체」를 두 라우트로 나누면 전체 읽음이 화면에 보이는 것만 읽는지
    // 정말 전부인지 이름이 말해 주지 않는다.
    await waitFor(() => {
      expect(stub.writes).toEqual([{}])
    })
    expect(stub.state.notifications.every((one) => one.readAt !== null)).toBe(true)
  })
})

describe('F8 · R1 폴링', () => {
  it('asks again after thirty seconds while the tab is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderHeader(sessionBuyer)

    await vi.waitFor(() => {
      expect(polls()).toHaveLength(1)
    })

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS)

    await vi.waitFor(() => {
      expect(polls()).toHaveLength(2)
    })
  })

  it('stops in a background tab and asks once on the way back (R1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    renderHeader(sessionBuyer)

    await vi.waitFor(() => {
      expect(polls()).toHaveLength(1)
    })

    // `act` 로 감싸는 이유는 **간격을 지우는 것이 렌더의 결과**이기 때문이다.
    // 이벤트만 쏘고 곧장 시계를 돌리면, 아직 살아 있는 타이머가 한 번 더 묻는다.
    act(() => {
      setVisibility('hidden')
    })
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS * 3)

    // 보이지 않는 탭의 배지는 아무도 보지 않는다. 탭 스무 개에 30초마다 스무 번의
    // 요청은 무료 요금제 API 가 감당할 이유가 없는 부하다.
    expect(polls()).toHaveLength(1)

    act(() => {
      setVisibility('visible')
    })

    // 돌아온 순간 한 번 더 묻는다. 없으면 최대 30초 동안 옛 배지를 본다.
    await vi.waitFor(() => {
      expect(polls()).toHaveLength(2)
    })
  })
})

describe('알림함 페이지', () => {
  it('shows the account’s unread count rather than the length of the list', async () => {
    renderAccountScreen(<NotificationScreen messages={messages.mypage} />, {
      session: sessionBuyer,
    })

    const list = await screen.findByRole('list', { name: page.listLabel })

    // 계약이 필터와 무관한 수를 함께 보낸다. 목록을 세면 판매자 알림을 걸러 낸 만큼
    // 어긋난다.
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(page.unreadCount.replace('{count}', '3'))).toBeVisible()
  })

  it('marks one read from the list itself', async () => {
    const user = userEvent.setup()

    renderAccountScreen(<NotificationScreen messages={messages.mypage} />, {
      session: sessionBuyer,
    })

    await screen.findByRole('list', { name: page.listLabel })
    await user.click(
      screen.getByRole('button', {
        name: page.readLabel.replace('{title}', '문의에 답변이 달렸습니다'),
      }),
    )

    await waitFor(() => {
      expect(stub.writes).toEqual([{ ids: ['019596d0-1f1c-7c2e-9a0e-720000000002'] }])
    })
    expect(screen.getAllByText(page.unreadBadge)).toHaveLength(1)
  })
})
