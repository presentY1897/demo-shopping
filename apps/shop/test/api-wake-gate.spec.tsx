/**
 * The wake-up gate, driven through the mock API.
 *
 * **The clock is turned down, not faked.** The gate takes its policy as a value,
 * so this file hands it millisecond thresholds and reproduces the 90 second
 * sequence in well under a second — with real timers, real requests and the real
 * component. The production numbers are pinned separately, in
 * `wake-policy.spec.ts`; neither file can pass on its own.
 *
 * Covers QUALITY-GATES U1 (four states), U5 (keyboard) and U6 (server error
 * shown), and TASK-0101 F1 · F2 · F3 · F5 · F7 · F10.
 */

import {
  healthDegraded,
  healthOk,
  healthSearchIndexing,
  httpFailure,
  malformedResponse,
  mockPaths,
  networkFailure,
  neverAnswers,
  slowResponse,
  wakesAfter,
} from '@shopping/api-mocks'
import { healthHandlers } from '@shopping/api-mocks'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import type { WakePolicy } from '@/lib/wake-policy'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { health, wake } = messagesFor()

/**
 * Module level, and never rebuilt: `useApiWake` treats the policy as an effect
 * dependency, so a fresh object per render would restart the sequence forever.
 */
const FAST: WakePolicy = {
  ...WAKE_POLICY,
  attemptTimeoutsMs: [300, 300, 300],
  backoffMs: [10, 20],
  noticeAfterMs: 40,
  longWaitNoticeAfterMs: 120,
  expectedColdStartMs: 600,
  tickMs: 10,
  searchRecheckDelaysMs: [30, 60, 120],
  searchRecheckTimeoutMs: 300,
}

const requests: string[] = []

beforeEach(() => {
  requests.length = 0
  testServer.server.events.on('request:start', ({ request }) => {
    requests.push(request.url)
  })
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
})

