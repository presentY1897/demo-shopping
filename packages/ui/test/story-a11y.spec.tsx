/**
 * axe over every story, inside `pnpm test`, which is what CI runs.
 *
 * **This is the gate TASK-0015 did not leave behind.** That TASK measured
 * Lighthouse Accessibility at 100 and axe violations at 0 — once, in a
 * scratchpad browser, by hand. A measurement is not a gate: the day after it was
 * taken, an `aria-label` could come off an icon button and every check in the
 * repository would still be green. This file closes that: a violation in any
 * story fails `test`, which is a required check on `main`.
 *
 * It runs the stories as *portable stories* rather than through a browser
 * runner. `composeStories` applies the same decorators, args and globals the
 * Storybook UI applies, so what is asserted here is what a reader sees — and it
 * runs inside the Vitest suite this package already has, so the gate needed no
 * new CI job, no browser download and no second place for the rule set to live.
 *
 * **What jsdom cannot check.** There is no layout and no CSS, so `color-contrast`
 * comes back "incomplete" rather than passing or failing. That rule is the one
 * axe check this project already enforces elsewhere: `test/color-tokens.spec.ts`
 * converts the OKLCH palette and fails below 4.5:1, over more pairs than a
 * rendered story would exercise. Everything axe checks structurally — names,
 * roles, labels, relationships, focus order, duplicate ids — is checked here.
 */

import { render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import * as previewAnnotations from '../.storybook/preview'
import { axeRunOptions } from '../stories/support/a11y'

/**
 * The addon's rule set, minus the one rule jsdom cannot answer.
 *
 * `color-contrast` needs a rendered box and a painted canvas; jsdom has neither,
 * so axe reaches for `getContext('2d')`, is refused, and returns the rule as
 * "incomplete" — a result that is neither a pass nor a failure and cannot gate
 * anything. Contrast is not left unchecked: `test/color-tokens.spec.ts` converts
 * the OKLCH palette and fails below 4.5:1 over more pairs than a story would
 * exercise, and the Storybook panel still runs the rule in a real browser.
 */
const JSDOM_OPTIONS: typeof axeRunOptions = {
  ...axeRunOptions,
  rules: { ...axeRunOptions.rules, 'color-contrast': { enabled: false } },
}

// The density decorator and the global defaults, so a story is composed exactly
// as the Storybook UI would compose it.
setProjectAnnotations([previewAnnotations])

type StoryModule = Parameters<typeof composeStories>[0]

const modules = import.meta.glob<StoryModule>('../stories/**/*.stories.tsx', { eager: true })

/**
 * `composeStories` is generic over the module's own exports, which a sweep that
 * loads modules by glob does not have. Naming the result here is what the
 * generic would have inferred from a literal import: every composed value is a
 * story rendered as a component.
 */
function compose(module: StoryModule): Record<string, ComponentType> {
  return composeStories(module) as Record<string, ComponentType>
}

/**
 * Reports the rule, the selector and axe's own summary.
 *
 * A bare count tells whoever broke it nothing; this prints the element and what
 * to do about it, which is the difference between a gate that gets fixed and one
 * that gets skipped.
 */
function describeViolations(violations: readonly axe.Result[]): readonly string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id}: ${node.target.join(' ')} — ${node.failureSummary ?? violation.help}`,
    ),
  )
}

describe('the story sweep', () => {
  it('found the stories', () => {
    // A glob that matched nothing would make every assertion below vacuous, and
    // a vacuous accessibility gate is worse than none: it reports green.
    expect(Object.keys(modules).length).toBeGreaterThan(20)
  })
})

for (const [path, module] of Object.entries(modules)) {
  const stories = compose(module)

  describe(path, () => {
    for (const [name, Story] of Object.entries(stories)) {
      it(`${name} has no accessibility violations`, async () => {
        render(<Story />)

        // `document.body`, not the render container: modals, drawers, tooltips,
        // popovers and toasts all render through a portal, and scoping the scan
        // to the container would silently skip the components most likely to
        // have an accessibility defect.
        const results = await axe.run(document.body, JSDOM_OPTIONS)

        expect(describeViolations(results.violations)).toEqual([])
      })
    }
  })
}
