import type { Clock } from '../../src/common/clock.js'

/**
 * A clock a test owns.
 *
 * Bound over {@link CLOCK} by {@link useApiApp}, so every service under test
 * reads the instant this object holds. Moving it is an explicit call rather than
 * a side effect of waiting, which keeps a spec about "30 days later" from
 * depending on how long the suite actually took.
 */
export interface TestClock extends Clock {
  set: (instant: string | Date) => void
  advance: (milliseconds: number) => void
}

export function fixedClock(instant: string | Date): TestClock {
  let current = new Date(instant)

  return {
    now: () => new Date(current),
    set(next: string | Date): void {
      current = new Date(next)
    },
    advance(milliseconds: number): void {
      current = new Date(current.getTime() + milliseconds)
    },
  }
}

/** The instant every spec uses unless it needs another one. */
export const DEFAULT_TEST_INSTANT = '2026-09-03T00:00:00.000Z'
