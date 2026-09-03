import { describe, expect, it } from 'vitest'

import { SystemClock } from './clock.js'

describe('SystemClock', () => {
  it('reads the process clock', () => {
    const clock = new SystemClock()
    const before = performance.timeOrigin + performance.now()
    const observed = clock.now()
    const after = performance.timeOrigin + performance.now()

    expect(observed).toBeInstanceOf(Date)
    expect(observed.getTime()).toBeGreaterThanOrEqual(Math.floor(before))
    expect(observed.getTime()).toBeLessThanOrEqual(Math.ceil(after))
  })

  it('hands out a new Date each time rather than a cached one', () => {
    const clock = new SystemClock()
    const first = clock.now()

    first.setFullYear(1999)

    expect(clock.now().getFullYear()).not.toBe(1999)
  })
})
