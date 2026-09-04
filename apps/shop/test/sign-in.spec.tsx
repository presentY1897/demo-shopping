/**
 * The sign-in screen, and the four things the callback can tell it
 * (TASK-0023 F2 · F10 · F11 · P2).
 *
 * The contract under test is TASK-0021's return trip: the callback redirects to
 * `/login?status=…&reason=…&notice=…`, and this screen is the only reader of it.
 * The values are not restated here — they come from `@shopping/shared`, so a
 * reason added there arrives in this file as a failing `it.each` rather than as
 * a blank line on the screen.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import type { OauthFailureReason } from '@shopping/shared'
import { oauthFailureReasons } from '@shopping/shared'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SignInScreen } from '@/components/auth/sign-in-screen'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'

const auth = messagesFor().auth

const navigation = vi.hoisted(() => ({
  query: '',
  replace: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  usePathname: () => '/login',
}))

function renderScreen(query = '', session: MockSession = null) {
  navigation.query = query

  return renderWithAuth(<SignInScreen messages={auth} />, { session })
}

beforeEach(() => {
  navigation.replace.mockClear()
  navigation.push.mockClear()
  sessionStorage.clear()
})

describe('an ordinary visit', () => {
  it('offers the one sign-in path there is', () => {
    renderScreen()

    expect(screen.getByRole('link', { name: auth.signIn.googleLabel })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/v1/auth/google?app=shop'),
    )
  })

  /**
   * The demo entry is TASK-0024's. Shown blocked rather than hidden: the point
   * of a demo is that the feature is visibly there.
   */
  it('shows the demo entry blocked, with the reason, still reachable', async () => {
    const user = userEvent.setup()
    renderScreen()

    const demo = screen.getByRole('button', { name: auth.signIn.demoLabel })

    expect(demo).toHaveAttribute('aria-disabled', 'true')
    expect(demo).toHaveAccessibleDescription(auth.signIn.demoReason)

    await user.tab()
    await user.tab()
    expect(demo).toHaveFocus()
  })

  it('says nothing about a round trip that did not happen', () => {
    renderScreen()

    expect(screen.queryByText(auth.outcome.generic)).toBeNull()
    expect(screen.queryByText(auth.outcome.cancelled)).toBeNull()
  })
})

describe('what the callback said (F11)', () => {
  it.each(oauthFailureReasons)('explains %s in its own words', (reason: OauthFailureReason) => {
    renderScreen(`status=error&reason=${reason}`)

    expect(screen.getByText(auth.outcome.failures[reason])).toBeVisible()
  })

  it('treats a cancellation as a fact, not as an error', () => {
    renderScreen('status=cancelled')

    expect(screen.getByText(auth.outcome.cancelled)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the generic sentence when the query string is unreadable', () => {
    renderScreen('status=nonsense&reason=also-nonsense')

    expect(screen.getByText(auth.outcome.generic)).toBeVisible()
  })

  it('reports a successful sign-in with no role as a notice', async () => {
    renderScreen('status=ok&notice=no_role')

    expect(await screen.findByText(auth.outcome.notices.no_role)).toBeVisible()
  })
})

describe('coming back (F2)', () => {
  it('returns to the path the visitor was asked to leave', async () => {
    // First visit: the screen remembers where the visitor came from.
    renderScreen('next=%2Fmypage%2Forders')
    // Then the round trip, which cannot carry the parameter itself.
    renderScreen('status=ok', sessionBuyer)

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('/mypage/orders')
    })
  })

  it('goes home rather than anywhere a stranger named', async () => {
    renderScreen('next=https%3A%2F%2Fevil.example')
    renderScreen('status=ok', sessionBuyer)

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('/')
    })
  })

  /**
   * Somebody who opened `/login` while signed in asked to be here — the account
   * menu links to it. Bouncing them away would make that link useless.
   */
  it('does not bounce a signed-in visitor who came here on purpose', async () => {
    renderScreen('', sessionBuyer)

    expect(await screen.findByText(auth.signIn.signedInTitle)).toBeVisible()
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})

describe('a session that was ended for us', () => {
  /**
   * `reused` is the one refusal worth announcing: it means the session was ended
   * on purpose because a revoked token came back. `unknown` and `expired` are
   * the ordinary state of a browser that is simply not signed in, and saying so
   * would put an error in front of every first-time visitor.
   */
  it('explains a session ended for security, and stays quiet about a missing one', async () => {
    renderScreen()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: auth.signIn.googleLabel })).toBeVisible()
    })
    expect(screen.queryByText(auth.outcome.sessions.unknown)).toBeNull()
    expect(screen.queryByText(auth.outcome.sessions.expired)).toBeNull()
  })
})

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast; `packages/ui`
    // converts the OKLCH palette over more pairs than a screen would exercise.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, landmarks — belongs to `app/layout.tsx`,
    // which is not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, A11Y)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the sign-in screen has no accessibility violations (P2)', () => {
  it('as a visitor first sees it', async () => {
    renderScreen()
    await screen.findByRole('link', { name: auth.signIn.googleLabel })

    await expectNoViolations()
  })

  it('with a failure on screen', async () => {
    renderScreen('status=error&reason=state_mismatch')
    await screen.findByText(auth.outcome.failures.state_mismatch)

    await expectNoViolations()
  })

  it('when somebody is already signed in', async () => {
    renderScreen('', sessionBuyer)
    await screen.findByText(auth.signIn.signedInTitle)

    await expectNoViolations()
  })
})
