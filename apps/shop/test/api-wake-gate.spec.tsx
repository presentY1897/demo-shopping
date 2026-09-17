import {
  driftedHealthPayload,
  healthHandlers,
  healthOk,
  healthSearchIndexing,
  heldRequestInstance,
  malformedResponse,
  mockPaths,
  networkFailure,
  neverAnswers,
  sleepingInstance,
  wakesAfter,
} from '@shopping/api-mocks'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { SectionReadiness } from '@/lib/products/section-readiness'
import type { WakePolicy } from '@/lib/wake-policy'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'
import { testServer } from './setup'

const { health, wake } = messagesFor()

// Module level: `useApiWake` takes the policy as an effect dependency, so an
// object rebuilt per render would restart the sequence forever.
const FAST: WakePolicy = {
  ...WAKE_POLICY,
  attemptTimeoutMs: 300,
  // Wall-clock, and out of reach on purpose. Nothing that uses this policy is
  // meant to run out of budget, and one only just past the boot below would turn
  // "did it recover" into "how loaded is this machine" (TASK-0121).
  budgetMs: 10_000,
  backoffMs: [10, 20],
  noticeAfterMs: 40,
  tickMs: 10,
  searchRecheckDelaysMs: [30, 60, 120],
  searchRecheckTimeoutMs: 300,
}

// {@link FAST} that gives up, for the specs that are *about* giving up. Nothing
// under it recovers, so the narrow budget costs no reliability. The 5ms backoff
// is what keeps "more than three attempts" true on a busy machine: 600ms holds
// three only if every refusal takes 200ms to arrive.
const GIVES_UP: WakePolicy = { ...FAST, budgetMs: 600, backoffMs: [5] }

// The boot both platform doubles are given. **A second, not a few hundred
// milliseconds**: the notice is asserted *while* the instance boots, and a
// window that short is one a loaded machine can poll straight past.
const BOOT_MS = 1_000

// The two shapes a sleeping platform can take (TASK-0118 4.6). Render was
// measured refusing instantly; the policy has to carry a held request too.
const PLATFORMS = [
  { name: 'instant refusal (Render, measured)', handler: sleepingInstance },
  { name: 'held request (the old model)', handler: heldRequestInstance },
] as const

let healthRequests = 0
const countHealthRequest = ({ request }: { request: Request }): void => {
  if (new URL(request.url).pathname === mockPaths.health.slice(1)) healthRequests += 1
}

beforeEach(() => {
  healthRequests = 0
  testServer.server.events.on('request:start', countHealthRequest)
})

afterEach(() => {
  testServer.server.events.removeListener('request:start', countHealthRequest)
})

// `products pending` · `products ready` · `products failed` — what a row is told.
function ReadinessProbe() {
  return <p>{`products ${useContext(SectionReadiness)}`}</p>
}
function renderGate(policy: WakePolicy = FAST) {
  render(
    <ApiWakeGate policy={policy} wake={wake}>
      <ReadinessProbe />
    </ApiWakeGate>,
  )
}
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function expectReady() {
  expect(await screen.findByText('products ready')).toBeVisible()
  expect(screen.queryByText(health.title)).toBeNull()
  expect(screen.queryByText(healthOk.version)).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
}

describe('storefront readiness', () => {
  it('renders the shell immediately and only explains a prolonged wait', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()
    expect(screen.getByText('products pending')).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
    expect(await screen.findByText(wake.storefrontPreparing)).toBeVisible()
    expect(screen.queryByText(health.title)).toBeNull()
    expect(screen.queryByText(wake.coldStartNotice)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('silently enables products when healthy', async () => {
    renderGate()
    await expectReady()
  })

  it('recovers automatically when the API wakes', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 2, healthOk))
    renderGate()
    await expectReady()
  })

  it('keeps a brief error and supports keyboard retry', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    renderGate(GIVES_UP)
    expect(await screen.findByRole('alert')).toHaveTextContent(wake.storefrontFailed)
    expect(screen.queryByText(health.failures.network)).toBeNull()
    const button = screen.getByRole('button', { name: wake.retryLabel })
    await userEvent.tab()
    expect(button).toHaveFocus()
    testServer.server.use(...healthHandlers)
    await userEvent.keyboard('{Enter}')
    await expectReady()
  })

  // The engine wakes on its own schedule, and the gate used to stop here and
  // offer a button. Now the same loop keeps asking (TASK-0143 4.3); what that
  // looks like end to end — no alert, no button, a bounded number of requests —
  // is measured criterion by criterion in `search-unavailable.spec.tsx`.
  it('enables products once search is ready, with nobody pressing anything', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()
    expect(await screen.findByRole('status')).toHaveTextContent(wake.storefrontPreparing)
    expect(screen.getByText('products pending')).toBeVisible()
    expect(screen.queryByText(wake.search.indexing)).toBeNull()
    expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
    testServer.server.use(...healthHandlers)
    await expectReady()
  })
})

/**
 * TASK-0118 — the budget is wall-clock, because a sleeping Render instance
 * refuses in 0.3s instead of holding the request. Counted by attempt, three
 * refusals spent the whole policy in about four seconds of a ninety second boot.
 */
describe('a sleeping instance', () => {
  // The storefront has no second-stage "최대 2분" notice and no waiting screen —
  // products load alongside the health check (DECISIONS 콜드 스타트). What a
  // shop visitor sees through the whole boot is the one brief notice, and then
  // it goes away. **Nobody presses anything here**, and a gate that had fallen
  // to the failure state stays there until somebody does — so arriving at
  // `expectReady` is also the proof that the alert never showed.
  it.each(PLATFORMS)(
    'explains the wait once and recovers without the visitor — $name',
    async ({ handler }) => {
      testServer.server.use(handler(mockPaths.health, BOOT_MS, healthOk))
      renderGate()

      const notice = await screen.findByRole('status')
      expect(notice.textContent).toBe(wake.storefrontPreparing)
      expect(screen.getByText('products pending')).toBeVisible()
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()

      await expectReady()
    },
  )

  it('stops asking once the budget is spent', async () => {
    testServer.server.use(sleepingInstance(mockPaths.health, 60_000, healthOk))
    renderGate(GIVES_UP)

    expect(await screen.findByRole('alert')).toHaveTextContent(wake.storefrontFailed)
    expect(screen.getByText('products failed')).toBeVisible()
    const spent = healthRequests
    await pause(200)

    // More than the three the old policy allowed, and then none at all: the
    // loop is bounded by the clock, not left running (TASK-0009 R8).
    expect(spent).toBeGreaterThan(3)
    expect(healthRequests).toBe(spent)
  })

  it('does not ask again when another attempt cannot help', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    renderGate()

    expect(await screen.findByRole('alert')).toHaveTextContent(wake.storefrontFailed)
    await pause(100)

    expect(healthRequests).toBe(1)
  })

  // There is no total to count towards once the budget is a duration, so no
  // screen shows an attempt number (TASK-0118 4.7). The storefront goes further
  // and shows no counter of any kind. Two renders rather than one: the notice
  // and the failure are checked where each one *stays*, not in the gap between.
  it('puts no attempt number in the notice', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    expect((await screen.findByRole('status')).textContent).not.toMatch(/\d/)
  })

  it('puts no attempt number in the failure', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    renderGate(GIVES_UP)

    expect((await screen.findByRole('alert')).textContent).not.toMatch(/\d/)
  })
})