function renderGate(policy: WakePolicy = FAST): void {
  render(<ApiWakeGate health={health} policy={policy} wake={wake} />)
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** U1 · 로딩 — F1. A sleeping API leaves a skeleton, not a broken screen. */
describe('while the API has not answered', () => {
  it('shows the panel heading and a busy region straight away', () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(health.title)
    expect(screen.getByRole('region', { name: health.title })).toHaveAttribute('aria-busy', 'true')
  })

  it('tells assistive technology it is loading before any notice appears', () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    expect(screen.getByRole('status')).toHaveTextContent(wake.loadingLabel)
  })

  it('says nothing about a delay during the first moments', () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    // A warm API answers in 0.35s; explaining a wait that is not happening is
    // worse than saying nothing (TASK-0101 4.2).
    expect(screen.queryByText(wake.preparing)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

/** F2 — the notice arrives in two stages, and the screen keeps moving. */
describe('once the wait stops being ordinary', () => {
  it('explains the wait at the first threshold', async () => {
    testServer.server.use(slowResponse(mockPaths.health, 260, healthOk))
    renderGate()

    expect(await screen.findByText(wake.preparing)).toBeVisible()
    expect(screen.queryByText(wake.coldStartNotice)).toBeNull()
  })

  it('names the two minute ceiling only at the second threshold', async () => {
    testServer.server.use(slowResponse(mockPaths.health, 260, healthOk))
    renderGate()

    expect(await screen.findByText(wake.coldStartNotice)).toBeVisible()
  })

  it('shows a progress indicator that actually advances', async () => {
    testServer.server.use(slowResponse(mockPaths.health, 260, healthOk))
    renderGate()

    const bar = await screen.findByRole('progressbar')
    const first = Number(bar.getAttribute('aria-valuenow'))

    await waitFor(() => {
      expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(first)
    })
  })

  it('counts the attempt it is on', async () => {
    testServer.server.use(slowResponse(mockPaths.health, 260, healthOk))
    renderGate()

    await screen.findByText(wake.preparing)

    expect(screen.getByText(new RegExp(`${wake.attemptLabel} 1/3`))).toBeVisible()
  })

  it('replaces the whole waiting state once the answer lands', async () => {
    testServer.server.use(slowResponse(mockPaths.health, 120, healthOk))
    renderGate()

    expect(await screen.findByText(healthOk.version)).toBeVisible()
    expect(screen.queryByText(wake.preparing)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

/** U1 · 정상 */
describe('when the API answers', () => {
  it('renders the payload it was given', async () => {
    renderGate()

    expect(await screen.findByText(healthOk.version)).toBeVisible()
    expect(screen.getByText(`${healthOk.uptime}${health.uptimeUnit}`)).toBeVisible()
  })

  it('says search is usable', async () => {
    renderGate()

    expect(await screen.findByText(wake.search.ready)).toBeVisible()
  })
})

/** F3 — the instance finishes booting between two attempts. */
describe('an API that wakes up while the page waits', () => {
  it('recovers on its own, with nothing for the visitor to do', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 2, healthOk))
    renderGate()

    expect(await screen.findByText(healthOk.version)).toBeVisible()
    expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
  })
})

/** U1 · 에러 — F5 · U6. */
describe('when every attempt fails', () => {
  beforeEach(() => {
    testServer.server.use(networkFailure(mockPaths.health))
  })

  it("shows what went wrong, in the panel's own words", async () => {
    renderGate()

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(health.failureTitle)).toBeVisible()
    expect(within(alert).getByText(health.failures.network)).toBeVisible()
  })

  it('reports the spent budget and offers a retry', async () => {
    renderGate()

    expect(await screen.findByText(wake.failureTitle)).toBeVisible()
    expect(screen.getByText(new RegExp(`${wake.attemptLabel} 3/3`))).toBeVisible()
    expect(screen.getByRole('button', { name: wake.retryLabel })).toBeVisible()
  })

  it('recovers when the button is pressed and the API is back', async () => {
    renderGate()
    const button = await screen.findByRole('button', { name: wake.retryLabel })

    testServer.server.use(...healthHandlers)
    await userEvent.click(button)

    expect(await screen.findByText(healthOk.version)).toBeVisible()
  })

  /** U5 — the retry has to be reachable and operable without a mouse. */
  it('puts the retry in the tab order and activates it from the keyboard', async () => {
    renderGate()
    const button = await screen.findByRole('button', { name: wake.retryLabel })

    await userEvent.tab()
    expect(button).toHaveFocus()

    testServer.server.use(...healthHandlers)
    await userEvent.keyboard('{Enter}')

    expect(await screen.findByText(healthOk.version)).toBeVisible()
  })
})

/** U6 — a server error is shown, not swallowed. */
describe('a server error', () => {
  it('is put in front of the visitor', async () => {
    testServer.server.use(httpFailure(mockPaths.health, 500, 'INTERNAL_ERROR', 'Boom'))
    renderGate()

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(health.failures.http)).toBeVisible()
    expect(await screen.findByRole('button', { name: wake.retryLabel })).toBeVisible()
  })
})

/** U1 · 빈 — F7. The engine answers, but there is nothing to search yet. */
describe('when search is not ready', () => {
  it('says the index is being rebuilt rather than showing an empty search', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()

    expect(await screen.findByText(wake.search.preparingTitle)).toBeVisible()
    expect(screen.getByText(wake.search.indexing)).toBeVisible()
    expect(screen.queryByText(wake.search.ready)).toBeNull()
  })

  it('distinguishes an engine that is still asleep', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthDegraded))
    renderGate()

    expect(await screen.findByText(wake.search.waking)).toBeVisible()
    expect(screen.queryByText(wake.search.indexing)).toBeNull()
  })

  it('keeps the rest of the panel readable', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()

    expect(await screen.findByText(healthSearchIndexing.version)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('picks the search back up on its own once the index is there', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()

    await screen.findByText(wake.search.indexing)
    testServer.server.use(...healthHandlers)

    expect(await screen.findByText(wake.search.ready)).toBeVisible()
  })
})

/**
 * F10 · TASK-0009 R8 — 750 instance hours a month, shared by the API and the
 * search engine. Every repeat here is running time somebody pays for, so the
 * screen has to stop asking.
 */
describe('the request budget', () => {
  it('asks once when the answer is healthy, and then leaves the API alone', async () => {
    renderGate()
    await screen.findByText(healthOk.version)

    await pause(200)

    expect(requests).toHaveLength(1)
  })

  it('gives up re-checking a search that stays unready', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()

    // One wake-up plus the three re-checks the policy allows, and no more.
    await waitFor(() => {
      expect(requests).toHaveLength(1 + FAST.searchRecheckDelaysMs.length)
    })
    await pause(200)

    expect(requests).toHaveLength(1 + FAST.searchRecheckDelaysMs.length)
    expect(screen.queryByText(wake.search.autoRecheck)).toBeNull()
  })

  it('leaves a manual re-check behind once it has stopped asking', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()

    const button = await screen.findByRole('button', { name: wake.search.recheckLabel })

    testServer.server.use(...healthHandlers)
    await userEvent.click(button)

    expect(await screen.findByText(wake.search.ready)).toBeVisible()
  })
})
