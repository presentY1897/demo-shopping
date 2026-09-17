/**
 * The retry loop on its own, without a screen in the way.
 *
 * Every failure here is produced by the mock API, so what is being checked is
 * the sequence of real requests the app would make against a cold instance —
 * not a stubbed promise chain.
 */

import {
  driftedHealthPayload,
  healthOk,
  malformedResponse,
  mockPaths,
  networkFailure,
  neverAnswers,
  sleepingInstance,
  unreachableSearchEngine,
  wakesAfter,
} from '@shopping/api-mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HealthResult } from '@/lib/health'
import { wakeApi } from '@/lib/wake'
import type { WakePolicy } from '@/lib/wake-policy'
import { WAKE_POLICY } from '@/lib/wake-policy'

import { testServer } from './setup'

/**
 * The real policy with the clock turned down. Module level so it is a stable
 * reference, which is what `useApiWake` requires of a policy.
 */
const FAST: WakePolicy = {
  ...WAKE_POLICY,
  attemptTimeoutMs: 20,
  // **Wide enough that a slow machine cannot change the answer.** An attempt
  // against a silent API costs its whole deadline, so a budget only a few
  // deadlines wide turns "how many attempts" into "how loaded is this box" —
  // the family of flake TASK-0121 removed. At 20ms a deadline this holds at
  // least three attempts even if each one takes five times as long as it should.
  budgetMs: 400,
  backoffMs: [5, 10],
  tickMs: 5,
}

const requests: string[] = []

beforeEach(() => {
  requests.length = 0
  testServer.server.events.on('request:start', ({ request }) => {
    requests.push(request.url)
  })
})

afterEach(() => {
  vi.useRealTimers()
  testServer.server.events.removeAllListeners('request:start')
})

function attemptRecorder(): { seen: number[]; onAttempt: (attempt: number) => void } {
  const seen: number[] = []

  return {
    seen,
    onAttempt: (attempt) => {
      seen.push(attempt)
    },
  }
}

describe('a warm API', () => {
  it('answers on the first attempt and no more are made', async () => {
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, new AbortController().signal, onAttempt)

    expect(result).toMatchObject({ ok: true, response: healthOk })
    expect(seen).toEqual([1])
    expect(requests).toHaveLength(1)
  })
})

describe('an API that never answers', () => {
  it('tries more than once and reports the timeout', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, new AbortController().signal, onAttempt)

    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen).toEqual(seen.map((_, index) => index + 1))
  })

  it('stops once the budget cannot fit another wait', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))

    await wakeApi(FAST, new AbortController().signal, () => undefined)

    // **A bound, not a count.** Each attempt costs at least its 20ms deadline
    // plus at least the 5ms backoff, so 400ms of budget cannot hold more than
    // sixteen — and a loaded machine only makes it fewer. Asserting the exact
    // number would make this spec fail for being run on a busy box.
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.length).toBeLessThanOrEqual(20)
  })
})

/**
 * **The failure this task exists to remove.**
 *
 * A platform that refuses instantly costs the budget almost nothing per
 * attempt, so the loop has to keep going rather than stop after three. Budgeted
 * by attempt, these requests were spent in under four seconds against a boot
 * that needed ninety (TASK-0118 4.3).
 */
describe('an API that refuses instantly while it boots', () => {
  it('keeps trying rather than spending the budget on three fast refusals', async () => {
    testServer.server.use(sleepingInstance(mockPaths.health, 10_000, healthOk))
    const patient: WakePolicy = { ...FAST, budgetMs: 500, backoffMs: [5] }

    await wakeApi(patient, new AbortController().signal, () => undefined)

    // A refusal costs the budget almost nothing, so 500ms of it at 5ms a wait
    // buys far more than the three attempts the old policy allowed. The bound
    // is deliberately loose — the claim is "many", not a number.
    expect(requests.length).toBeGreaterThan(10)
  })

  it('recovers when the instance comes up mid sequence', async () => {
    testServer.server.use(sleepingInstance(mockPaths.health, 60, healthOk))
    const patient: WakePolicy = { ...FAST, budgetMs: 2_000, backoffMs: [10] }

    const result = await wakeApi(patient, new AbortController().signal, () => undefined)

    expect(result).toMatchObject({ ok: true, response: healthOk })
  })
})

describe('an API that wakes up mid sequence', () => {
  it('recovers without anyone pressing anything', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 2, healthOk))
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, new AbortController().signal, onAttempt)

    expect(result).toMatchObject({ ok: true, response: healthOk })
    expect(seen).toEqual([1, 2, 3])
  })

  it('waits between attempts rather than hammering', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 2, healthOk))

    const startedAt = performance.now()
    await wakeApi(FAST, new AbortController().signal, () => undefined)

    // The two backoffs, and nothing has been made instant by accident.
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(12)
  })
})

/**
 * Retrying is not free: each attempt is a request against an instance whose
 * running time is billed out of a 750 hour monthly budget shared with the search
 * engine (TASK-0009 R8). A failure that another attempt cannot fix must not
 * spend one.
 */
