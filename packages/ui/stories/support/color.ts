/**
 * Colour resolution and WCAG contrast, computed in the browser at render time.
 *
 * `test/color-tokens.spec.ts` already converts the OKLCH literals in Node and
 * fails CI when a pair drops below its threshold — that file is the gate. This
 * one is the *view*: it asks the browser what it painted, so the ratio beside a
 * swatch is the ratio of the colour on screen rather than of a number copied out
 * of the token file.
 *
 * The conversion goes through a 1×1 canvas rather than through a parser. The
 * palette is authored in OKLCH, the overlay is a `color-mix()`, and a component
 * may resolve to any of them; writing a parser here would mean maintaining a
 * second colour implementation whose bugs would show up as wrong ratios in the
 * documentation, which is the one place they must not.
 */

/** Straight (non-premultiplied) sRGB, channels 0–255, alpha 0–1. */
export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Two probes rather than one: a value equal to the probe would look like a
 * rejected value if only one were used.
 */
const PROBES = ['red', 'blue'] as const

const CONTEXTS = new WeakMap<Document, CanvasRenderingContext2D | null>()

function contextFor(doc: Document): CanvasRenderingContext2D | null {
  const cached = CONTEXTS.get(doc)
  if (cached !== undefined) return cached

  const canvas = doc.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  // `null` under jsdom, which ships no canvas. The documentation degrades to
  // "no ratio available" there instead of throwing, so the a11y suite can still
  // render these stories.
  const context = canvas.getContext('2d')
  CONTEXTS.set(doc, context)
  return context
}

/** Any CSS colour the browser accepts, as numbers. `null` if it is not a colour. */
export function resolveColor(value: string, doc: Document = document): Rgba | null {
  const context = contextFor(doc)
  if (context === null || value === '') return null

  let accepted = false
  for (const probe of PROBES) {
    context.fillStyle = probe
    const before = context.fillStyle
    context.fillStyle = value
    if (context.fillStyle !== before) {
      accepted = true
      break
    }
  }
  if (!accepted) return null

  context.clearRect(0, 0, 1, 1)
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
  if (r === undefined || g === undefined || b === undefined || alpha === undefined) return null

  return { a: alpha / 255, b, g, r }
}

/** Source-over composite, for the one token that is deliberately translucent. */
export function over(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a + background.a * (1 - foreground.a)
  if (a === 0) return { a: 0, b: 0, g: 0, r: 0 }

  const mix = (f: number, b: number): number =>
    (f * foreground.a + b * background.a * (1 - foreground.a)) / a

  return {
    a,
    b: mix(foreground.b, background.b),
    g: mix(foreground.g, background.g),
    r: mix(foreground.r, background.r),
  }
}

