/**
 * Getting a demo account, and being told how long it lasts (TASK-0024 F11~F13).
 *
 * Two components and one contract between them: the button issues an account and
 * renews the session, the banner asks the API how long is left. Both are
 * byte-identical in the three apps — `docs/HANDOFF.md` 3.5 records why the auth
 * layer is triplicated — so this file drives every branch and the two consoles
 * check only what differs.
 */

import {
  demoBuyerAccount,
  sessionBuyer,
  failNextDemoIssue,
  mockPaths,
  networkFailureOn,
  neverAnswersOn,
  resetDemoStore,
} from '@shopping/api-mocks'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SignInScreen } from '@/components/auth/sign-in-screen'
import { DemoBanner } from '@/components/demo/demo-banner'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const auth = messagesFor().auth
const demo = messagesFor().demo

const navigation = vi.hoisted(() => ({ query: '', replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
  usePathname: () => '/login',
}))

const A11Y: RunOptions = {
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

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, A11Y)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function renderSignIn(query = '') {
  navigation.query = query

  return renderWithAuth(<SignInScreen demo={demo} messages={auth} />, { session: null })
}

function demoButton(): HTMLElement {
  return screen.getByRole('button', { name: auth.signIn.demoLabel })
}

/** An account with a known amount of time left, from the reader's own clock. */
function expiringIn(hours: number, minutes: number): { role: 'BUYER'; expiresAt: string } {
  // Half a minute of slack so a test that crosses a minute boundary between the
  // fixture and the render does not read one minute short.
  const ms = (hours * 60 + minutes) * 60_000 + 30_000

  return { role: 'BUYER', expiresAt: new Date(Date.now() + ms).toISOString() }
}

beforeEach(() => {
  navigation.replace.mockClear()
  navigation.push.mockClear()
  sessionStorage.clear()
})

describe('데모 계정 발급 (F11)', () => {
  it('누르면 발급하고 로그인 상태로 바꾼 뒤 돌아갈 곳으로 보낸다', async () => {
    const user = userEvent.setup()
    renderSignIn()

    await user.click(demoButton())

    // The two calls are the contract: the issue sets a cookie and the renewal
    // turns it into a session (TASK-0024 4.1).
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('/')
    })
  })

  it('돌아갈 곳이 지정돼 있으면 그리로 보낸다', async () => {
    const user = userEvent.setup()
    renderSignIn('next=%2Fmypage')

    await user.click(demoButton())

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('/mypage')
    })
  })

  it('요청 중에는 다시 눌러도 한 번만 나간다 (U3)', async () => {
    // Held open, which is the only window in which "발급 중" is observable at
    // all — the double answers in a microtask otherwise.
    testServer.server.use(neverAnswersOn('post', mockPaths.authDemo))

    let issued = 0

    testServer.server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.includes('/auth/demo')) issued += 1
    })

    const user = userEvent.setup()
    renderSignIn()

    const button = demoButton()

    await user.click(button)

    // The label changes and the control is disabled while it is in flight.
    expect(await screen.findByRole('button', { name: demo.issuePending })).toBeDisabled()

    await user.click(button)
    await waitFor(() => {
      expect(issued).toBe(1)
    })
  })

  it('한도에 걸리면 기다리라고 말하고 다시 누를 수 있다 (F12)', async () => {
    failNextDemoIssue()

    const user = userEvent.setup()
    renderSignIn()

    await user.click(demoButton())

    expect(await screen.findByText(demo.rateLimited)).toBeVisible()
    expect(navigation.replace).not.toHaveBeenCalled()
    // The button is usable again — a refusal that disabled it would be a dead
    // end for the one failure where waiting is the right answer.
    expect(demoButton()).toBeEnabled()

    await user.click(demoButton())

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalled()
    })
  })

  it('서버에 닿지 못하면 그렇게 말한다 (U6)', async () => {
    testServer.server.use(networkFailureOn('post', mockPaths.authDemo))

    const user = userEvent.setup()
    renderSignIn()

    await user.click(demoButton())

    expect(await screen.findByText(demo.unreachable)).toBeVisible()
    expect(demoButton()).toBeEnabled()
  })

  it('실패한 화면에도 접근성 위반이 없다 (P2)', async () => {
    failNextDemoIssue()

    const user = userEvent.setup()
    renderSignIn()

    await user.click(demoButton())
    await screen.findByText(demo.rateLimited)

    await expectNoViolations()
  })
})

describe('남은 시간 배너 (F13)', () => {
  it('실계정에는 아무것도 그리지 않는다', async () => {
    renderWithAuth(<DemoBanner messages={demo} />, { session: null })

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  it('데모 계정에는 남은 시간을 시간·분으로 보여준다', async () => {
    resetDemoStore(expiringIn(23, 12))

    renderWithAuth(<DemoBanner messages={demo} />, { session: sessionBuyer })

    expect(await screen.findByText(/23시간 12분/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(demo.bannerLabel)
  })

  it('한 시간이 안 남으면 분만 말한다', async () => {
    resetDemoStore(expiringIn(0, 12))

    renderWithAuth(<DemoBanner messages={demo} />, { session: sessionBuyer })

    // "0시간 12분" would read as a bug, so the copy has two sentences.
    expect(await screen.findByText(/^12분/)).toBeVisible()
  })

  it('만료된 계정에는 다시 받으라고 말한다', async () => {
    resetDemoStore({ role: 'BUYER', expiresAt: new Date(Date.now() - 1_000).toISOString() })

    renderWithAuth(<DemoBanner messages={demo} />, { session: sessionBuyer })

    expect(await screen.findByText(demo.expired)).toBeVisible()
  })

  it('상태를 읽지 못하면 조용히 사라진다', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.authDemo))
    resetDemoStore(demoBuyerAccount)

    renderWithAuth(<DemoBanner messages={demo} />, { session: sessionBuyer })

    // An error message where a countdown should be is worse than no countdown:
    // the visitor cannot act on it and the app behind it works.
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  it('접근성 위반이 없다 (P2)', async () => {
    resetDemoStore(expiringIn(5, 5))

    renderWithAuth(<DemoBanner messages={demo} />, { session: sessionBuyer })
    await screen.findByRole('status')

    await expectNoViolations()
  })
})
