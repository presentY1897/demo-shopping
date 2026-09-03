/**
 * Display density — the pure part.
 *
 * A shopper picks one of three steps and the whole of `apps/shop` answers
 * (DECISIONS 1장, D-033); the console apps pin themselves to step 2 and never
 * show the toggle. The visual side of that lives in CSS
 * (`@shopping/config/tailwind/density.css`) — this module holds only what
 * JavaScript has to know: which values are legal, what the grid does at each
 * viewport, and where the choice is stored.
 *
 * Nothing here touches the DOM or React, so a server component can import it.
 */

/** The three steps, in the order a toggle should offer them. */
export const DENSITY_LEVELS = [1, 2, 3] as const

/** 1 minimal (widest) · 2 standard · 3 maximal (densest). */
export type DensityLevel = (typeof DENSITY_LEVELS)[number]

/**
 * What a visitor sees before they have chosen anything, and the value the server
 * renders. Step 2 rather than 1: the standard step is the one every viewport and
 * every screen size renders sensibly, so an unstyled first paint is never wrong
 * in a way the visitor notices.
 */
export const DEFAULT_DENSITY: DensityLevel = 2

/**
 * Seller and admin are fixed here and show no toggle (D-033): an operations
 * screen wants maximum information every time, and the choice would be one more
 * thing to get wrong before a support call.
 */
export const CONSOLE_DENSITY: DensityLevel = 2

/** Set on `<html>`; every density token keys off it. */
export const DENSITY_ATTRIBUTE = 'data-density'

/**
 * localStorage key for a visitor who is not signed in. A signed-in shopper's
 * choice belongs to `UserPreference` on the server (DECISIONS 1장) and arrives
 * as `serverDensity`; this is the anonymous fallback.
 *
 * Namespaced because the three apps are served from three subdomains of one
 * registrable domain and a bare `density` would be one bad cookie policy away
 * from meaning something else.
 */
export const DENSITY_STORAGE_KEY = 'shopping.shop.density'

/**
 * The three viewport bands the density matrix is defined over. They are the
 * bands, not every Tailwind breakpoint: `docs/design/pages.md` verifies at
 * 360 / 768 / 1440px, which lands one probe in each.
 */
export const DENSITY_VIEWPORTS = ['base', 'md', 'xl'] as const

export type DensityViewport = (typeof DENSITY_VIEWPORTS)[number]

/** Lower bound of each band, matching the `@media` queries in `density.css`. */
export const DENSITY_VIEWPORT_MIN_WIDTH: Readonly<Record<DensityViewport, number>> = {
  base: 0,
  md: 768,
  xl: 1280,
}

/**
 * Product-grid columns, density × viewport.
 *
 * **Density alone cannot decide this.** Six columns of maximal at 360px is a
 * 55px card, which is not a product card. The CSS carries the same matrix as
 * `--density-cols`; this copy exists for the code that has to compute a number —
 * an image `sizes` attribute, a skeleton count, a virtualised list. The two are
 * kept honest by `test/density-tokens.spec.ts`, which parses the stylesheet and
 * fails if they disagree.
 */
export const DENSITY_GRID_COLUMNS: Readonly<
  Record<DensityLevel, Readonly<Record<DensityViewport, number>>>
> = {
  1: { base: 1, md: 2, xl: 3 },
  2: { base: 2, md: 3, xl: 4 },
  3: { base: 2, md: 4, xl: 6 },
}

export function isDensityLevel(value: unknown): value is DensityLevel {
  return value === 1 || value === 2 || value === 3
}

/**
 * Reads a density out of anything that crossed a boundary — a DOM attribute,
 * localStorage, a query string, a JSON body. Returns `null` rather than the
 * default so the caller decides what a missing value means; `?? DEFAULT_DENSITY`
 * is one character and being handed a silent default is not.
 */
export function parseDensityLevel(value: unknown): DensityLevel | null {
  if (isDensityLevel(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null

  const parsed = Number(value)
  return isDensityLevel(parsed) ? parsed : null
}

/**
 * The band a viewport width falls in. A non-finite width (an unmeasured
 * container, a server render with no window) resolves to `base`, which is the
 * mobile-first answer: `apps/shop` is mobile first (DECISIONS 1장), so the
 * narrow layout is the one that is safe to guess.
 */
export function densityViewportFor(width: number): DensityViewport {
  if (!Number.isFinite(width)) return 'base'
  if (width >= DENSITY_VIEWPORT_MIN_WIDTH.xl) return 'xl'
  if (width >= DENSITY_VIEWPORT_MIN_WIDTH.md) return 'md'
  return 'base'
}

/** Columns for a step in a named band. */
export function gridColumnsAt(density: DensityLevel, viewport: DensityViewport): number {
  return DENSITY_GRID_COLUMNS[density][viewport]
}

/** Columns for a step at a measured viewport width. */
export function gridColumnsFor(density: DensityLevel, width: number): number {
  return gridColumnsAt(density, densityViewportFor(width))
}
