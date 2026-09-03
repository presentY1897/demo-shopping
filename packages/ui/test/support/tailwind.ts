/**
 * Compiles utility classes with the real Tailwind, so a test can assert what a
 * class *does* instead of that it is spelled a certain way.
 *
 * QUALITY-GATES is right that asserting class names proves nothing: `sticky` in
 * a string is not `position: sticky` in a browser, and a renamed utility, a typo
 * or a utility that this project's preset never generates all look identical to
 * a `toContain('sticky')`. jsdom cannot close that gap either — it applies no
 * stylesheet and performs no layout.
 *
 * So this runs the actual compiler over the actual preset and hands back the
 * declarations and the enclosing at-rules. That is what lets
 * `container-query.spec.tsx` state the thing that matters — the card's layout
 * switch compiles to `@container`, not to `@media` — as an observation rather
 * than as a comment.
 *
 * The class names come out of the rendered DOM (`classNamesIn`), not out of the
 * component source, so the chain runs component → React → class → CSS with no
 * step taken on trust.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import postcss, { type Container } from 'postcss'
import { compile } from 'tailwindcss'

const require = createRequire(import.meta.url)

/** Exactly what an app's `globals.css` imports, and in the same order. */
const ENTRY_CSS = "@import 'tailwindcss';\n@import '@shopping/config/tailwind/preset.css';\n"

function loadStylesheet(id: string, base: string) {
  const path = id.startsWith('.')
    ? resolve(base, id)
    : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)

  return Promise.resolve({ base: dirname(path), content: readFileSync(path, 'utf8'), path })
}

type Compiler = Awaited<ReturnType<typeof compile>>

let compiler: Promise<Compiler> | null = null

/**
 * One compiler for the whole suite. Building the preset takes long enough that
 * doing it per assertion would be felt, and `build()` is incremental by design.
 */
function getCompiler(): Promise<Compiler> {
  compiler ??= compile(ENTRY_CSS, {
    base: dirname(require.resolve('@shopping/config/tailwind/preset.css')),
    loadModule: () => Promise.reject(new Error('The preset loads no JavaScript plugins')),
    loadStylesheet,
  })
  return compiler
}

export interface CompiledRule {
  /** Enclosing at-rules, outermost first — `@media (width >= 48rem)`, `@container card (width >= 28rem)`. */
  readonly conditions: readonly string[]
  readonly selector: string
  readonly declarations: Readonly<Record<string, string>>
}

/** Every rule the preset emits for these candidates, flattened. */
export async function compileClasses(
  candidates: readonly string[],
): Promise<readonly CompiledRule[]> {
  const css = (await getCompiler()).build([...candidates])
  const rules: CompiledRule[] = []

  function visit(container: Container, conditions: readonly string[]): void {
    for (const node of container.nodes ?? []) {
      if (node.type === 'rule') {
        const declarations: Record<string, string> = {}
        for (const child of node.nodes) {
          if (child.type === 'decl') declarations[child.prop] = child.value
        }
        rules.push({ conditions, declarations, selector: node.selector })
        // CSS nesting: a style rule can hold rules of its own.
        visit(node, conditions)
        continue
      }

      if (node.type === 'atrule') {
        // `@layer` narrows nothing; keeping it would make every rule look
        // conditional. Media, container and supports are the ones that decide.
        const condition = node.name === 'layer' ? null : `@${node.name} ${node.params}`.trim()
        visit(node, condition === null ? conditions : [...conditions, condition])
      }
    }
  }

  visit(postcss.parse(css, { from: undefined }), [])
  return rules
}

/** Tailwind escapes `@`, `/`, `:` and `.` in selectors; this reads them back. */
function unescape(selector: string): string {
  return selector.replace(/\\/g, '')
}

/** The rules that style exactly this class (including its pseudo-class forms). */
export function rulesForClass(
  rules: readonly CompiledRule[],
  className: string,
): readonly CompiledRule[] {
  return rules.filter((rule) =>
    unescape(rule.selector)
      .split(',')
      .map((selector) => selector.trim())
      .some(
        (selector) =>
          selector === `.${className}` ||
          selector.startsWith(`.${className}:`) ||
          selector.startsWith(`.${className} `) ||
          selector.startsWith(`.${className}>`),
      ),
  )
}

/**
 * One declaration, from the unconditional rule for a class.
 *
 * Returns `undefined` when the class generates nothing, which is the failure
 * mode a string comparison cannot see: a utility this preset does not define
 * compiles to no CSS at all and the element is simply unstyled.
 */
export function declarationFor(
  rules: readonly CompiledRule[],
  className: string,
  property: string,
): string | undefined {
  for (const rule of rulesForClass(rules, className)) {
    if (rule.conditions.length > 0) continue
    const value = rule.declarations[property]
    if (value !== undefined) return value
  }
  return undefined
}

/** Every class name on an element and its descendants, deduplicated. */
export function classNamesIn(root: Element): readonly string[] {
  const found = new Set<string>()
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const name of element.classList) found.add(name)
  }
  return [...found]
}
