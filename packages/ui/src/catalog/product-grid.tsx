'use client'

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import type { DensityLevel } from '../density/density'
import { DENSITY_GRID_COLUMNS, DENSITY_VIEWPORT_MIN_WIDTH } from '../density/density'

/**
 * 상품 그리드 — 밀도 × 뷰포트 매트릭스 (TASK-0040 4장).
 *
 * **The column counts are `DENSITY_GRID_COLUMNS`, not numbers written here.**
 * That table is `packages/ui/src/density/density.ts`'s and is the same one
 * `docs/design/pages.md` documents; a grid with its own copy would be the second
 * definition, and the one that stops matching the design document.
 *
 * **The classes are written out rather than built.** Tailwind scans source text,
 * so `grid-cols-${n}` produces a class that exists in the markup and in no
 * stylesheet — the grid then falls back to one column and looks like a
 * responsive bug. Listing them is what makes them real.
 */

/** `density → viewport → class`, derived from the matrix so they cannot drift. */
const COLUMN_CLASS: Readonly<Record<number, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  6: 'grid-cols-6',
}

const MD_COLUMN_CLASS: Readonly<Record<number, string>> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
}

const XL_COLUMN_CLASS: Readonly<Record<number, string>> = {
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  6: 'xl:grid-cols-6',
}

/** How the columns are spelled for one density. */
export function gridColumnsClass(density: DensityLevel): string {
  const columns = DENSITY_GRID_COLUMNS[density]

  return cx(COLUMN_CLASS[columns.base], MD_COLUMN_CLASS[columns.md], XL_COLUMN_CLASS[columns.xl])
}

/** The `sizes` attribute an image in this grid should carry. */
export function gridImageSizes(density: DensityLevel): string {
  const columns = DENSITY_GRID_COLUMNS[density]

  // Widest first: the browser takes the first matching clause, so a narrow one
  // above a wide one would make the wide one unreachable.
  //
  // The breakpoints come from `DENSITY_VIEWPORT_MIN_WIDTH` rather than being
  // written here — the same table the grid's columns come from, and the same one
  // `component-tokens.spec.ts` exists to stop being copied.
  const share = (count: number): string => `${String(Math.floor(100 / count))}vw`

  return [
    `(min-width: ${String(DENSITY_VIEWPORT_MIN_WIDTH.xl)}px) ${share(columns.xl)}`,
    `(min-width: ${String(DENSITY_VIEWPORT_MIN_WIDTH.md)}px) ${share(columns.md)}`,
    share(columns.base),
  ].join(', ')
}

export interface ProductGridProps {
  readonly density: DensityLevel
  readonly children: ReactNode
  /** Accessible name — "검색 결과", "코트 상품 목록". */
  readonly label: string
  readonly className?: string
}

export function ProductGrid({ density, children, label, className }: ProductGridProps) {
  return (
    <ul
      aria-label={label}
      className={cx('grid gap-3 md:gap-4', gridColumnsClass(density), className)}
      data-density={density}
    >
      {children}
    </ul>
  )
}
