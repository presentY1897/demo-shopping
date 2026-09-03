/**
 * Measures the density × viewport matrix by asking three real viewports.
 *
 * The matrix is two-dimensional (`density.css`): the step decides the scale, the
 * viewport band decides the grid, and the two only exist together. A page can
 * show the step it is currently rendering at — but the other six cells depend on
 * `@media` conditions, and a media query answers to the viewport and to nothing
 * else. No amount of nesting or class switching reproduces it.
 *
 * So the page measures the other bands where they are real: an off-screen
 * `<iframe>` sized to each band, carrying this document's own stylesheets, with
 * one probe per density step inside it. Every number in the matrix is a length
 * the browser laid out, at that width, under those media queries.
 *
 * The alternative was to parse the stylesheet and evaluate `calc()` by hand.
 * `test/support/css-tokens.ts` does exactly that, because in Node there is no
 * browser to ask — and it needs its own `calc`/`max` evaluator to do it. Copying
 * that evaluator into the documentation would put a second implementation of CSS
 * arithmetic between the reader and the truth.
 */

import {
  DENSITY_ATTRIBUTE,
  DENSITY_LEVELS,
  DENSITY_VIEWPORTS,
  DENSITY_VIEWPORT_MIN_WIDTH,
  type DensityLevel,
  type DensityViewport,
} from '../../src/density/density'

/**
 * Width probed for each band: the band's own lower edge, except for `base`,
 * whose edge is 0. 360px is the narrow probe `docs/design/pages.md` verifies at
 * and the width `apps/shop` is designed from.
 */
const PHONE_WIDTH = 360

export function probeWidthFor(viewport: DensityViewport): number {
  return Math.max(PHONE_WIDTH, DENSITY_VIEWPORT_MIN_WIDTH[viewport])
}

/** What one density step resolves to at one viewport width. */
export interface DensityMetrics {
  /** `--space-unit`, in px — the multiplier every spacing utility compiles against. */
  readonly spaceUnit: number
  /** `--font-scale`, unitless. */
  readonly fontScale: string
  /** `--radius-scale`, unitless. */
  readonly radiusScale: string
  /** `--density-cols` — how many columns `grid-density` draws. */
  readonly columns: string
  /** `--space-gutter`, in px. */
  readonly gutter: number
  /** `--touch-min`, in px. The floor, which no step may cross. */
  readonly touchMin: number
  /** `--spacing-control-sm | md | lg`, in px. */
  readonly controls: Readonly<Record<'sm' | 'md' | 'lg', number>>
  /** `--text-base`, in px — body copy at this step. */
  readonly baseText: number
}

export type DensityMatrix = Readonly<
  Record<DensityViewport, Readonly<Record<DensityLevel, DensityMetrics>>>
>

/**
 * Reads one density step at one viewport width.
 *
 * The step is set on the frame's `<html>`, not on a wrapper element inside it,
 * and that is load-bearing rather than tidy. Half of these tokens are declared
 * in an `@theme inline` block, which Tailwind emits onto `:root` — so
 * `var(--text-base)` substitutes `var(--font-scale)` *at `:root`*, whatever
 * element it is later used on. Measured from a nested scope, every step would
 * report the root's numbers and the matrix would be three identical columns.
 * Setting the attribute on the document root is also exactly what the apps do.
 */
