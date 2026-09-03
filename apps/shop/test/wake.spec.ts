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
  wakesAfter,
} from '@shopping/api-mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
  attemptTimeoutsMs: [40, 40, 40],
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
  it('spends every attempt and reports the timeout', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    const { seen, onAttempt } = attemptRecorder()

    const result = await wakeApi(FAST, new AbortController().signal, onAttempt)

    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(seen).toEqual([1, 2, 3])
    expect(requests).toHaveLength(3)
  })

  it('makes no fourth request', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))

    await wakeApi(FAST, new AbortController().signal, () => undefined)

    expect(requests).toHaveLength(FAST.attemptTimeoutsMs.length)
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
    expect(requests.length).toBeLessThan(FAST.attemptTimeoutsMs.length)
  })
})
