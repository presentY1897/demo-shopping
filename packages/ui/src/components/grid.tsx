/**
 * The product grid, with the column count coming from the density × viewport
 * matrix rather than from a prop.
 *
 * `docs/design/pages.md` 반응형 defines nine cells — three density steps × three
 * viewport bands — and writing them as `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
 * would mean writing that triple out once per step and keeping three copies in
 * step with the CSS. `density.css` already publishes the answer as
 * `--density-cols`, and the `grid-density` utility reads it, so the whole matrix
 * is one class.
 *
 * The chain is closed by tests rather than by trust:
 *   - `test/grid-columns.spec.tsx` compiles the class this component renders and
 *     checks the declaration is `repeat(var(--density-cols), …)`
 *   - `test/density-tokens.spec.ts` resolves `--density-cols` out of the real
 *     stylesheet at each density × width and checks it against the matrix in
 *     `src/density/density.ts`
 *
 * A fixed column count is still available for the console screens, which pin
 * themselves to density 2 and lay out forms rather than products.
 *
 * Server-renderable.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

/** `'density'` is the matrix; a number is a fixed count at every viewport. */
export const GRID_COLUMNS = ['density', 1, 2, 3, 4, 5, 6] as const
export type GridColumns = (typeof GRID_COLUMNS)[number]

export const GRID_GAPS = ['sm', 'md', 'lg'] as const
export type GridGap = (typeof GRID_GAPS)[number]

/** `ul`/`ol` so a grid of cards can be a list a screen reader can count. */
export const GRID_ELEMENTS = ['div', 'ul', 'ol'] as const
export type GridElement = (typeof GRID_ELEMENTS)[number]

const COLUMN_STYLES: Readonly<Record<GridColumns, string>> = {
  density: 'grid-density',
  1: 'grid grid-cols-1',
  2: 'grid grid-cols-2',
  3: 'grid grid-cols-3',
  4: 'grid grid-cols-4',
  5: 'grid grid-cols-5',
  6: 'grid grid-cols-6',
}

/** Gaps are `--space-unit` multiples, so the gutter shrinks with the step too. */
const GAP_STYLES: Readonly<Record<GridGap, string>> = {
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
}

export interface GridProps {
  readonly children: ReactNode
  readonly columns?: GridColumns
  readonly gap?: GridGap
  readonly as?: GridElement
  readonly className?: string
}

export function Grid({
  children,
  columns = 'density',
  gap = 'md',
  as = 'div',
  className,
}: GridProps) {
  const Tag = as

  return (
    <Tag
      className={cx(COLUMN_STYLES[columns], GAP_STYLES[gap], 'w-full', className)}
      // Tailwind's preflight removes the list marker, and a list with no marker
      // stops being announced as a list in Safari + VoiceOver. Restating the
      // role is the documented fix; it also means the children have to be list
      // items, which is what `Card as="li"` is for.
      role={as === 'div' ? undefined : 'list'}
    >
      {children}
    </Tag>
  )
}