function readMetrics(view: Window, doc: Document, level: DensityLevel): DensityMetrics {
  doc.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(level))

  const probe = doc.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  doc.body.append(probe)

  /** A custom property the browser resolved — numbers stay numbers. */
  const raw = (name: string): string =>
    view.getComputedStyle(doc.documentElement).getPropertyValue(name).trim()

  /**
   * A length, evaluated. Assigning the token to a real property is what makes
   * the browser run the `calc()` and the `max()`; reading the custom property
   * back would return the unevaluated expression.
   */
  const length = (expression: string): number => {
    probe.style.blockSize = expression
    return probe.getBoundingClientRect().height
  }

  const fontSize = (expression: string): number => {
    probe.style.fontSize = expression
    return Number.parseFloat(view.getComputedStyle(probe).fontSize)
  }

  const metrics: DensityMetrics = {
    baseText: fontSize('var(--text-base)'),
    columns: raw('--density-cols'),
    controls: {
      lg: length('var(--spacing-control-lg)'),
      md: length('var(--spacing-control-md)'),
      sm: length('var(--spacing-control-sm)'),
    },
    fontScale: raw('--font-scale'),
    gutter: length('var(--space-gutter)'),
    radiusScale: raw('--radius-scale'),
    spaceUnit: length('var(--space-unit)'),
    touchMin: length('var(--touch-min)'),
  }

  probe.remove()
  return metrics
}

/** Copies this document's stylesheets into the frame and waits for them. */
async function adoptStyles(source: Document, target: Document): Promise<void> {
  const pending: Promise<void>[] = []

  for (const node of source.querySelectorAll('style, link[rel="stylesheet"]')) {
    const clone = node.cloneNode(true)
    if (clone instanceof HTMLLinkElement && node instanceof HTMLLinkElement) {
      // The frame's base URL is not this document's, so the resolved href is
      // copied rather than the attribute as authored.
      clone.href = node.href
      pending.push(
        new Promise<void>((resolve) => {
          clone.addEventListener('load', () => {
            resolve()
          })
          clone.addEventListener('error', () => {
            resolve()
          })
        }),
      )
    }
    target.head.append(clone)
  }

  await Promise.all(pending)
}

/**
 * Measures every density step in every viewport band.
 *
 * Returns `null` where there is no layout to measure — jsdom, which the story
 * accessibility suite renders in. The documentation shows "—" there rather than
 * a number it did not observe.
 */
export async function measureDensityMatrix(
  source: Document = document,
): Promise<DensityMatrix | null> {
  const host = source.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.insetBlockStart = '0'
  host.style.insetInlineStart = '0'
  host.style.inlineSize = '0'
  host.style.blockSize = '0'
  host.style.overflow = 'hidden'
  host.style.pointerEvents = 'none'
  source.body.append(host)

  try {
    const bands: Partial<Record<DensityViewport, Record<DensityLevel, DensityMetrics>>> = {}

    for (const viewport of DENSITY_VIEWPORTS) {
      const frame = source.createElement('iframe')
      // Present for the accessibility checker even though the host is hidden.
      frame.title = `density probe · ${viewport}`
      frame.setAttribute('aria-hidden', 'true')
      frame.style.border = 'none'
      frame.style.inlineSize = `${String(probeWidthFor(viewport))}px`
      frame.style.blockSize = `${String(PHONE_WIDTH)}px`
      host.append(frame)

      const frameDocument = frame.contentDocument
      const frameWindow = frame.contentWindow
      if (frameDocument === null || frameWindow === null) return null

      await adoptStyles(source, frameDocument)

      // A scrollbar would take the viewport below the band edge being probed.
      frameDocument.body.style.margin = '0'
      frameDocument.body.style.overflow = 'hidden'

      const steps: Partial<Record<DensityLevel, DensityMetrics>> = {}
      for (const level of DENSITY_LEVELS)
        steps[level] = readMetrics(frameWindow, frameDocument, level)

      const [minimal, standard, maximal] = [steps[1], steps[2], steps[3]]
      if (minimal === undefined || standard === undefined || maximal === undefined) return null
      bands[viewport] = { 1: minimal, 2: standard, 3: maximal }
    }

    const [base, md, xl] = [bands.base, bands.md, bands.xl]
    if (base === undefined || md === undefined || xl === undefined) return null

    // A `--space-unit` of zero means no stylesheet reached the frame; reporting
    // that as a measurement would be worse than reporting nothing.
    if (base[2].spaceUnit === 0) return null

    return { base, md, xl }
  } finally {
    host.remove()
  }
}
