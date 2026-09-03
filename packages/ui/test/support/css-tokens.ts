/**
 * Reads the design tokens back out of the stylesheet that ships them.
 *
 * The tokens live in CSS because Tailwind v4 is configured in CSS, so a test
 * that wants to assert something about them — that no button can shrink below
 * 44px, that the grid matrix in TypeScript matches the one the browser will
 * actually use — has to parse the real file. Asserting against a copy of the
 * numbers would only prove the copy is self-consistent.
 *
 * These helpers live in `packages/ui` rather than in `packages/config`, which
 * owns the stylesheet, because the interesting assertions compare the CSS with
 * the TypeScript matrix in `src/density/density.ts`, and only this package can
 * see both. `packages/config` stays a dependency-free box of presets.
 *
 * This is a deliberately small CSS engine: enough of the cascade to resolve a
 * custom property for one `<html data-density="N">` at one viewport width, and
 * enough of `calc()` / `max()` to turn the result into a number.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { Container } from 'postcss'
import postcss from 'postcss'

import type { DensityLevel } from '../../src/density/density'

const require = createRequire(import.meta.url)

/** Source order matters: a later declaration wins at equal specificity. */
const STYLESHEETS = [
  '@shopping/config/tailwind/tokens.css',
  '@shopping/config/tailwind/density.css',
] as const

interface TokenDeclaration {
  /** Empty for an `@theme` block, which Tailwind emits onto `:root`. */
  readonly selectors: readonly string[]
  /** 0 outside a media query. */
  readonly minWidth: number
  readonly prop: string
  readonly value: string
}

export interface TokenContext {
  readonly density: DensityLevel
  /** Viewport width in px, used to decide which `@media` blocks apply. */
  readonly width: number
}

const MIN_WIDTH = /min-width:\s*(\d+)px/

function collect(): readonly TokenDeclaration[] {
  const declarations: TokenDeclaration[] = []

  /**
   * Descends rather than walking back up from each declaration: the scope a
   * declaration sits in is the path taken to reach it, and carrying that down is
   * both simpler and the only version postcss's types agree with.
   */
  function visit(container: Container, selectors: readonly string[], minWidth: number): void {
    for (const node of container.nodes ?? []) {
      if (node.type === 'decl') {
        // `--color-*: initial` is a namespace reset, not a token.
        if (!node.prop.startsWith('--') || node.prop.includes('*')) continue
        declarations.push({ selectors, minWidth, prop: node.prop, value: node.value })
        continue
      }

      if (node.type === 'rule') {
        visit(node, node.selectors, minWidth)
        continue
      }

      if (node.type === 'atrule') {
        // `@theme` compiles onto `:root`; `@media` narrows the viewport.
        const match = node.name === 'media' ? MIN_WIDTH.exec(node.params) : null
        visit(node, selectors, match?.[1] === undefined ? minWidth : Number(match[1]))
      }
    }
  }

  for (const specifier of STYLESHEETS) {
    const file = require.resolve(specifier)
    visit(postcss.parse(readFileSync(file, 'utf8'), { from: file }), [':root'], 0)
  }

  return declarations
}

const DECLARATIONS = collect()

/**
 * Whether a rule applies to `<html data-density="N">`.
 *
 * `:root` and `[data-density='N']` have identical specificity (0-1-0), so the
 * winner is decided by source order alone — which is exactly what `resolve()`
 * below relies on, and why `density.css` restates every step inside each media
 * block instead of only the ones that change.
 */
function applies(declaration: TokenDeclaration, context: TokenContext): boolean {
  if (declaration.minWidth > context.width) return false
  return declaration.selectors.some(
    (selector) => selector === ':root' || selector === `[data-density='${context.density}']`,
  )
}

/** The declared (unresolved) value of a custom property in one context. */
export function declaredValue(prop: string, context: TokenContext): string {
  let winner: string | null = null
  for (const declaration of DECLARATIONS) {
    if (declaration.prop === prop && applies(declaration, context)) winner = declaration.value
  }
  if (winner === null) throw new Error(`No declaration for ${prop} at density ${context.density}`)
  return winner
}

const VAR_CALL = /var\(\s*(--[\w-]+)\s*\)/

