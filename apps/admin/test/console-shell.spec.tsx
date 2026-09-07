/**
 * This app's half of the console shell: its menu, its router, its slots.
 *
 * `packages/ui` already checks what the shell *does* — which form is mounted at
 * which width, where the focus goes, what the sub-route rule is. What can only
 * be checked here is that the menu handed to it is the one
 * `docs/design/pages.md` 3장 describes, that every entry leads to a route
 * this app actually has, and that the two reserved slots are controls rather
 * than dead ends.
 *
 * `usePathname` is the one thing mocked. There is no router in a unit test, and
 * the pathname is exactly the input the highlight rule takes.
 *
 * The shell reads the session since TASK-0023 — the account slot is a real menu
 * and the sidebar is filtered by permission — so it is rendered inside a
 * provider seeded with the role that opens this console.
 */

import { sessionAdminSuper } from '@shopping/api-mocks'
import { consoleMenuItems } from '@shopping/ui/console'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminShell } from '@/components/layout/admin-shell'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { notification, notificationList } from './support/notifications'
import { stubViewport, VIEWPORTS } from './support/viewport'

const { auth, layout, notifications } = messagesFor()

const pathname = vi.hoisted(() => ({ current: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}))

/**
 * 상단바의 종은 이제 진짜 알림함이라 API 를 부른다 (TASK-0090).
 *
 * `packages/api-mocks` 에 `/me/notifications` 의 대역이 없고 이 TASK 는 `apps/admin`
 * 밖을 고치지 않으므로, 이 스펙에서는 `lib/notifications/console-api` 를 대신 세운다
 * — 이 파일이 재는 것은 메뉴와 슬롯이지 알림함이 아니다 (그쪽은
 * `test/notifications.spec.tsx`).
 */
const notificationApi = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
  readNotifications: vi.fn(),
}))

vi.mock('@/lib/notifications/console-api', () => notificationApi)

function renderShell(currentPath: string, width: number = VIEWPORTS.desktop) {
  pathname.current = currentPath
  stubViewport(width)

  return renderWithAuth(
    <AdminShell messages={layout}>
      <h1>{currentPath}</h1>
    </AdminShell>,
    { session: sessionAdminSuper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // 종은 셸의 일부라 **모든** 렌더에서 한 번 묻는다. 답을 주지 않으면 그 훅이
  // 해석되지 않은 값을 상태에 앉히고, 메뉴를 재는 검사들이 알림함 때문에 깨진다.
  notificationApi.fetchNotifications.mockResolvedValue(notificationList([]))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the menu', () => {
  it('carries every entry from the route table, in order', () => {
    renderShell('/')

    const nav = screen.getByRole('navigation', { name: layout.shell.navLabel })

    for (const item of consoleMenuItems(layout.menu)) {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.href)
    }
  })

  it('leads to a route this app has', () => {
    // A menu entry pointing at a 404 is the defect the placeholder screens
    // exist to prevent (TASK-0019 4.10), and it is invisible until someone
    // clicks. The filesystem is the router here, so the filesystem is what is
    // asked.
    for (const item of consoleMenuItems(layout.menu)) {
      const segment = item.href === '/' ? '' : item.href
      expect(existsSync(join(import.meta.dirname, '..', 'src', 'app', segment, 'page.tsx'))).toBe(
        true,
      )
    }
  })

  it('marks the section a sub-route belongs to', () => {
    renderShell('/categories')

    expect(screen.getByRole('link', { name: '카테고리 관리' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('does not offer a display-density control anywhere (D-033)', () => {
    renderShell('/')

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(document.querySelectorAll('[data-density]')).toHaveLength(0)
  })
})

describe('the notification slot', () => {
  it('opens the inbox rather than being a dead control', async () => {
    notificationApi.fetchNotifications.mockResolvedValue(
      notificationList([notification()], { unreadCount: 1 }),
    )

    const user = userEvent.setup()
    renderShell('/')

    const trigger = await screen.findByRole('button', {
      name: notifications.slot.labelWithCount.replace('{count}', '1'),
    })

    expect(trigger).toBeEnabled()

    await user.click(trigger)

    expect(await screen.findByRole('link', { name: notifications.viewAll })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })
})

describe('the account menu', () => {
  it('is a working control before the session is even known', () => {
    renderShell('/')

    expect(screen.getByRole('button', { name: auth.menu.label })).toBeEnabled()
  })

  it('names the roles the account holds and offers a way out', async () => {
    const user = userEvent.setup()
    renderShell('/')

    await user.click(screen.getByRole('button', { name: auth.menu.label }))

    expect(await screen.findByText(new RegExp(auth.menu.rolesLabel))).toBeVisible()
    expect(screen.getByRole('button', { name: auth.menu.signOutLabel })).toBeVisible()
  })

  /**
   * Profile editing is TASK-0112. It is shown blocked rather than hidden, and
   * `aria-disabled` rather than `disabled` — a control the keyboard cannot reach
   * cannot tell anybody why it is there.
   */
  it('shows the profile entry blocked, with the reason, still reachable', async () => {
    const user = userEvent.setup()
    renderShell('/')

    await user.click(screen.getByRole('button', { name: auth.menu.label }))

    const profile = await screen.findByRole('button', { name: auth.menu.profileLabel })

    expect(profile).toHaveAttribute('aria-disabled', 'true')
    expect(profile).toHaveAccessibleDescription(auth.menu.profileReason)
  })
})

/**
 * The rule set `categories-a11y.spec.tsx` uses, minus the two exclusions that
 * only make sense for a screen rendered without its shell. Here the shell *is*
 * the subject, so `region` and `landmark-one-main` are switched back on: a
 * console whose sidebar is not in a landmark, or whose content is not in
 * `<main>`, is exactly the defect worth catching.
 */
const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast. `packages/ui`
    // converts the OKLCH palette and fails below 4.5:1 over more pairs than a
    // screen would exercise.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`, which is
    // not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, A11Y)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the shell has no accessibility violations', () => {
  it('with the sidebar column open', async () => {
    renderShell('/categories')

    await expectNoViolations()
  })

  it('with the sidebar collapsed', async () => {
    const user = userEvent.setup()
    renderShell('/categories')

    await user.click(screen.getByRole('button', { name: layout.shell.collapseSidebar }))

    await expectNoViolations()
  })

  it('with the sheet open on a phone', async () => {
    const user = userEvent.setup()
    renderShell('/categories', VIEWPORTS.mobile)

    await user.click(screen.getByRole('button', { name: layout.shell.openNav }))
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it('with a top-bar slot open', async () => {
    const user = userEvent.setup()
    renderShell('/categories')

    await user.click(screen.getByRole('button', { name: auth.menu.label }))
    await screen.findByRole('button', { name: auth.menu.signOutLabel })

    await expectNoViolations()
  })
})
