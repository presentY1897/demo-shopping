/**
 * The numbers themselves, pinned against the measurement that produced them.
 *
 * Every other spec in this app hands the wake-up machinery millisecond
 * thresholds so a 90 second sequence runs instantly. That makes the mechanism
 * testable and the *values* untested — which is the half that decides whether a
 * real visitor is looked after. This file is the other half, and nothing about
 * it can be made to pass by a fast or slow machine.
 *
 * Measured 2026-09-03 against the deployed API (TASK-0101 4.1):
 * cold 약 90초 · warm 0.35초.
 */

import { describe, expect, it } from 'vitest'

import {
  backoffFor,
  elapsedSeconds,
  WAKE_POLICY,
  wakeNoticeLevel,
  wakeProgress,
} from '@/lib/wake-policy'

const MEASURED_COLD_START_MS = 90_000

describe('the notice thresholds', () => {
  it('leaves the first three seconds alone', () => {
    // A warm call is 0.35s. Explaining a wait that is not happening is worse
    // than saying nothing.
    expect(WAKE_POLICY.noticeAfterMs).toBe(3_000)
  })

  it('waits until fifteen seconds before naming a two minute wait', () => {
    expect(WAKE_POLICY.longWaitNoticeAfterMs).toBe(15_000)
  })

  it('puts the second threshold after the first, and both well inside a cold start', () => {
    expect(WAKE_POLICY.longWaitNoticeAfterMs).toBeGreaterThan(WAKE_POLICY.noticeAfterMs)
    expect(WAKE_POLICY.longWaitNoticeAfterMs).toBeLessThan(MEASURED_COLD_START_MS)
  })
})

describe('the retry budget', () => {
  it('is measured in wall-clock time, not in attempts', () => {
    // The old policy was three attempts whose deadlines summed to 143s. Against
    // a platform that refuses in 0.3s those three were spent in under four
    // seconds — the sum was never the thing being spent (TASK-0118 4.3).
    expect(WAKE_POLICY.budgetMs).toBeGreaterThan(MEASURED_COLD_START_MS)
  })

  it('lets one attempt sit through a whole spin-up', () => {
    // If the platform holds the request open instead of refusing it, a single
    // attempt has to be able to ride it out.
    expect(WAKE_POLICY.attemptTimeoutMs).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS)
    expect(WAKE_POLICY.attemptTimeoutMs).toBeLessThanOrEqual(WAKE_POLICY.budgetMs)
  })

  it('backs off exponentially and then stops growing', () => {
    const backoffs = WAKE_POLICY.backoffMs

    expect(backoffs).toEqual([1_000, 2_000, 4_000, 8_000])
    expect(backoffs).toEqual([...backoffs].sort((a, b) => a - b))
  })

  it('repeats the last wait rather than growing past it', () => {
    const last = WAKE_POLICY.backoffMs.at(-1)

    expect(backoffFor(WAKE_POLICY, WAKE_POLICY.backoffMs.length)).toBe(last)
    expect(backoffFor(WAKE_POLICY, 50)).toBe(last)
  })

  it('caps how long a finished boot can go unnoticed', () => {
    // The ceiling is the stretch a visitor can spend after the instance is
    // already up, watching a bar that is not moving. 8s on a 90s wait is 9%.
    const ceiling = WAKE_POLICY.backoffMs.at(-1) ?? 0

    expect(ceiling / MEASURED_COLD_START_MS).toBeLessThan(0.1)
  })

  it('bounds how many requests one cold start can make', () => {
    // TASK-0009 R8. Instance hours are charged for time awake rather than for
    // requests, and a booting instance does not boot faster for being asked
    // again — but an unbounded loop is still a loop, so the number is pinned.
    let elapsed = 0
    let attempts = 1

    for (;;) {
      const backoff = backoffFor(WAKE_POLICY, attempts)
      if (elapsed + backoff >= WAKE_POLICY.budgetMs) break

      elapsed += backoff
      attempts += 1
    }

    expect(attempts).toBeLessThanOrEqual(25)
  })

  it("records the measured cold start as the progress bar's reference", () => {
    expect(WAKE_POLICY.expectedColdStartMs).toBe(MEASURED_COLD_START_MS)
  })
})

/**
 * TASK-0009 R8 — 750 instance hours a month, shared by two services. Anything
 * that repeats without an end is "keep it awake", and two services kept awake is
 * 1460 hours.
 */
describe('the free plan budget', () => {
  it('bounds the automatic search re-checks', () => {
    expect(WAKE_POLICY.searchRecheckDelaysMs.length).toBeGreaterThan(0)
    expect(WAKE_POLICY.searchRecheckDelaysMs.length).toBeLessThanOrEqual(3)
  })

  it('spaces the re-checks further apart each time', () => {
    const delays = WAKE_POLICY.searchRecheckDelaysMs

    expect(delays).toEqual([...delays].sort((a, b) => a - b))
    expect(new Set(delays).size).toBe(delays.length)
  })

  it('keeps every wait finite, so no code path can idle forever', () => {
    const everyWait = [
      WAKE_POLICY.attemptTimeoutMs,
      WAKE_POLICY.budgetMs,
      ...WAKE_POLICY.backoffMs,
      ...WAKE_POLICY.searchRecheckDelaysMs,
      WAKE_POLICY.searchRecheckTimeoutMs,
      WAKE_POLICY.tickMs,
    ]

    expect(everyWait.every((ms) => Number.isFinite(ms) && ms > 0)).toBe(true)
  })
})

describe('wakeNoticeLevel', () => {
  it('says nothing before the first threshold', () => {
    expect(wakeNoticeLevel(WAKE_POLICY, 0)).toBe('none')
    expect(wakeNoticeLevel(WAKE_POLICY, 2_999)).toBe('none')
  })

  it('explains the wait from the first threshold', () => {
    expect(wakeNoticeLevel(WAKE_POLICY, 3_000)).toBe('waking')
    expect(wakeNoticeLevel(WAKE_POLICY, 14_999)).toBe('waking')
  })

  it('names the two minute ceiling from the second', () => {
    expect(wakeNoticeLevel(WAKE_POLICY, 15_000)).toBe('cold')
    expect(wakeNoticeLevel(WAKE_POLICY, 120_000)).toBe('cold')
  })
})

describe('wakeProgress', () => {
  it('tracks the measured cold start', () => {
    expect(wakeProgress(WAKE_POLICY, 0)).toBe(0)
    expect(wakeProgress(WAKE_POLICY, 45_000)).toBe(50)
  })

  it('never claims to be finished, however long the wait runs', () => {
    // A full bar on a page that is still waiting reads as "stuck", which is the
    // impression the notice exists to prevent.
    expect(wakeProgress(WAKE_POLICY, 90_000)).toBe(95)
    expect(wakeProgress(WAKE_POLICY, 600_000)).toBe(95)
  })
})

describe('elapsedSeconds', () => {
  it('counts whole seconds, so the number moves once a second', () => {
    expect(elapsedSeconds(0)).toBe(0)
    expect(elapsedSeconds(999)).toBe(0)
    expect(elapsedSeconds(1_000)).toBe(1)
    expect(elapsedSeconds(90_500)).toBe(90)
  })
})
