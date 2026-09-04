/**
 * The two names a density goes by, and when a stored one is promoted
 * (TASK-0112 4장).
 *
 * Pure input to output, so every branch is reachable by calling it — which is
 * the point of having lifted the decision out of the provider at all. The
 * effect around it can then be tested for *what it does with the answer*
 * (F8) rather than for the answer itself.
 */

import { displayDensities } from '@shopping/shared'
import { DENSITY_LEVELS } from '@shopping/ui'
import { describe, expect, it } from 'vitest'

import {
  densityLevelOf,
  densityToPromote,
  displayDensityOf,
} from '@/lib/profile/density-preference'

describe('the two names one density goes by', () => {
  it('round-trips every step', () => {
    for (const level of DENSITY_LEVELS) {
      expect(densityLevelOf(displayDensityOf(level))).toBe(level)
    }
  })

  it('covers every value the API can send', () => {
    // Not a loop over a hand-written list: `displayDensities` is the contract's
    // own, so a fourth step added there fails here rather than rendering at the
    // default in front of somebody.
    for (const density of displayDensities) {
      expect(DENSITY_LEVELS).toContain(densityLevelOf(density))
    }
  })

  it('maps the steps in the order the design document states', () => {
    expect(displayDensityOf(1)).toBe('MINIMAL')
    expect(displayDensityOf(2)).toBe('STANDARD')
    expect(displayDensityOf(3)).toBe('MAXIMAL')
  })
})

describe('what to promote when a session begins', () => {
  it('promotes nothing when this browser stored nothing', () => {
    // The account's value wins outright. Without this branch a visitor who has
    // never touched the toggle would overwrite their own account with the
    // default on every sign-in.
    expect(densityToPromote(null, 'MAXIMAL')).toBeNull()
  })

  it('promotes nothing when the two already agree', () => {
    expect(densityToPromote(3, 'MAXIMAL')).toBeNull()
  })

  it('promotes the stored step when they disagree', () => {
    expect(densityToPromote(3, 'STANDARD')).toBe('MAXIMAL')
    expect(densityToPromote(1, 'STANDARD')).toBe('MINIMAL')
  })
})
