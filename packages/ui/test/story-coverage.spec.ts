/**
 * Every shipped component has a story (TASK-0104 F3).
 *
 * The list is not maintained here — it is read off the package's own public
 * surface. Add a component to `src/components/index.ts` or `src/form/index.ts`
 * and this fails until a story renders it, which is the rule TASK-0104 4장 asks
 * later component TASKs to carry: a story written with the component, not
 * afterwards.
 *
 * **Every public entry point that ships components has to be listed below.**
 * TASK-0017 added `@shopping/ui/form` and TASK-0018 added `@shopping/ui/layout`,
 * and until each was named here its components were exactly what this file
 * exists to prevent: shipped, exported, and outside the accessibility sweep.
 *
 * It is a source check, and `QUALITY-GATES.md` is right that asserting on class
 * names proves nothing about behaviour. This is not asserting a design; it is
 * asserting that a *documentation obligation* was met, which is exactly the kind
 * of rule no amount of clicking can observe. `test/story-a11y.spec.ts` is what
 * checks that the stories themselves work.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as componentSurface from '../src/components'
import * as formSurface from '../src/form'
import * as layoutSurface from '../src/layout'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORY_ROOT = join(PACKAGE_ROOT, 'stories', 'components')

/**
 * Exported values that render something.
 *
 * A capitalised function export is a component by React's own rule — the same
 * rule JSX uses to tell `<Button />` from `<button />` — so nothing here needs a
 * hand-written list of which exports count. `buttonClassName` and `useToast` are
 * functions too and are correctly not components.
 */
const COMPONENTS = [
  ...Object.entries(componentSurface),
  ...Object.entries(formSurface),
  ...Object.entries(layoutSurface),
]
  .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === 'function')
  .map(([name]) => name)

const STORY_FILES = readdirSync(STORY_ROOT)
  .filter((entry) => entry.endsWith('.stories.tsx'))
  .map((entry) => readFileSync(join(STORY_ROOT, entry), 'utf8'))

describe('the component surface', () => {
  it('was actually read', () => {
    // A barrel that failed to import would make every assertion below pass.
    expect(COMPONENTS.length).toBeGreaterThan(15)
  })

  it('has story files to check against', () => {
    expect(STORY_FILES.length).toBeGreaterThan(15)
  })
})

describe('story coverage', () => {
  it.each(COMPONENTS)('%s appears in a story', (name) => {
    const referenced = STORY_FILES.some((source) => new RegExp(`\\b${name}\\b`).test(source))
    expect(referenced).toBe(true)
  })
})
