/**
 * The "no hardcoded values" rule, enforced instead of remembered.
 *
 * TASK-0014 established that every colour, length and radius comes from the
 * token layer and verified it with a one-off grep. A grep proves the state of
 * the tree on the day it was run; this file makes the same four checks part of
 * `pnpm test`, so the rule survives the next component and the one after that.
 *
 * It reads the apps' sources as well as this package's. That crosses a package
 * boundary, which `test/support/css-tokens.ts` already does for the stylesheet
 * and for the same reason: the rule is repository-wide, the apps have no test
 * runner of their own yet, and a rule nothing runs is a rule that has already
 * been broken somewhere.
 *
 * Comments are stripped before scanning. Half the explanations in this package
 * are *about* 44px and `#hex`, and a checker that flagged its own documentation
 * would be turned off within a week.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..')

/** Everything that can produce a class name or an inline style. */
const SCAN_ROOTS = [
  join(PACKAGE_ROOT, 'src'),
  join(REPO_ROOT, 'apps', 'shop', 'src'),
  join(REPO_ROOT, 'apps', 'seller', 'src'),
  join(REPO_ROOT, 'apps', 'admin', 'src'),
]

interface SourceFile {
  readonly path: string
  /** Comment-free contents. */
  readonly code: string
}

function walk(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.tsx?$/.test(path) && !path.endsWith('.spec.tsx') && !path.endsWith('.spec.ts')
      ? [path]
      : []
  })
}

/**
 * Message catalogs are prose, not style. They legitimately say "44px" out loud —
 * the token preview page explains the touch floor to whoever is reading it — and
 * a checker that could not tell a sentence from a declaration would push that
 * copy into a component, which is the outcome the rule exists to prevent.
 */
function isStyleBearing(path: string): boolean {
  return !path.includes(`${sep}messages${sep}`)
}

/**
 * Removes block and line comments. The `[^:]` guard keeps `https://` inside a
 * string from being read as the start of a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const FILES: readonly SourceFile[] = SCAN_ROOTS.flatMap((root) =>
  walk(root)
    .filter(isStyleBearing)
    .map((path) => ({ code: stripComments(readFileSync(path, 'utf8')), path })),
)

function offenders(pattern: RegExp): readonly string[] {
  return FILES.flatMap(({ path, code }) => {
    const matches = code.match(pattern) ?? []
    return matches.map((match) => `${relative(REPO_ROOT, path)}: ${match}`)
  })
}

describe('the source tree', () => {
  it('has files to check', () => {
    // A walker that silently found nothing would make every test below pass.
    expect(FILES.length).toBeGreaterThan(20)
  })
})

describe('hardcoded values', () => {
  it('contains no hex colour', () => {
    // 3, 4, 6 or 8 digits, and not followed by another word character, so a
    // fragment link such as `#items` is not mistaken for one.
    expect(
      offenders(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g),
    ).toEqual([])
  })

  it('contains no colour function', () => {
    // Colours are declared once, in `@shopping/config/tailwind/tokens.css`.
    expect(offenders(/\b(?:oklch|rgba?|hsla?|lab|lch|color-mix)\s*\(/g)).toEqual([])
  })

  it('contains no arbitrary length utility', () => {
    // `w-[320px]`, `mt-[1.5rem]`, `text-[14px]` — the escape hatch that makes a
    // token system decorative.
    expect(offenders(/\[[^\]\s]*\d(?:px|rem|em|vh|vw|ch|pt)\]/g)).toEqual([])
  })

  it('contains no CSS length literal', () => {
    // Catches the inline-style form the utility check would miss:
    // `style={{ height: '44px' }}`.
    expect(offenders(/['"`][^'"`\n]*\b\d+(?:\.\d+)?(?:px|rem|em)\b/g)).toEqual([])
  })

  it("uses no colour from Tailwind's own palette", () => {
    // Two things at once: Tailwind's stock palette is deleted in `tokens.css`,
    // so `bg-red-500` would silently render nothing — and our own palette layer
    // (`--color-neutral-600`) is off limits to components, which may only reach
    // for a semantic role.
    const families =
      'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
    const utilities =
      'bg|text|border|ring|fill|stroke|outline|from|via|to|divide|accent|caret|decoration|placeholder|shadow'
    expect(offenders(new RegExp(`\\b(?:${utilities})-(?:${families})-\\d{1,3}\\b`, 'g'))).toEqual(
      [],
    )
  })
})
