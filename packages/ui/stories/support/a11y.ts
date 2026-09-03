/**
 * The accessibility rule set — declared once, used twice.
 *
 * The a11y addon shows the report beside the story so a violation is visible
 * while a component is being built. That is only half of what TASK-0104 asks
 * for: a panel nobody opens catches nothing, and TASK-0015 measured axe once in
 * a scratchpad browser and left no gate behind. `test/story-a11y.spec.tsx` runs
 * the same rules over every story inside `pnpm test`, so a violation fails CI.
 *
 * Both consumers read *this* file. If they configured axe separately, the panel
 * and the gate would eventually disagree, and the one that disagreed quietly
 * would be the gate.
 */

// Type-only: erased at build time, so the preview bundle does not carry axe
// twice (the addon ships its own copy).
import type { RunOptions, Spec } from 'axe-core'

/**
 * WCAG 2.1 A and AA, plus axe's best practices.
 *
 * AA is the bar `QUALITY-GATES.md` 2장 P2 sets (Lighthouse Accessibility 90+),
 * and best-practice is kept because the rules it adds — a nested-interactive
 * control, a duplicate id, an aria attribute on an element that cannot take one
 * — are defects in a component library even where WCAG is silent.
 */
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] as const

/**
 * Rules that describe a *page*, switched off because a story is a fragment.
 *
 * Each one would fail on every story for the same reason — there is no document
 * outline around a button — and a check that is red everywhere is a check
 * nobody reads. The pages these rules govern are the apps' own, and they are
 * covered by the Lighthouse pass in `QUALITY-GATES.md` 2장.
 */
export const A11Y_DISABLED_RULES = [
  'bypass',
  'document-title',
  'html-has-lang',
  'landmark-one-main',
  'page-has-heading-one',
  'region',
] as const

/** `axe.run` options — used by the CI gate and by the addon's panel alike. */
export const axeRunOptions: RunOptions = {
  runOnly: { type: 'tag', values: [...A11Y_TAGS] },
  rules: Object.fromEntries(A11Y_DISABLED_RULES.map((id) => [id, { enabled: false }])),
}

/** `axe.configure` spec, which is the shape the addon's `config` parameter takes. */
export const axeSpec: Spec = {
  rules: A11Y_DISABLED_RULES.map((id) => ({ id, enabled: false })),
}
