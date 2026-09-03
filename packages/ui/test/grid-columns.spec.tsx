/**
 * TASK-0016 F4 — the grid draws the column count the density × viewport matrix
 * says it should.
 *
 * The matrix lives in three places by necessity: `docs/design/pages.md` states
 * it, `density.css` publishes it as `--density-cols`, and `src/density/density.ts`
 * restates it for the code that has to compute a number. `density-tokens.spec.ts`
 * already holds the last two together. What was still taken on trust is the
 * first link and the last: that the *documented* numbers are the ones in the
 * stylesheet, and that `Grid` actually reads the token rather than writing its
 * own `grid-cols-*` triple.
 *
 * So this file states the matrix as `docs/design/pages.md` prints it and walks
 * the whole chain — rendered `<Grid>` → class name → compiled declaration →
 * `--density-cols` at that density and width → number.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Grid } from '../src/components/grid'
import { DENSITY_GRID_COLUMNS, type DensityLevel } from '../src/density/density'
import { tokenNumber } from './support/css-tokens'
import { classNamesIn, compileClasses, declarationFor } from './support/tailwind'

/**
 * `docs/design/pages.md` 반응형 · 밀도 × 뷰포트, transcribed.
 *
 * Deliberately a fourth copy. Every other check in the repository compares two
 * implementations with each other, which cannot notice the two of them drifting
 * away from the design together. This is the one that fails if the *product
 * decision* changed and nobody updated the document — or the other way round.
 */
const DOCUMENTED_COLUMNS: Readonly<Record<DensityLevel, Readonly<Record<number, number>>>> = {
  1: { 360: 1, 768: 2, 1440: 3 },
  2: { 360: 2, 768: 3, 1440: 4 },
  3: { 360: 2, 768: 4, 1440: 6 },
}

const WIDTHS = [360, 768, 1440] as const

const CASES = Object.keys(DOCUMENTED_COLUMNS).flatMap((key) => {
  const density = Number(key) as DensityLevel
  return WIDTHS.map((width) => ({
    density,
    expected: DOCUMENTED_COLUMNS[density][width] ?? 0,
    width,
  }))
})

describe('Grid', () => {
  it('reads the column count from the density token', async () => {
    const { container } = render(<Grid>content</Grid>)
    const rules = await compileClasses(classNamesIn(container))

    // The alternative — `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` — is nine
    // cells written out by hand and a fourth place for the matrix to drift.
    expect(declarationFor(rules, 'grid-density', 'grid-template-columns')).toBe(
      'repeat(var(--density-cols), minmax(0, 1fr))',
    )
    expect(declarationFor(rules, 'grid-density', 'display')).toBe('grid')
  })

  it('still allows a fixed count for a console screen', async () => {
    const { container } = render(<Grid columns={4}>content</Grid>)
    const rules = await compileClasses(classNamesIn(container))

    expect(declarationFor(rules, 'grid-cols-4', 'grid-template-columns')).toBe(
      'repeat(4, minmax(0, 1fr))',
    )
  })

  it('keeps its gap on the spacing unit so it shrinks with the step', async () => {
    const { container } = render(<Grid gap="lg">content</Grid>)
    const rules = await compileClasses(classNamesIn(container))

    expect(declarationFor(rules, 'gap-6', 'gap')).toBe('calc(var(--space-unit) * 6)')
  })

  it('is a list when it holds list items', () => {
    render(
      <Grid as="ul">
        <li>One</li>
      </Grid>,
    )

    expect(screen.getByRole('list')).toBeInTheDocument()
  })
})

describe('the density × viewport matrix', () => {
  it.each(CASES)(
    'density $density at $width px resolves to $expected columns',
    ({ density, width, expected }) => {
      // The number the browser will substitute into the `repeat()` above.
      expect(tokenNumber('--density-cols', { density, width })).toBe(expected)
    },
  )

  it.each(CASES)(
    'density $density at $width px matches the TypeScript matrix too',
    ({ density, width, expected }) => {
      const band = width >= 1280 ? 'xl' : width >= 768 ? 'md' : 'base'
      expect(DENSITY_GRID_COLUMNS[density][band]).toBe(expected)
    },
  )
})
