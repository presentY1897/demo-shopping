/**
 * The console wake-up gate, driven through the mock API.
 *
 * **This is the gate `seller` and `admin` share, byte for byte** — the waiting
 * screen with its two-stage notice, the health panel, the failure with a retry.
 * The storefront no longer has these screens (it loads products alongside the
 * health check and shows one brief notice — DECISIONS 콜드 스타트), so its spec
 * cannot cover them, and this file is where they are covered once.
 *
 * **The clock is turned down, not faked.** The gate takes its policy as a value,
 * so this file hands it millisecond thresholds and reproduces the 90 second
 * sequence in about a second — with real timers, real requests and the real
 * component. The production numbers are pinned separately, in
 * `apps/shop/test/wake-policy.spec.ts`, against a `wake-policy.ts` that is
 * identical in all three apps.
 *
 * Covers QUALITY-GATES U1 (four states), U5 (keyboard) and U6 (server error
 * shown), TASK-0101 F1 · F2 · F3 · F5 · F7 · F10 and TASK-0118 F1 ~ F3 · F7 ·
 * F8 · F12.
 */

import {
  driftedHealthPayload,
  healthDegraded,
  healthHandlers,
  healthOk,
  healthSearchIndexing,
  heldRequestInstance,
  httpFailure,
  malformedResponse,
  mockPaths,
  networkFailure,
  neverAnswers,
  sleepingInstance,
  slowResponse,
  wakesAfter,
} from '@shopping/api-mocks'
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
  attemptTimeoutMs: 300,
  // Wall-clock, and out of reach on purpose. Nothing that uses this policy is
  // meant to run out of budget, and one only just past the boot below would turn
  // "did it recover" into "how loaded is this machine" (TASK-0121).
  budgetMs: 10_000,
  backoffMs: [10, 20],
  noticeAfterMs: 40,
  longWaitNoticeAfterMs: 120,
  expectedColdStartMs: 600,
  tickMs: 10,
  searchRecheckDelaysMs: [30, 60, 120],
  searchRecheckTimeoutMs: 300,
}

/**
 * {@link FAST} with a second threshold no test can reach.
 *
 * The staged notice is checked by asking "has the later one appeared yet", and
 * with {@link FAST} the answer is only false for the 80ms between
 * `noticeAfterMs` and `longWaitNoticeAfterMs` — of **real** time. `findByText`
 * polls, so on a loaded machine its first successful poll can already be past
 * that window, and the assertion fails while the code is correct.
 *
 * Pushing the second threshold out of reach turns the question into the one the
 * test actually means: *at the first threshold, the second notice is not shown.*
 * That is a statement about order, and order does not depend on how fast the
 * machine ran the test.
 */
const FIRST_THRESHOLD_ONLY: WakePolicy = { ...FAST, longWaitNoticeAfterMs: 60_000 }

/**
 * {@link FAST} that gives up, for the specs that are *about* giving up. Nothing
 * under it recovers, so the narrow budget costs no reliability. The 5ms backoff
 * is what keeps "more than three attempts" true on a busy machine: 600ms holds
 * three only if every refusal takes 200ms to arrive.
 */
const GIVES_UP: WakePolicy = { ...FAST, budgetMs: 600, backoffMs: [5] }

/**
 * The boot both platform doubles are given. **A second, not a few hundred
 * milliseconds**: the second-stage notice is asserted *while* the instance
 * boots, and a window that short is one a loaded machine can poll straight past.
 */
const BOOT_MS = 1_000

/**
 * The two shapes a sleeping platform can take (TASK-0118 4.6). Render was
 * measured refusing instantly; the policy has to carry a held request too.
 */
const PLATFORMS = [
  { name: 'instant refusal (Render, measured)', handler: sleepingInstance },
  { name: 'held request (the old model)', handler: heldRequestInstance },
] as const

const requests: string[] = []
const recordRequest = ({ request }: { request: Request }): void => {
  requests.push(request.url)
}

beforeEach(() => {
  requests.length = 0
  testServer.server.events.on('request:start', recordRequest)
})

