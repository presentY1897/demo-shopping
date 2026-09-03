/**
 * Reads the design tokens out of the stylesheet the browser actually loaded.
 *
 * **This is the rule the token documentation is built on** (D-206, TASK-0104
 * 2장): no value is written into a story. Names are discovered by walking
 * `document.styleSheets`, values are read back with `getComputedStyle`, and
 * lengths are measured off elements the browser has laid out. A page that
 * restated the numbers would agree with `tokens.css` on the day it was written
 * and quietly stop agreeing afterwards — and a design reference nobody can
 * trust is worse than none, because it is still consulted.
 *
 * The companion to this file is `test/support/css-tokens.ts`, which parses the
 * same stylesheets in Node for the assertions in `pnpm test`. They exist for
 * different reasons: that one must run without a browser, this one must report
 * what a browser did.
 */

/** One custom-property declaration, with the scope it was found in. */
export interface CustomPropertyRule {
  readonly selectors: readonly string[]
  /** Lower bound of the enclosing `@media`; 0 when there is none. */
  readonly minWidth: number
  readonly name: string
  readonly value: string
}

const MIN_WIDTH = /min-width:\s*(\d+(?:\.\d+)?)px/

/**
 * `@media`, `@layer`, `@supports` — anything that nests rules inside itself.
 *
 * A style rule answers to this too: CSS nesting made `CSSStyleRule` a grouping
 * rule, so it carries a (usually empty) `cssRules` of its own. Declarations are
 * therefore read *before* descending, or every rule in the document would be
 * mistaken for a container and its declarations never read — which is exactly
 * the bug this walker had first.
 */
function nestedRules(rule: CSSRule): CSSRuleList | null {
  return 'cssRules' in rule ? (rule as CSSGroupingRule).cssRules : null
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return 'selectorText' in rule && 'style' in rule
}

function mediaMinWidth(rule: CSSRule, inherited: number): number {
  if (!('media' in rule)) return inherited
  const match = MIN_WIDTH.exec((rule as CSSMediaRule).media.mediaText)
  return match?.[1] === undefined ? inherited : Number(match[1])
}

/**
 * Every custom property declared by every same-origin stylesheet, in source
 * order.
 *
 * Source order is what makes the result usable: `:root` and `[data-density='N']`
 * have identical specificity (0-1-0), so the winner between them is decided by
 * which came last — the same reason `density.css` restates all three steps
 * inside each viewport band.
 */
export function collectCustomProperties(doc: Document): readonly CustomPropertyRule[] {
  const found: CustomPropertyRule[] = []

  function visit(rules: CSSRuleList, minWidth: number): void {
    for (const rule of rules) {
      if (isStyleRule(rule)) {
        const selectors = rule.selectorText.split(',').map((selector) => selector.trim())
        for (const name of rule.style) {
          if (!name.startsWith('--')) continue
          found.push({ minWidth, name, selectors, value: rule.style.getPropertyValue(name).trim() })
        }
      }

      const nested = nestedRules(rule)
      if (nested !== null && nested.length > 0) visit(nested, mediaMinWidth(rule, minWidth))
    }
  }

  for (const sheet of doc.styleSheets) {
    let rules: CSSRuleList
    try {
      // Throws for a cross-origin stylesheet. There are none here, but a
      // documentation page must not be the thing that breaks the canvas.
      rules = sheet.cssRules
    } catch {
      continue
    }
    visit(rules, 0)
  }

  return found
}

/** Whether a rule applies to the document root outside any media query. */
function isRootRule(rule: CustomPropertyRule): boolean {
  return (
    rule.minWidth === 0 &&
    rule.selectors.some((selector) => selector === ':root' || selector === ':host')
  )
}

/**
 * Token names carrying a prefix, in declaration order, deduplicated.
 *
 * Order matters more than it looks: `tokens.css` declares the palette before the
 * semantic layer, so the colour page's two tables fall out of the file's own
 * structure rather than out of a list somebody maintains.
 */
export function rootTokenNames(
  rules: readonly CustomPropertyRule[],
  prefix: string,
  exclude?: RegExp,
): readonly string[] {
  const names: string[] = []
  for (const rule of rules) {
    if (!isRootRule(rule) || !rule.name.startsWith(prefix)) continue
    if (exclude?.test(rule.name) === true) continue
    if (!names.includes(rule.name)) names.push(rule.name)
  }
  return names
}

/** The declared value of a root token — `var(--color-blue-500)`, `calc(2px * …)`. */
export function rootDeclaredValues(
  rules: readonly CustomPropertyRule[],
): ReadonlyMap<string, string> {
  const values = new Map<string, string>()
  for (const rule of rules) {
    if (isRootRule(rule)) values.set(rule.name, rule.value)
  }
  return values
}

const VAR_CALL = /var\(\s*(--[\w-]+)\s*\)/

/**
 * Substitutes `var()` references until none are left.
 *
 * Used only to show *where a semantic token points*; every number on the page
 * comes from the browser, never from this substitution.
 */
export function substituteVars(value: string, values: ReadonlyMap<string, string>): string {
  let current = value
  for (let depth = 0; depth < 16; depth += 1) {
    const match = VAR_CALL.exec(current)
    if (match?.[1] === undefined) return current
    const referenced = values.get(match[1])
    if (referenced === undefined) return current
    current = current.replace(match[0], referenced)
  }
  return current
}

/** The custom property the browser resolved on an element, as a string. */
export function computedVar(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim()
}

/**
 * A length the browser laid out, in px.
 *
 * Reading `--spacing-control-md` directly would return `max(44px, calc(4px *
 * 11))` — the token stream after substitution, which is not a number. Assigning
 * it to a real property and measuring the box is what makes the browser do the
 * arithmetic, and it is the only way to state the 44px floor as something
 * observed rather than asserted.
 */
export function measureLength(host: HTMLElement, expression: string): number | null {
  const probe = host.ownerDocument.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.inlineSize = expression
  probe.style.blockSize = expression
  host.append(probe)
  const box = probe.getBoundingClientRect()
  probe.remove()
  return box.height === 0 && box.width === 0 ? null : box.height
}
