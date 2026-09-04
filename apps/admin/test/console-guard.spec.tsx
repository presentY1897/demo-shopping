/**
 * The console's front door (TASK-0023 F1 · F2 · F3 · F7 · P2).
 *
 * **What replaced the middleware, and why it had to.** The approved design read
 * the refresh cookie in `middleware.ts`. That cookie is set by the *API* origin
 * with no `Domain` and `Path=/api/v1/auth`, so it is never attached to a request
 * for one of this app's routes — there is nothing to read. The guard is
 * therefore a decision made after the boot renewal, and these are the four
 * outcomes it can reach.
 *
 * The redirect is asserted through a mocked `useRouter`, because a real one
 * would need a Next app router; what is under test is the *decision*, and the
 * decision is what the mock records.
 */

import { sessionAdminSuper, sessionBuyer } from '@shopping/api-mocks'
import { screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleGuard } from '@/components/auth/console-guard'
import { NoPermissionScreen } from '@/components/auth/no-permission-screen'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'

const auth = messagesFor().auth

const navigation = vi.hoisted(() => ({ pathname: '/', replace: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
}))

const CONSOLE_CONTENT = '주문 관리 화면'

function renderGuard(pathname: string, session: MockSession = sessionAdminSuper) {
  navigation.pathname = pathname

  return renderWithAuth(
    <ConsoleGuard messages={auth.guard}>
      <p>{CONSOLE_CONTENT}</p>
    </ConsoleGuard>,
    { session },
  )
}

beforeEach(() => {
  navigation.replace.mockClear()
})

describe('a visitor who is not signed in (F1 · F2)', () => {
  it('is sent to the sign-in page, carrying the path they asked for', async () => {
    renderGuard('/orders/3', null)

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('/login?next=%2Forders%2F3')
    })
  })

  it('is never shown the console, not even for a frame', () => {
    renderGuard('/orders', null)

    expect(screen.queryByText(CONSOLE_CONTENT)).toBeNull()
  })
})

describe('an account without the role (F3 · F7)', () => {
  it('is sent to the refusal screen rather than to sign in again', async () => {
    renderGuard('/orders', sessionBuyer)

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('/no-permission')
    })
  })

  it('is not shown the console while that happens', () => {
    renderGuard('/orders', sessionBuyer)

    expect(screen.queryByText(CONSOLE_CONTENT)).toBeNull()
  })
})

describe('an account that may enter', () => {
  it('gets the console, and no redirect', async () => {
    renderGuard('/orders')

    expect(await screen.findByText(CONSOLE_CONTENT)).toBeVisible()
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})

describe('while the session is still unknown (P5)', () => {
  /**
   * The state that is neither of the two decisions. Rendering the console here
   * would show it to somebody who may turn out not to be allowed; redirecting
   * here would bounce an operator on every reload.
   */
  it('shows a waiting state and decides nothing', () => {
    renderGuard('/orders')

    expect(screen.getByRole('status')).toHaveAttribute('aria-label', auth.guard.checkingLabel)
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})

describe('routes outside the guard', () => {
  it.each(['/login', '/no-permission'])('lets %s through without a session', (pathname) => {
    renderGuard(pathname, null)

    expect(screen.getByText(CONSOLE_CONTENT)).toBeVisible()
    expect(navigation.replace).not.toHaveBeenCalled()
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

describe('the refusal screen (F7 · P2)', () => {
  it('says one thing, and does not guess at an application state', async () => {
    renderWithAuth(<NoPermissionScreen messages={auth} />, { session: sessionBuyer })

    expect(await screen.findByText(auth.guard.title)).toBeVisible()
    expect(screen.getByText(auth.guard.pendingNote)).toBeVisible()
  })

  it('offers both ways out — another account, or none', async () => {
    renderWithAuth(<NoPermissionScreen messages={auth} />, { session: sessionBuyer })

    expect(screen.getByRole('link', { name: auth.guard.signInLabel })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(await screen.findByRole('button', { name: auth.guard.signOutLabel })).toBeVisible()
  })

  it('has no accessibility violations', async () => {
    renderWithAuth(<NoPermissionScreen messages={auth} />, { session: sessionBuyer })
    await screen.findByRole('button', { name: auth.guard.signOutLabel })

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
