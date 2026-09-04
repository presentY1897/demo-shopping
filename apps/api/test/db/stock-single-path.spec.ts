import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * R1, as a test rather than a review item.
 *
 * "리포지토리에서 `stock` 직접 수정 금지" was written down as something a
 * reviewer would notice. Reviewers stop noticing; the second writer arrives in a
 * task about something else, sets the column because that is the obvious thing
 * to do, and the ledger quietly stops explaining the stock — with nothing red
 * anywhere, because every existing test still passes.
 *
 * So the rule is checked. Two forms can write the column and both are looked
 * for:
 *
 * - **raw SQL** — `SET "stock"`, which is how `StockService` itself writes it;
 * - **a Prisma payload** — any `productVariant.<write>(…)` call whose argument
 *   mentions `stock` at all. Mentioning it in a variant *write* is the thing
 *   being forbidden; reading it elsewhere (`select`, a response mapping, a
 *   `sum()` in a listing query) is untouched, which is why the search is scoped
 *   to the call rather than to the file.
 *
 * The same shape as TASK-0032 F8's `isDemo` grep, and for the same reason: a
 * rule that only exists in prose is a rule with no failure mode.
 */

const WRITE_METHODS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
] as const

/** The one file allowed to move the column. */
const OWNER = join('src', 'stock', 'stock.service.ts')

function sourceRoot(): string {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')
  return join(repoRoot, 'apps', 'api')
}

/** Every `.ts` under `apps/api/src`, specs excluded. */
function sourceFiles(directory: string, relative = 'src'): readonly string[] {
  return readdirSync(join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const next = join(relative, entry.name)

    if (entry.isDirectory()) return sourceFiles(directory, next)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [next] : []
  })
}

/**
 * The argument list of the call starting at `open`, by balancing parentheses.
 *
 * A regex cannot do this: a Prisma write payload nests braces and the closing
 * one belongs to whichever level opened it.
 */
function callArguments(source: string, open: number): string {
  let depth = 0

  for (let index = open; index < source.length; index += 1) {
    const character = source[index]

    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }

  return source.slice(open)
}

/** Every variant write in `source` that mentions the stock column. */
function stockWrites(source: string): readonly string[] {
  const found: string[] = []

  for (const method of WRITE_METHODS) {
    const needle = `productVariant.${method}(`
    let at = source.indexOf(needle)

    while (at !== -1) {
      const call = callArguments(source, at + needle.length - 1)

      if (/\bstock\b/.test(call)) found.push(`productVariant.${method}`)
      at = source.indexOf(needle, at + needle.length)
    }
  }

  return found
}

describe('R1 — ProductVariant.stock 을 쓰는 곳은 하나뿐', () => {
  const root = sourceRoot()
  const files = sourceFiles(root)

  it('finds the source tree it is supposed to be checking', () => {
    // A guard that silently walks an empty directory passes forever.
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain(OWNER)
  })

  it.each(files.filter((file) => file !== OWNER))('leaves the column alone in %s', (file) => {
    const source = readFileSync(join(root, file), 'utf8')

    expect(stockWrites(source)).toEqual([])
    expect(source).not.toMatch(/SET\s+"stock"/)
  })

  it('is written by the ledger service, in raw SQL', () => {
    const source = readFileSync(join(root, OWNER), 'utf8')

    // Not a formality: if this stops matching, the file above stopped being the
    // writer and the per-file assertions became vacuous.
    expect(source).toMatch(/SET\s+"stock"/)
  })
})
