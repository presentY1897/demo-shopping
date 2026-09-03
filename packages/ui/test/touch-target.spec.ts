/**
 * The 44px floor, tied to the classes the components actually write.
 *
 * `density-tokens.spec.ts` already proves that `--spacing-control-*` and
 * `--touch-min` never drop below 44px at any density × viewport pair. That is
 * only half the promise: it says the tokens are safe, not that the components
 * use them. This file closes the loop from the other end — it reads the shipped
 * component sources, collects the size utility each interactive control names,
 * and evaluates that utility's token against the real stylesheet.
 *
 * It is a source check, and QUALITY-GATES is right that a test asserting class
 * names proves nothing about behaviour. This one is not asserting a design; it
 * is asserting a *policy* — "an interactive box states its floor" — which is
 * exactly the kind of rule that cannot be observed by clicking, and which jsdom
 * (no layout, no stylesheet) cannot measure. The rendered pixels were verified
 * separately in a browser; this is what keeps them verified.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DENSITY_LEVELS, type DensityLevel } from '../src/density/density'
import { tokenLength } from './support/css-tokens'

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components')

const TOUCH_FLOOR = 44

/** Every size utility a component is allowed to give an interactive box. */
const FLOOR_UTILITIES: Readonly<Record<string, string>> = {
  'h-control-lg': '--spacing-control-lg',
  'h-control-md': '--spacing-control-md',
  'h-control-sm': '--spacing-control-sm',
  'min-h-control-lg': '--spacing-control-lg',
  'min-h-touch': '--spacing-touch',
  'size-control-lg': '--spacing-control-lg',
  'size-control-md': '--spacing-control-md',
  'size-control-sm': '--spacing-control-sm',
  'touch-target': '--touch-min',
}

/**
 * The components that render something a finger has to land on.
 *
 * `link.tsx` is deliberately absent: WCAG 2.5.8 exempts a link inside a
 * sentence, and padding an inline link to 44px would break the line box it sits
 * in. `badge`, `avatar` and `divider` render nothing interactive at all.
 */
const INTERACTIVE = [
  'accordion.tsx',
  'button.tsx',
  'checkbox.tsx',
  'icon-button.tsx',
  'input.tsx',
  'radio-group.tsx',
  'select.tsx',
  'switch.tsx',
  'tabs.tsx',
  'tag.tsx',
  'textarea.tsx',
]

const PROBE_WIDTHS = [360, 768, 1440]

function utilitiesIn(file: string): readonly string[] {
  const source = readFileSync(join(COMPONENTS, file), 'utf8')
  return Object.keys(FLOOR_UTILITIES).filter((utility) =>
    new RegExp(`(?:^|[\\s'"\`])${utility}(?:[\\s'"\`]|$)`, 'm').test(source),
  )
}

describe('every interactive component states its touch floor', () => {
  it.each(INTERACTIVE)('%s names at least one floor utility', (file) => {
    expect(utilitiesIn(file)).not.toEqual([])
  })
})

describe('every floor utility clears 44px', () => {
  const combinations = DENSITY_LEVELS.flatMap((density: DensityLevel) =>
    PROBE_WIDTHS.map((width) => ({ density, width })),
  )

  it.each(combinations)(
    'density $density at $width px holds every utility a component uses',
    ({ density, width }) => {
      // `select.tsx` reuses `input.tsx`'s size map, so the union across the
      // interactive set is the set of utilities that can reach a rendered box.
      const used = new Set(INTERACTIVE.flatMap(utilitiesIn))
      expect(used.size).toBeGreaterThan(0)

      for (const utility of used) {
        const token = FLOOR_UTILITIES[utility]
        expect(token).toBeDefined()
        expect(tokenLength(token ?? '', { density, width })).toBeGreaterThanOrEqual(TOUCH_FLOOR)
      }
    },
  )
})
