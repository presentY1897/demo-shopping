import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DENSITY,
  DENSITY_GRID_COLUMNS,
  DENSITY_LEVELS,
  DENSITY_VIEWPORTS,
  DENSITY_VIEWPORT_MIN_WIDTH,
  densityViewportFor,
  gridColumnsAt,
  gridColumnsFor,
  isDensityLevel,
  parseDensityLevel,
} from './density'

describe('isDensityLevel', () => {
  it('accepts exactly the three steps', () => {
    expect(DENSITY_LEVELS.every(isDensityLevel)).toBe(true)
  })

  it.each([0, 4, 2.5, -1, '2', null, undefined, {}, Number.NaN])('rejects %o', (value) => {
    expect(isDensityLevel(value)).toBe(false)
  })
})

describe('parseDensityLevel', () => {
  it('passes a level through unchanged', () => {
    expect(parseDensityLevel(3)).toBe(3)
  })

  it('reads the string form a DOM attribute or localStorage hands back', () => {
    expect(parseDensityLevel('1')).toBe(1)
    expect(parseDensityLevel(' 2 ')).toBe(2)
  })

  it.each([null, undefined, '', '   ', 'maximal', '4', '0', '2.5', {}])(
    'returns null for %o rather than guessing',
    (value) => {
      expect(parseDensityLevel(value)).toBeNull()
    },
  )
})

describe('densityViewportFor', () => {
  it.each([
    [0, 'base'],
    [359, 'base'],
    [360, 'base'],
    [767, 'base'],
    [768, 'md'],
    [1279, 'md'],
    [1280, 'xl'],
    [1440, 'xl'],
    [4000, 'xl'],
  ] as const)('puts %ipx in the %s band', (width, expected) => {
    expect(densityViewportFor(width)).toBe(expected)
  })

  it('falls back to the mobile-first band when the width is unknown', () => {
    // An unmeasured container or a server render: `apps/shop` is mobile first,
    // so the narrow layout is the safe guess (DECISIONS 1장).
    expect(densityViewportFor(Number.NaN)).toBe('base')
    expect(densityViewportFor(Number.POSITIVE_INFINITY)).toBe('base')
  })

  it('switches bands exactly at the media query boundaries', () => {
    expect(densityViewportFor(DENSITY_VIEWPORT_MIN_WIDTH.md - 1)).toBe('base')
    expect(densityViewportFor(DENSITY_VIEWPORT_MIN_WIDTH.md)).toBe('md')
    expect(densityViewportFor(DENSITY_VIEWPORT_MIN_WIDTH.xl - 1)).toBe('md')
    expect(densityViewportFor(DENSITY_VIEWPORT_MIN_WIDTH.xl)).toBe('xl')
  })
})

describe('grid columns', () => {
  it('matches the matrix in docs/design/pages.md 반응형', () => {
    expect(DENSITY_GRID_COLUMNS).toEqual({
      1: { base: 1, md: 2, xl: 3 },
      2: { base: 2, md: 3, xl: 4 },
      3: { base: 2, md: 4, xl: 6 },
    })
  })

  it.each([
    [1, 360, 1],
    [1, 768, 2],
    [1, 1440, 3],
    [2, 360, 2],
    [2, 768, 3],
    [2, 1440, 4],
    [3, 360, 2],
    [3, 768, 4],
    [3, 1440, 6],
  ] as const)('density %i at %ipx renders %i columns', (density, width, expected) => {
    expect(gridColumnsFor(density, width)).toBe(expected)
  })

  it('never collapses to zero columns', () => {
    for (const density of DENSITY_LEVELS) {
      for (const viewport of DENSITY_VIEWPORTS) {
        expect(gridColumnsAt(density, viewport)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('widens or holds as the viewport grows, never narrows', () => {
    for (const density of DENSITY_LEVELS) {
      const { base, md, xl } = DENSITY_GRID_COLUMNS[density]
      expect(md).toBeGreaterThanOrEqual(base)
      expect(xl).toBeGreaterThanOrEqual(md)
    }
  })

  it('never gives a denser step fewer columns than a looser one', () => {
    for (const viewport of DENSITY_VIEWPORTS) {
      expect(gridColumnsAt(2, viewport)).toBeGreaterThanOrEqual(gridColumnsAt(1, viewport))
      expect(gridColumnsAt(3, viewport)).toBeGreaterThanOrEqual(gridColumnsAt(2, viewport))
    }
  })

  it('caps the phone at two columns whatever the step', () => {
    // Six columns of maximal at 360px is a 55px card (TASK-0014 4장).
    for (const density of DENSITY_LEVELS) {
      expect(gridColumnsAt(density, 'base')).toBeLessThanOrEqual(2)
    }
  })
})

describe('defaults', () => {
  it('starts on the standard step', () => {
    // The one step that renders sensibly at every viewport, so a first paint
    // before the visitor's choice is known is never visibly wrong.
    expect(DEFAULT_DENSITY).toBe(2)
    expect(isDensityLevel(DEFAULT_DENSITY)).toBe(true)
  })
})
