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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SellerShell } from '@/components/layout/seller-shell'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import { answerJson, resetApiStub, stubApiClient } from './support/api-stub'
import { unreadNotifications } from './support/notification-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

/**
 * The top bar now calls the API (TASK-0090).
 *
 * `@shopping/api-mocks` has no handler for `/me/notifications` yet and this
 * branch does not own `packages/`, so the bell is served by the same stub the
 * notification specs use (`support/api-stub.ts`). Without it the shell's own
 * request reaches no handler and the whole file fails — which is what happened
 * the moment the reserved slot became a real control.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const { auth, layout, notifications } = messagesFor()

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

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  answerJson('/me/notifications', unreadNotifications)
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
    // A menu entry pointing at a 404 is invisible until someone clicks. Until
    // M13 the answer could be a placeholder screen (TASK-0019 4.10); the last
    // one went away with `/questions`, so every entry below now leads to a
    // screen that does its job. The filesystem is the router here, so the
    // filesystem is what is asked.
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
  /**
   * The slot TASK-0019 reserved is filled (TASK-0090).
   *
   * What is checked here is the **seam** — that the shell puts a working
   * notification control in its top bar and that the copy comes from the
   * `notifications` slice rather than from `layout`. What the control *does* —
   * the badge, the unread list, the 30s poll — is `notification-menu.spec.tsx`.
   */
  it('holds a real notification control now, not a "M11 fills this" popover', async () => {
    const user = userEvent.setup()
    renderShell('/')

    const trigger = await screen.findByRole('button', {
      name: new RegExp(notifications.menu.label),
    })

    expect(trigger).toBeEnabled()

    await user.click(trigger)

    expect(await screen.findByRole('link', { name: notifications.menu.seeAllLabel })).toBeVisible()
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
