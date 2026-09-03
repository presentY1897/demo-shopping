/**
 * Colour contrast, computed from the OKLCH values in the token file.
 *
 * TASK-0014 F6 asks for WCAG AA on text/background combinations. "We checked in
 * a contrast tool" is a claim that expires the next time someone nudges a
 * lightness value, so the conversion happens here and CI owns the answer.
 *
 * The per-app accents are checked too: `--color-primary` is the one token each
 * app overrides, so its ramp is where a contrast regression would arrive.
 */

import { describe, expect, it } from 'vitest'

import { contrastRatio } from './support/contrast'
import { resolvedValue } from './support/css-tokens'

/** Contrast does not vary by density, so any single context resolves the palette. */
const CONTEXT = { density: 2, width: 1440 } as const

const AA_NORMAL = 4.5
const NON_TEXT = 3

function ratio(foreground: string, background: string): number {
  return contrastRatio(resolvedValue(foreground, CONTEXT), resolvedValue(background, CONTEXT))
}

/** Every pair a component is allowed to produce with the semantic text tokens. */
const TEXT_PAIRS = [
  ['--color-fg', '--color-surface'],
  ['--color-fg', '--color-surface-sunken'],
  ['--color-fg', '--color-surface-muted'],
  ['--color-fg-muted', '--color-surface'],
  ['--color-fg-muted', '--color-surface-sunken'],
  ['--color-fg-muted', '--color-surface-muted'],
  ['--color-fg-subtle', '--color-surface'],
  ['--color-fg-subtle', '--color-surface-sunken'],
  ['--color-fg-subtle', '--color-surface-muted'],
  ['--color-fg-inverse', '--color-surface-inverse'],
  ['--color-muted-fg', '--color-muted'],
  ['--color-primary', '--color-surface'],
  ['--color-danger', '--color-surface'],
  ['--color-primary-fg', '--color-primary'],
  ['--color-primary-fg', '--color-primary-strong'],
  ['--color-danger-fg', '--color-danger'],
  ['--color-danger-fg', '--color-danger-strong'],
  ['--color-success-fg', '--color-success'],
  ['--color-warning-fg', '--color-warning'],
  ['--color-fg', '--color-primary-surface'],
  ['--color-fg', '--color-danger-surface'],
  ['--color-fg', '--color-success-surface'],
  ['--color-fg', '--color-warning-surface'],
] as const

/**
 * The accents the three apps swap into `--color-primary`. Each is checked
 * against white, which is `--color-primary-fg` for all of them.
 */
const APP_ACCENTS = ['--color-blue-500', '--color-teal-500', '--color-violet-500'] as const

describe('the OKLCH conversion', () => {
  // Anchors for the maths in test/support/contrast.ts. Without these a bug in
  // the conversion would quietly turn every assertion below into a pass.
  it('puts black on white at the 21:1 ceiling', () => {
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 1)
  })

  it('puts a colour against itself at 1:1', () => {
    expect(contrastRatio('oklch(0.5 0.18 265)', 'oklch(0.5 0.18 265)')).toBeCloseTo(1, 5)
  })

  it('does not care which argument is the lighter one', () => {
    expect(contrastRatio('oklch(0.2 0 0)', 'oklch(0.9 0 0)')).toBeCloseTo(
      contrastRatio('oklch(0.9 0 0)', 'oklch(0.2 0 0)'),
      10,
    )
  })

  it('rejects a colour it cannot read rather than scoring it', () => {
    expect(() => contrastRatio('#3355ff', 'oklch(1 0 0)')).toThrow(/oklch/)
  })
})

describe('WCAG AA on text', () => {
  it.each(TEXT_PAIRS)('%s on %s clears 4.5:1', (foreground, background) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it.each(APP_ACCENTS)('%s carries white text at AA', (accent) => {
    // shop / seller / admin each override `--color-primary` with one of these.
    expect(ratio('--color-primary-fg', accent)).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('WCAG 1.4.11 on interactive boundaries', () => {
  it.each([
    ['--color-border-interactive', '--color-surface'],
    ['--color-ring', '--color-surface'],
  ])('%s on %s clears 3:1', (foreground, background) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(NON_TEXT)
  })
})

describe('the semantic layer', () => {
  it('never resolves a role to a raw literal', () => {
    // A role that stopped pointing at the palette is how a redesign turns into
    // a search-and-replace across every component.
    for (const [foreground, background] of TEXT_PAIRS) {
      expect(resolvedValue(foreground, CONTEXT)).toMatch(/^oklch\(/)
      expect(resolvedValue(background, CONTEXT)).toMatch(/^oklch\(/)
    }
  })

  it('keeps the status colours as aliases of the semantic ones', () => {
    // Otherwise "degraded" and "warning" become two different yellows.
    expect(resolvedValue('--color-status-ok', CONTEXT)).toBe(
      resolvedValue('--color-success', CONTEXT),
    )
    expect(resolvedValue('--color-status-degraded', CONTEXT)).toBe(
      resolvedValue('--color-warning', CONTEXT),
    )
    expect(resolvedValue('--color-status-down', CONTEXT)).toBe(
      resolvedValue('--color-danger', CONTEXT),
    )
  })
})