function channel(value: number): number {
  const scaled = value / 255
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA for body text. */
export const AA_TEXT = 4.5

/** WCAG 1.4.11, for a boundary the user has to be able to find. */
export const AA_NON_TEXT = 3

export interface ContrastPair {
  readonly foreground: string
  readonly background: string
  readonly minimum: number
}

const SURFACE_PREFIX = '--color-surface'
const FOREGROUND_PREFIX = '--color-fg'
const INVERSE_SUFFIX = '-inverse'
const FOREGROUND_SUFFIX = '-fg'
const TINTED_SUFFIX = '-surface'

/**
 * Accent roles a component also renders as *text* — a link, an inline error —
 * rather than only as a fill. Named rather than derived because it is a
 * statement about how components use the role, which the token names do not
 * carry. Kept in step with `test/color-tokens.spec.ts`, which fails on these.
 */
const TEXT_ACCENTS = ['--color-primary', '--color-danger'] as const

/**
 * Boundaries held to WCAG 1.4.11 instead of 4.5:1. `--color-border` is absent on
 * purpose: a decorative rule between two paragraphs is exempt, and giving it a
 * contrast requirement would push every divider on the site darker.
 */
const NON_TEXT_ROLES = ['--color-border-interactive', '--color-ring'] as const

/**
 * The pairs a component can actually produce, derived from the token names.
 *
 * Derived rather than listed: `--color-danger-fg` is the foreground *for*
 * `--color-danger` because of how the two are named, and a role added to
 * `tokens.css` tomorrow arrives here on its own. A hand-written list would be
 * the third copy of the semantic layer.
 */
export function deriveContrastPairs(names: readonly string[]): readonly ContrastPair[] {
  const has = (name: string): boolean => names.includes(name)
  const pairs: ContrastPair[] = []
  const add = (foreground: string, background: string, minimum: number): void => {
    if (!has(foreground) || !has(background)) return
    if (pairs.some((pair) => pair.foreground === foreground && pair.background === background))
      return
    pairs.push({ background, foreground, minimum })
  }

  const surfaces = names.filter(
    (name) => name.startsWith(SURFACE_PREFIX) && !name.endsWith(INVERSE_SUFFIX),
  )
  const tinted = names.filter(
    (name) => name.endsWith(TINTED_SUFFIX) && !name.startsWith(SURFACE_PREFIX),
  )

  // Neutral text on every neutral surface, and the inverse pair on its own.
  for (const foreground of names) {
    if (!foreground.startsWith(FOREGROUND_PREFIX)) continue
    if (foreground.endsWith(INVERSE_SUFFIX)) {
      add(foreground, `${SURFACE_PREFIX}${INVERSE_SUFFIX}`, AA_TEXT)
      continue
    }
    for (const background of surfaces) add(foreground, background, AA_TEXT)
  }

  // `--color-X-fg` is the foreground for `--color-X`, and for its strong step.
  for (const foreground of names) {
    if (!foreground.endsWith(FOREGROUND_SUFFIX)) continue
    const role = foreground.slice(0, -FOREGROUND_SUFFIX.length)
    if (role === '--color') continue
    add(foreground, role, AA_TEXT)
    add(foreground, `${role}-strong`, AA_TEXT)
  }

  // Default text on a tinted surface — what every `Badge` variant renders.
  for (const background of tinted) add(FOREGROUND_PREFIX, background, AA_TEXT)

  for (const foreground of TEXT_ACCENTS) add(foreground, SURFACE_PREFIX, AA_TEXT)
  for (const foreground of NON_TEXT_ROLES) add(foreground, SURFACE_PREFIX, AA_NON_TEXT)

  return pairs
}

/** What the browser resolved a colour token to, and whether that depended on context. */
export interface ComputedColor {
  readonly value: string
  /**
   * True for `currentColor` and `inherit`: tokens that live in the colour
   * namespace but are not colours, because what they resolve to is decided by
   * whatever they were used inside.
   */
  readonly contextual: boolean
}

/**
 * The colour the browser resolved for each token, as it reports it.
 *
 * Read off probe elements rather than computed here: `getComputedStyle` is what
 * the rendering engine says it painted, which is the only authority a page
 * documenting the palette should be quoting.
 *
 * Two probes, under two different inherited colours. A token that answers
 * differently in the two is context dependent — which is how `--color-current`
 * and `--color-inherit` are told apart from the palette without this file
 * knowing their names.
 */
export function readComputedColors(
  host: HTMLElement,
  names: readonly string[],
): ReadonlyMap<string, ComputedColor> {
  const doc = host.ownerDocument
  const view = doc.defaultView
  const computed = new Map<string, ComputedColor>()
  if (view === null) return computed

  const probes = PROBES.map((inherited) => {
    const parent = doc.createElement('div')
    parent.style.position = 'absolute'
    parent.style.visibility = 'hidden'
    parent.style.color = inherited
    const probe = doc.createElement('div')
    parent.append(probe)
    host.append(parent)
    return { parent, probe }
  })

  for (const name of names) {
    const readings = probes.map(({ probe }) => {
      probe.style.color = `var(${name})`
      return view.getComputedStyle(probe).color
    })
    const [first, second] = readings
    computed.set(name, {
      contextual: first !== second,
      value: first ?? '',
    })
  }

  for (const { parent } of probes) parent.remove()
  return computed
}
