/**
 * axe 로 훑는 알림함, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면들은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴
 * 수 없고, TASK-0082 · TASK-0085 · TASK-0088 이 같은 벽에서 같은 엔진을 조립된 화면에
 * 돌렸다.
 *
 * **드롭다운이 열린 상태를 따로 잰다.** 팝오버는 `<body>` 로 포털되므로 닫힌 셸만
 * 재면 그 안의 목록·버튼·링크는 한 번도 검사되지 않는다. 그리고 그것이 이 기능에서
 * 접근성이 가장 깨지기 쉬운 자리다 — 이름 없는 아이콘 버튼, 이름 없는 다이얼로그,
 * 배지 안의 벌거벗은 숫자.
 */

import { DENSITY_LEVELS } from '@shopping/ui'
import { sessionSellerOwner } from '@shopping/api-mocks'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NotificationsPage from '@/app/notifications/page'
import { SellerShell } from '@/components/layout/seller-shell'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import { answerJson, resetApiStub, stubApiClient } from './support/api-stub'
import { notificationsPage1, unreadNotifications } from './support/notification-fixtures'
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

const copy = messages.notifications

const OPTIONS: RunOptions = {
  rules: {
    // jsdom 은 아무것도 칠하지 않으므로 axe 가 대비를 판단할 수 없다.
    'color-contrast': { enabled: false },
    // 문서의 껍데기 — lang · title — 는 `app/layout.tsx` 의 것이다.
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    // 콘솔의 `<main>` 은 셸의 것이고, 페이지만 그릴 때 그것은 이 트리에 없다.
    region: { enabled: false },
  },
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
}

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  answerJson('/me/notifications', notificationsPage1)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-density')
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the notification inbox', () => {
  it.each(Object.entries(VIEWPORTS))('has no axe violations at %s', async (_name, width) => {
    stubViewport(width)
    renderWithAuth(<NotificationsPage />)
    await screen.findByRole('list', { name: copy.page.listLabel })

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has no axe violations at density %s', async (level) => {
    document.documentElement.setAttribute('data-density', String(level))
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<NotificationsPage />)
    await screen.findByRole('list', { name: copy.page.listLabel })

    await expectNoViolations()
  })
})

describe('the notification bell', () => {
  it('has no axe violations with the panel open', async () => {
    const user = userEvent.setup()
    answerJson('/me/notifications', unreadNotifications)
    stubViewport(VIEWPORTS.desktop)

    renderWithAuth(
      <SellerShell messages={messages.layout}>
        <h1>대시보드</h1>
      </SellerShell>,
      { session: sessionSellerOwner },
    )

    await user.click(await screen.findByRole('button', { name: new RegExp(copy.menu.label) }))
    await screen.findByRole('list', { name: copy.menu.listLabel })

    await expectNoViolations()
  })

  it('keeps the badge number out of the accessibility tree and the count in the name', async () => {
    stubViewport(VIEWPORTS.desktop)
    answerJson('/me/notifications', unreadNotifications)

    renderWithAuth(
      <SellerShell messages={messages.layout}>
        <h1>대시보드</h1>
      </SellerShell>,
      { session: sessionSellerOwner },
    )

    // 보조 기술에게 「알림」 옆에 붙은 6은 아무 관계도 아니다. 이름이 그것을 말한다.
    const bell = await screen.findByRole('button', {
      name: copy.menu.labelWithUnread.replace('{count}', '6'),
    })

    // 종 안에서 트리 밖으로 빠진 것 둘 — 종 그림과 배지 — 가운데 숫자를 든 쪽.
    const decorations = [...bell.querySelectorAll('[aria-hidden="true"]')]

    expect(decorations.some((node) => node.textContent === '6')).toBe(true)
  })
})
