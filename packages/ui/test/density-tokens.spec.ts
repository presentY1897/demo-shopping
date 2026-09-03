/**
 * The density tokens, read out of the stylesheet the browser will actually load.
 *
 * Three things are checked here that no amount of reading the CSS proves:
 *
 *   - the density × viewport matrix in `density.css` and the one in
 *     `src/density/density.ts` are the same matrix (they are written twice
 *     because CSS and JavaScript both need it, and two copies drift)
 *   - no control can end up under the 44px touch floor at any step or viewport,
 *     evaluated from the real `max()` expression rather than asserted by comment
 *   - a 360px phone at maximal density still produces a usable card
 */

import { describe, expect, it } from 'vitest'

import { DENSITY_GRID_COLUMNS, DENSITY_LEVELS, type DensityLevel } from '../src/density/density'
import { tokenLength, tokenNumber } from './support/css-tokens'

/** One probe per viewport band — the widths QUALITY-GATES P3 verifies at. */
const PROBES = [
  { width: 360, viewport: 'base' },
  { width: 768, viewport: 'md' },
  { width: 1440, viewport: 'xl' },
] as const

const COMBINATIONS = DENSITY_LEVELS.flatMap((density) =>
  PROBES.map((probe) => ({ density, ...probe })),
)

const CONTROL_TOKENS = ['--spacing-control-sm', '--spacing-control-md', '--spacing-control-lg']

/** Utility classes the product grid uses, so the arithmetic below matches the page. */
const GRID_GAP_STEPS = 4

describe('density × viewport matrix', () => {
  it.each(COMBINATIONS)(
    'density $density at $width px renders the documented column count',
    ({ density, width, viewport }) => {
      expect(tokenNumber('--density-cols', { density, width })).toBe(
        DENSITY_GRID_COLUMNS[density][viewport],
      )
    },
  )

  it.each(COMBINATIONS)('density $density at $width px is fully defined', ({ density, width }) => {
    // A step that inherited half its values from another step would look
    // plausible and be wrong in one place only.
    for (const token of ['--space-unit', '--font-scale', '--radius-scale', '--space-gutter']) {
      expect(tokenNumber(token, { density, width })).toBeGreaterThan(0)
    }
  })

  it.each(PROBES)('orders the three steps loosest to densest at $width px', ({ width }) => {
    const unit = (density: DensityLevel) => tokenLength('--space-unit', { density, width })
    expect(unit(1)).toBeGreaterThan(unit(2))
    expect(unit(2)).toBeGreaterThan(unit(3))

    const font = (density: DensityLevel) => tokenNumber('--font-scale', { density, width })
    expect(font(1)).toBeGreaterThan(font(2))
    expect(font(2)).toBeGreaterThan(font(3))
  })

  it('narrows the spread between the steps on a phone', () => {
    // Minimal's generous whitespace is wasted at 360px and maximal's shrink
    // stops being readable, so the mobile band pulls the three together
    // (TASK-0014 4장).
    const spreadAt = (width: number) =>
      tokenLength('--space-unit', { density: 1, width }) -
      tokenLength('--space-unit', { density: 3, width })

    expect(spreadAt(360)).toBeLessThan(spreadAt(1440))
  })

  it('keeps the maximal step legible', () => {
    // 15.2px at the densest step on the widest screen. Below roughly 14px body
    // text stops being a product listing and starts being a spreadsheet.
    for (const { width } of PROBES) {
      expect(tokenLength('--text-base', { density: 3, width })).toBeGreaterThanOrEqual(14)
    }
  })
})

describe('touch target floor', () => {
  it.each(COMBINATIONS)(
    'density $density at $width px keeps every control at 44px or more',
    ({ density, width }) => {
      // The floor comes from `max(var(--touch-min), …)` in the token itself, so
      // this evaluates the shipped expression rather than a restatement of it.
      for (const token of CONTROL_TOKENS) {
        expect(tokenLength(token, { density, width })).toBeGreaterThanOrEqual(44)
      }
    },
  )

  it.each(COMBINATIONS)(
    'density $density at $width px holds --touch-min at 44px',
    ({ density, width }) => {
      // Density must not be able to reach the floor itself.
      expect(tokenLength('--touch-min', { density, width })).toBe(44)
      expect(tokenLength('--spacing-touch', { density, width })).toBe(44)
    },
  )

  it('is a floor, not a fixed height', () => {
    // If every step produced exactly 44px the token would be doing nothing; the
    // looser steps have to actually be looser.
    expect(tokenLength('--spacing-control-lg', { density: 1, width: 1440 })).toBeGreaterThan(44)
    expect(tokenLength('--spacing-control-lg', { density: 2, width: 1440 })).toBeGreaterThan(44)
  })
})

describe('mobile maximal', () => {
  it('leaves a card wide enough to be a product card at 360px', () => {
    // TASK-0014 F8: 2 columns, at least 150px per card.
    const width = 360
    const density = 3 as const
    const columns = tokenNumber('--density-cols', { density, width })
    const gutter = tokenLength('--space-gutter', { density, width })
    const gap = tokenLength('--space-unit', { density, width }) * GRID_GAP_STEPS

    const card = (width - gutter * 2 - gap * (columns - 1)) / columns

    expect(columns).toBe(2)
    expect(card).toBeGreaterThanOrEqual(150)
  })
})