afterEach(() => {
  testServer.server.events.removeListener('request:start', recordRequest)
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

/**
 * F2 — the notice arrives in two stages, and the screen keeps moving.
 *
 * `neverAnswers` throughout, not a slow answer: the waiting screen then stays
 * put instead of being replaced the moment the health check succeeds, so no
 * assertion here is racing the response.
 */
describe('once the wait stops being ordinary', () => {
  it('explains the wait at the first threshold', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate(FIRST_THRESHOLD_ONLY)

    expect(await screen.findByText(wake.preparing)).toBeVisible()
    expect(screen.queryByText(wake.coldStartNotice)).toBeNull()
  })

  it('names the two minute ceiling at the second threshold', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    expect(await screen.findByText(wake.coldStartNotice)).toBeVisible()
  })

  it('shows a progress indicator that actually advances', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    const bar = await screen.findByRole('progressbar')
    const first = Number(bar.getAttribute('aria-valuenow'))

    await waitFor(() => {
      expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(first)
    })
  })

  /**
   * **The attempt number used to be here** ("시도 1/3"). It went with the policy
   * that had a fixed number of attempts — the budget is wall-clock now, so there
   * is no total to count towards (TASK-0118 4.7). What the visitor gets instead
   * is the thing they can act on: how long this has been going.
   */
  it('shows the elapsed seconds rather than an attempt number', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()

    await screen.findByText(wake.preparing)

    expect(screen.getByText(new RegExp(`${wake.elapsedLabel}\\s*\\d+`))).toBeVisible()
    expect(screen.queryByText(/시도|\d+\s*\/\s*\d+/)).toBeNull()
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

  /**
   * TASK-0118 F1 ~ F3, in order: the wait outlasts the second threshold, the
   * "최대 2분" line is actually reached, and the payload arrives with no button
   * pressed. Budgeted by attempt, the instant refusal never got this far — three
   * refusals were spent before the first notice, and a failed gate stays failed
   * until somebody acts, so the last assertion could not pass either.
   */
  it.each(PLATFORMS)(
    'reaches the second-stage notice and then recovers by itself — $name',
    async ({ handler }) => {
      testServer.server.use(handler(mockPaths.health, BOOT_MS, healthOk))
      renderGate()

      expect(await screen.findByText(wake.coldStartNotice)).toBeVisible()
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()

      expect(await screen.findByText(healthOk.version)).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
    },
  )
})

/** U1 · 에러 — F5 · U6. */
describe('when every attempt fails', () => {
  beforeEach(() => {
    testServer.server.use(networkFailure(mockPaths.health))
  })

  it("shows what went wrong, in the panel's own words", async () => {
    renderGate(GIVES_UP)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(health.failureTitle)).toBeVisible()
    expect(within(alert).getByText(health.failures.network)).toBeVisible()
  })

  it('reports the spent budget and offers a retry, without an attempt number', async () => {
    renderGate(GIVES_UP)

    expect(await screen.findByText(wake.failureTitle)).toBeVisible()
    expect(screen.getByText(wake.failureHint)).toBeVisible()
    expect(screen.getByRole('button', { name: wake.retryLabel })).toBeVisible()
    expect(screen.queryByText(/시도\s*\d|\d+\s*\/\s*\d+/)).toBeNull()
  })

  it('stops asking once the budget is spent', async () => {
    renderGate(GIVES_UP)

    await screen.findByText(wake.failureTitle)
    const spent = requests.length
    await pause(200)

    // More than the three the old policy allowed, and then none at all: the
    // loop is bounded by the clock, not left running (TASK-0009 R8).
    expect(spent).toBeGreaterThan(3)
    expect(requests).toHaveLength(spent)
  })

  it('recovers when the button is pressed and the API is back', async () => {
    renderGate(GIVES_UP)
    const button = await screen.findByRole('button', { name: wake.retryLabel })

    testServer.server.use(...healthHandlers)
    await userEvent.click(button)

    expect(await screen.findByText(healthOk.version)).toBeVisible()
  })

  /** U5 — the retry has to be reachable and operable without a mouse. */
  it('puts the retry in the tab order and activates it from the keyboard', async () => {
    renderGate(GIVES_UP)
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
    renderGate(GIVES_UP)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(health.failures.http)).toBeVisible()
    expect(await screen.findByRole('button', { name: wake.retryLabel })).toBeVisible()
  })

  it('is final when another attempt cannot fix it, and is asked for once', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    renderGate()

    const alert = await screen.findByRole('alert')
    await pause(100)

    expect(within(alert).getByText(health.failures.malformed_response)).toBeVisible()
    expect(requests).toHaveLength(1)
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