/** Substitutes `var()` references until none are left. */
export function resolvedValue(prop: string, context: TokenContext): string {
  let value = declaredValue(prop, context)

  for (let depth = 0; depth < 16; depth += 1) {
    const match = VAR_CALL.exec(value)
    if (match?.[1] === undefined) return value
    value = value.replace(match[0], declaredValue(match[1], context))
  }

  throw new Error(`Cyclic custom property chain starting at ${prop}`)
}

/* -------------------------------------------------------- length maths ---- */

type Token =
  | { readonly kind: 'number'; readonly value: number; readonly unit: string }
  | {
      readonly kind: 'symbol'
      readonly value: string
    }

const ROOT_FONT_SIZE = 16

function tokenize(input: string): readonly Token[] {
  const tokens: Token[] = []
  const pattern = /\s*(?:(\d*\.?\d+)([a-z%]*)|([a-z]+)|([(),*/+-]))/giy
  let index = 0

  while (index < input.length) {
    pattern.lastIndex = index
    const match = pattern.exec(input)
    if (match === null) throw new Error(`Cannot tokenize "${input}" at offset ${index}`)
    index = pattern.lastIndex

    if (match[1] !== undefined) {
      tokens.push({ kind: 'number', value: Number(match[1]), unit: match[2] ?? '' })
    } else {
      tokens.push({ kind: 'symbol', value: (match[3] ?? match[4] ?? '').toLowerCase() })
    }
  }

  return tokens
}

/**
 * Evaluates the subset of CSS maths the tokens use: `calc`, `max`, `min`,
 * parentheses and the four operators, over px / rem / unitless values.
 *
 * Every length comes back in px with `rem` resolved at the 16px root size. That
 * is the browser default and the only size this project ships; a visitor who has
 * enlarged their base font gets *larger* controls, never smaller, so the 44px
 * floor the tests assert is a floor in the real world too.
 */
export function evaluateLength(input: string): number {
  const tokens = tokenize(input)
  let position = 0

  const peek = (): Token | undefined => tokens[position]

  function eat(symbol: string): boolean {
    const token = peek()
    if (token?.kind === 'symbol' && token.value === symbol) {
      position += 1
      return true
    }
    return false
  }

  function expect(symbol: string): void {
    if (!eat(symbol)) throw new Error(`Expected "${symbol}" in "${input}"`)
  }

  function primary(): number {
    const token = peek()
    if (token === undefined) throw new Error(`Unexpected end of "${input}"`)

    if (token.kind === 'number') {
      position += 1
      if (token.unit === 'rem') return token.value * ROOT_FONT_SIZE
      if (token.unit === '' || token.unit === 'px') return token.value
      throw new Error(`Unsupported unit "${token.unit}" in "${input}"`)
    }

    if (token.value === '(') {
      position += 1
      const value = sum()
      expect(')')
      return value
    }

    if (token.value === 'calc') {
      position += 1
      expect('(')
      const value = sum()
      expect(')')
      return value
    }

    if (token.value === 'max' || token.value === 'min') {
      const pick = token.value === 'max' ? Math.max : Math.min
      position += 1
      expect('(')
      const values = [sum()]
      while (eat(',')) values.push(sum())
      expect(')')
      return pick(...values)
    }

    if (token.value === '-') {
      position += 1
      return -primary()
    }

    throw new Error(`Unexpected token "${token.value}" in "${input}"`)
  }

  function product(): number {
    let value = primary()
    for (;;) {
      if (eat('*')) value *= primary()
      else if (eat('/')) value /= primary()
      else return value
    }
  }

  function sum(): number {
    let value = product()
    for (;;) {
      if (eat('+')) value += product()
      else if (eat('-')) value -= product()
      else return value
    }
  }

  const result = sum()
  if (position !== tokens.length) throw new Error(`Trailing tokens in "${input}"`)
  return result
}

/** A token's computed length in px, for one density at one viewport width. */
export function tokenLength(prop: string, context: TokenContext): number {
  return evaluateLength(resolvedValue(prop, context))
}

/** A token's computed value as a plain number (`--font-scale`, `--density-cols`). */
export function tokenNumber(prop: string, context: TokenContext): number {
  return evaluateLength(resolvedValue(prop, context))
}