describe('failures that another attempt cannot fix', () => {
  it('makes no request at all once the caller has already left', async () => {
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, AbortSignal.abort(), onAttempt)

    expect(result).toMatchObject({ ok: false, reason: 'aborted' })
    expect(seen).toEqual([1])
    expect(requests).toHaveLength(0)
  })

  it('accepts a drifted payload as final rather than asking again', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, new AbortController().signal, onAttempt)

    expect(result).toMatchObject({ ok: false, reason: 'malformed_response' })
    expect(seen).toEqual([1])
    expect(requests).toHaveLength(1)
  })

  it('stops the moment the caller aborts, instead of spending the budget', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    const controller = new AbortController()
    const { seen, onAttempt } = attemptRecorder()

    const pending = wakeApi(FAST, controller.signal, onAttempt)
    controller.abort()

    await expect(pending).resolves.toMatchObject({ ok: false })
    expect(seen.length).toBeLessThan(4)
    expect(requests.length).toBeLessThan(3)
  })
})

/**
 * TASK-0143 — the API is awake and its search engine is not. Health answers
 * 200 with `search: "down"`, which the loop used to take for "done".
 *
 * Whether that answer is worth another attempt is the caller's to say, by
 * handing over a listener: the storefront does, the consoles do not.
 */
describe('an API that is up beside a search engine that is not', () => {
  function pendingRecorder(): { seen: string[]; onSearchPending: (result: HealthResult) => void } {
    const seen: string[] = []

    return {
      seen,
      onSearchPending: (result) => {
        seen.push(result.ok ? result.response.search : result.reason)
      },
    }
  }

  // F11, at the level of the loop: no listener, no waiting — byte for byte what
  // the consoles ran before there was a choice.
  it('stops at the first answer when nobody waits for search', async () => {
    const engine = unreachableSearchEngine({ downChecks: Number.POSITIVE_INFINITY })
    testServer.server.use(...engine.handlers)
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, new AbortController().signal, onAttempt)

    expect(result).toMatchObject({ ok: true, response: { search: 'down' } })
    expect(seen).toEqual([1])
    expect(engine.healthRequests()).toBe(1)
  })

  it('keeps asking for a caller that does, and returns the answer that says ok', async () => {
    const engine = unreachableSearchEngine({ downChecks: 2 })
    testServer.server.use(...engine.handlers)
    const { seen, onSearchPending } = pendingRecorder()

    const result = await wakeApi(
      FAST,
      new AbortController().signal,
      () => undefined,
      onSearchPending,
    )

    expect(result).toMatchObject({ ok: true, response: healthOk })
    // Each answer in between reached the caller, which is what lets a screen say
    // 「준비 중」 while `result` is still to come.
    expect(seen).toEqual(['down', 'down'])
    expect(engine.healthRequests()).toBe(3)
  })

  it('waits through an index that is still being rebuilt (R2)', async () => {
    const engine = unreachableSearchEngine({ downChecks: 1, indexingChecks: 1 })
    testServer.server.use(...engine.handlers)
    const { seen, onSearchPending } = pendingRecorder()

    const result = await wakeApi(
      FAST,
      new AbortController().signal,
      () => undefined,
      onSearchPending,
    )

    expect(result).toMatchObject({ ok: true, response: healthOk })
    expect(seen).toEqual(['down', 'degraded'])
  })

  it('waits on the same schedule as any other "not yet"', async () => {
    const engine = unreachableSearchEngine({ downChecks: 2 })
    testServer.server.use(...engine.handlers)

    const startedAt = performance.now()
    await wakeApi(
      FAST,
      new AbortController().signal,
      () => undefined,
      () => undefined,
    )

    // The two backoffs of `FAST` — 5 and 10 — and not a loop that spins.
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(12)
  })

  it('returns the last answer, still pending, when the budget ends first', async () => {
    const engine = unreachableSearchEngine({ downChecks: Number.POSITIVE_INFINITY })
    testServer.server.use(...engine.handlers)

    const result = await wakeApi(
      FAST,
      new AbortController().signal,
      () => undefined,
      () => undefined,
    )

    // `ok: true` — the API did answer. What to say about a search that never
    // came is the screen's decision, and it has what it needs to make it.
    expect(result).toMatchObject({ ok: true, response: { search: 'down' } })
    expect(engine.healthRequests()).toBeGreaterThan(1)

    const spent = engine.healthRequests()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(engine.healthRequests()).toBe(spent)
  })

  /**
   * F8 — **the production policy, not a fast one**, because the ceiling is a
   * property of those numbers: 1 + 2 + 4 + 8 and then 8s waits inside 150s is 21
   * requests (TASK-0118 4.5), and waiting for search must not buy a 22nd.
   *
   * The clock is faked here and nowhere else in this file — 150 seconds cannot
   * be turned down without ceasing to be the thing measured. Only the backoff's
   * `setTimeout` and the budget's `performance.now()` are replaced; the request
   * still goes through msw, and it is the double that counts.
   */
  it('F8 — asks at most 21 times on the production policy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const engine = unreachableSearchEngine({ downChecks: Number.POSITIVE_INFINITY })
    testServer.server.use(...engine.handlers)

    let result: HealthResult | null = null
    void wakeApi(
      WAKE_POLICY,
      new AbortController().signal,
      () => undefined,
      () => undefined,
    ).then((outcome) => {
      result = outcome
    })

    while (result === null) await vi.advanceTimersToNextTimerAsync()

    expect(result).toMatchObject({ ok: true, response: { search: 'down' } })
    expect(engine.healthRequests()).toBe(21)
    expect(performance.now()).toBeLessThan(WAKE_POLICY.budgetMs)
  })
})
