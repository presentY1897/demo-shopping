/**
 * The header's account menu (TASK-0023 F10 · P2 · P4).
 *
 * The slot it replaces was a popover saying "로그인과 계정 메뉴는 M04 에서 이
 * 자리에 들어옵니다", and it was a *working* control on purpose (TASK-0018 4.5).
 * That property is the one most easily lost here: the obvious implementation
 * disables the trigger while the session is unknown, which is a dead tab stop
 * on every page load.
 */

import { mockSession, sessionBuyer } from '@shopping/api-mocks'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it, vi } from 'vitest'

import { UserMenu } from '@/components/auth/user-menu'
import { AccountIcon } from '@/components/layout/icons'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'

const messages = messagesFor()
const menu = messages.auth.menu

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders' }))

function renderMenu(session: { readonly session?: MockSession } = {}) {
  return renderWithAuth(
    <UserMenu
      icon={<AccountIcon className="size-5" />}
      messages={menu}
      myPageLabel={messages.layout.account.mypage}
    />,
    session,
  )
}

describe('before the session is known', () => {
  it('is a control that can be pressed, not a disabled slot', () => {
    renderMenu()

    expect(screen.getByRole('button', { name: menu.label })).toBeEnabled()
  })
})

describe('signed out', () => {
  it('offers a way in that comes back to the page being read', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: menu.label }))

    expect(await screen.findByRole('link', { name: menu.signInLabel })).toHaveAttribute(
      'href',
      '/login?next=%2Fmypage%2Forders',
    )
  })
})

describe('signed in', () => {
  it('keeps the destination the header used to link to directly', async () => {
    const user = userEvent.setup()
    renderMenu({ session: sessionBuyer })

    await user.click(screen.getByRole('button', { name: menu.label }))

    expect(
      await screen.findByRole('link', { name: messages.layout.account.mypage }),
    ).toHaveAttribute('href', '/mypage')
  })

  it('names what the account can do in Korean, not in enum values', async () => {
    const user = userEvent.setup()
    renderMenu({ session: sessionBuyer })

    await user.click(screen.getByRole('button', { name: menu.label }))

    expect(await screen.findByText(new RegExp(menu.roleNames.BUYER ?? 'BUYER'))).toBeVisible()
    expect(screen.queryByText(/BUYER/)).toBeNull()
  })

  /**
   * Signing out is a request, not a local forget: the refresh token has a row in
   * the database and a cookie in the browser, and dropping the access token
   * alone would leave a session the next reload resurrects.
   */
  it('ends the session at the API, not just in this tab (F10)', async () => {
    const user = userEvent.setup()
    renderMenu({ session: sessionBuyer })

    await user.click(screen.getByRole('button', { name: menu.label }))
    await user.click(await screen.findByRole('button', { name: menu.signOutLabel }))

    await waitFor(() => {
      expect(mockSession()).toBeNull()
    })
    expect(await screen.findByText(menu.signedOutBody)).toBeVisible()
  })

  it('links the profile entry to the settings screen (TASK-0112)', async () => {
    const user = userEvent.setup()
    renderMenu({ session: sessionBuyer })

    await user.click(screen.getByRole('button', { name: menu.label }))

    // It was a blocked `GuardedButton` until the screen existed. The entry kept
    // its place through that so the menu would not change shape the day it
    // arrived; this asserts that it did arrive rather than that it is still
    // waiting.
    expect(await screen.findByRole('link', { name: menu.profileLabel })).toHaveAttribute(
      'href',
      '/mypage/settings',
    )
  })
})

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

describe('the account menu has no accessibility violations (P2)', () => {
  it.each([
    ['signed out', undefined],
    ['signed in', sessionBuyer],
  ])('%s, with the panel open', async (_name, session) => {
    const user = userEvent.setup()
    renderMenu(session === undefined ? {} : { session })

    await user.click(screen.getByRole('button', { name: menu.label }))
    await screen.findByRole('dialog')

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
