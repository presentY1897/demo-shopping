import { describe, expect, it } from 'vitest'

import type { Clock } from '../../src/common/clock.js'
import { CLOCK } from '../../src/common/clock.js'
import { useApiApp } from '../support/api-app.js'
import { fixedClock } from '../support/clock.js'

/**
 * The seam that makes time testable: the running application reads the instant
 * the test holds, not the process clock.
 *
 * Asserted at the container rather than through an endpoint because nothing
 * depends on the time yet — demo expiry is TASK-0025, refresh token lifetimes
 * TASK-0022. What has to be true today is that `CLOCK` resolves to the test's
 * object everywhere below the composition root, so that those tasks inherit a
 * working seam instead of discovering it does not substitute.
 *
 * `vi.setSystemTime` is not an alternative: it cannot move `now()` inside
 * PostgreSQL, so a row written with `DEFAULT now()` would carry the real time
 * while the application compared against a fake one.
 */

const INSTANT = '2026-09-03T00:00:00.000Z'

const clock = fixedClock(INSTANT)
const api = useApiApp({ clock })

describe('clock injection', () => {
  it('binds the test clock over the production one', () => {
    expect(api.resolve<Clock>(CLOCK).now().toISOString()).toBe(INSTANT)
  })

  it('does not move on its own', async () => {
    const before = api.resolve<Clock>(CLOCK).now().toISOString()

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(api.resolve<Clock>(CLOCK).now().toISOString()).toBe(before)
  })

  it('moves only when the test moves it', () => {
    clock.advance(24 * 60 * 60 * 1000)

    expect(api.resolve<Clock>(CLOCK).now().toISOString()).toBe('2026-09-04T00:00:00.000Z')

    clock.set(INSTANT)
    expect(api.resolve<Clock>(CLOCK).now().toISOString()).toBe(INSTANT)
  })

  it('hands out a copy, so a caller cannot mutate the clock', () => {
    const first = api.resolve<Clock>(CLOCK).now()

    first.setFullYear(1999)

    expect(api.resolve<Clock>(CLOCK).now().toISOString()).toBe(INSTANT)
  })
})
