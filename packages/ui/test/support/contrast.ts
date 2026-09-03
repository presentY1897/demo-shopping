/**
 * WCAG contrast for the OKLCH colours the token file is written in.
 *
 * The palette is authored in OKLCH because perceptually even steps are the whole
 * reason to pick a modern colour space, but WCAG 2.1 defines contrast over sRGB
 * relative luminance. Converting here — rather than eyeballing a swatch — is
 * what turns "AA compliant" into something CI can fail on.
 *
 * Conversion follows Björn Ottosson's published OKLab matrices.
 */

/** `oklch(L C H)` or `oklch(L C H / A)`. */
const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/

export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha: number
}

export function parseOklch(input: string): Oklch {
  const match = OKLCH.exec(input.trim())
  if (match === null) throw new Error(`Not an oklch() colour: "${input}"`)

  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Linear-light sRGB, clipped to the gamut a display can actually show. */
export function oklchToLinearSrgb(color: Oklch): readonly [number, number, number] {
  const radians = (color.h * Math.PI) / 180
  const a = color.c * Math.cos(radians)
  const b = color.c * Math.sin(radians)

  const lCone = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCone = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCone = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    clamp01(4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone),
    clamp01(-1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone),
    clamp01(-0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone),
  ]
}

/**
 * WCAG relative luminance. Linear-light sRGB *is* the gamma-expanded form the
 * WCAG formula asks for, so the coefficients apply directly.
 */
export function relativeLuminance(input: string): number {
  const [r, g, b] = oklchToLinearSrgb(parseOklch(input))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}
