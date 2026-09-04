/**
 * The seller console's sign-in screen (TASK-0023 F11 · P2).
 *
 * `SignInScreen` is byte-identical in the three apps, and `apps/shop` drives
 * every branch of it. What can only be checked here is what differs: this app's
 * own copy, and its own `?app=` — the parameter that decides which origin the
 * callback returns the browser to, and which refresh cookie it lands in (D-218).
 */

import { screen } from '@testing-library/react'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it, vi } from 'vitest'

import { SignInScreen } from '@/components/auth/sign-in-screen'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'

const auth = messagesFor().auth
const demoMessages = messagesFor().demo

const navigation = vi.hoisted(() => ({ query: '' }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/login',
}))

function renderScreen(query = '') {
  navigation.query = query

  return renderWithAuth(<SignInScreen demo={demoMessages} messages={auth} />, { session: null })
}

describe('the seller sign-in screen', () => {
  it('starts the round trip as this app, not as another one', () => {
    renderScreen()

    expect(screen.getByRole('link', { name: auth.signIn.googleLabel })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/v1/auth/google?app=seller'),
    )
  })

  it('speaks this console when a sign-in has no seller role', () => {
    renderScreen('status=ok&notice=no_role')

    expect(screen.getByText(auth.outcome.notices.no_role)).toBeVisible()
  })

  it('has no accessibility violations (P2)', async () => {
    renderScreen('status=error&reason=exchange_failed')
    await screen.findByText(auth.outcome.failures.exchange_failed)

    const options: RunOptions = {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
      rules: {
        'color-contrast': { enabled: false },
        'html-has-lang': { enabled: false },
        'document-title': { enabled: false },
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
      },
    }
    const results = await axe.run(document.body, options)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
