/**
 * The console's demo entry and banner (TASK-0024 F11 · F13).
 *
 * `DemoIssueButton`, `DemoBanner` and the client under them are byte-identical
 * in the three apps and `apps/shop` drives every branch. What can only be
 * checked here is what differs: **which persona this app asks for** — which
 * decides the roles the account gets and, through `X-App-Id`, the cookie the
 * session lands in (D-218) — and this console's own copy.
 */

import { mockDemoAccount, resetDemoStore, sessionDemoAdmin } from '@shopping/api-mocks'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SignInScreen } from '@/components/auth/sign-in-screen'
import { DemoBanner } from '@/components/demo/demo-banner'
import { DEMO_ROLE } from '@/lib/demo/demo-client'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'

/** Somebody signed into this console, so the banner has an account to ask about. */
const SIGNED_IN = sessionDemoAdmin

const auth = messagesFor().auth
const demo = messagesFor().demo

const navigation = vi.hoisted(() => ({ query: '', replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  usePathname: () => '/login',
}))

beforeEach(() => {
  navigation.replace.mockClear()
  sessionStorage.clear()
})

describe('콘솔의 데모 발급', () => {
  it('이 콘솔의 페르소나를 발급한다', async () => {
    const user = userEvent.setup()

    navigation.query = ''
    renderWithAuth(<SignInScreen demo={demo} messages={auth} />, { session: null })

    await user.click(screen.getByRole('button', { name: auth.signIn.demoLabel }))

    // Not the label on the button — the persona that actually left in the body.
    // A console asking for another app's persona is refused by the API, and the
    // symptom of getting it wrong would be a 400 nobody expected.
    await waitFor(() => {
      expect(mockDemoAccount()?.role).toBe(DEMO_ROLE)
    })
    expect(navigation.replace).toHaveBeenCalled()
  })

  it('이 콘솔의 문구로 안내한다', () => {
    navigation.query = ''
    renderWithAuth(<SignInScreen demo={demo} messages={auth} />, { session: null })

    expect(screen.getByText(auth.signIn.demoReason)).toBeVisible()
  })
})

describe('콘솔의 남은 시간 배너', () => {
  it('이 콘솔의 이름으로 남은 시간을 보여준다', async () => {
    resetDemoStore({
      role: DEMO_ROLE,
      expiresAt: new Date(Date.now() + 3 * 60 * 60_000 + 90_000).toISOString(),
    })

    renderWithAuth(<DemoBanner messages={demo} />, { session: SIGNED_IN })

    const banner = await screen.findByRole('status')

    expect(banner).toHaveTextContent(demo.bannerLabel)
    expect(banner).toHaveTextContent(/3시간 1분/)
  })

  it('접근성 위반이 없다 (P2)', async () => {
    resetDemoStore({
      role: DEMO_ROLE,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })

    renderWithAuth(<DemoBanner messages={demo} />, { session: SIGNED_IN })
    await screen.findByRole('status')

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
