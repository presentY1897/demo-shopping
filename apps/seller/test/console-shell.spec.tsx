/**
 * This app's half of the console shell: its menu, its router, its slots.
 *
 * `packages/ui` already checks what the shell *does* — which form is mounted at
 * which width, where the focus goes, what the sub-route rule is. What can only
 * be checked here is that the menu handed to it is the one
 * `docs/design/pages.md` 2장 describes, that every entry leads to a route
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

import { sessionBuyer, sessionSellerApplicant, sessionSellerOwner } from '@shopping/api-mocks'
import { consoleMenuItems } from '@shopping/ui/console'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SellerShell } from '@/components/layout/seller-shell'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { stubViewport, VIEWPORTS } from './support/viewport'

const { auth, layout } = messagesFor()

const pathname = vi.hoisted(() => ({ current: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}))

function renderShell(currentPath: string, width: number = VIEWPORTS.desktop) {
  pathname.current = currentPath
  stubViewport(width)

  return renderWithAuth(
    <SellerShell messages={layout}>
      <h1>{currentPath}</h1>
    </SellerShell>,
    { session: sessionSellerOwner },
  )
}

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
    renderShell('/products/new')

    expect(screen.getByRole('link', { name: '상품 관리' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not offer a display-density control anywhere (D-033)', () => {
    renderShell('/')

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(document.querySelectorAll('[data-density]')).toHaveLength(0)
  })
})

describe('the notification slot', () => {
  it('says which milestone fills it, rather than being disabled', async () => {
    const user = userEvent.setup()
    renderShell('/')

    const trigger = screen.getByRole('button', { name: layout.notifications.label })

    expect(trigger).toBeEnabled()

    await user.click(trigger)

    expect(await screen.findByText(layout.notifications.body)).toBeVisible()
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
 * Whoever cannot enter the console gets the one screen they can use
 * (TASK-0109 4장).
 *
 * The permission filter above cannot do this and the assertion below says why:
 * a `BUYER` holds nearly every `*.read` the menu is gated on, so filtering an
 * applicant's sidebar by permission leaves eight links that all bounce off
 * `ConsoleGuard`. The question this filter asks is `mayEnterConsole` — the same
 * one the guard asks.
 */
describe('the sidebar before an application is approved', () => {
  const [entry] = consoleMenuItems(layout.onboardingMenu)

  it.each([
    ['applied, not yet approved', sessionSellerApplicant],
    ['never applied', sessionBuyer],
  ])('offers only 입점 신청 (%s)', async (_label, session) => {
    pathname.current = '/apply'
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(
      <SellerShell messages={layout}>
        <h1>{'/apply'}</h1>
      </SellerShell>,
      { session },
    )

    const nav = screen.getByRole('navigation', { name: layout.shell.navLabel })

    expect(await within(nav).findByRole('link', { name: entry?.label })).toHaveAttribute(
      'href',
      entry?.href,
    )
    // Every console destination is gone, not merely reordered. The brand link
    // at the top of the sidebar is the shell's own and stays.
    await waitFor(() => {
      for (const item of consoleMenuItems(layout.menu)) {
        expect(within(nav).queryByRole('link', { name: item.label })).not.toBeInTheDocument()
      }
    })
  })

  it('leaves the full menu for an approved seller', async () => {
    renderShell('/')

    const nav = screen.getByRole('navigation', { name: layout.shell.navLabel })

    await waitFor(() => {
      expect(within(nav).queryByRole('link', { name: entry?.label })).not.toBeInTheDocument()
    })
    for (const item of consoleMenuItems(layout.menu)) {
      expect(within(nav).getByRole('link', { name: item.label })).toBeVisible()
    }
  })
})
