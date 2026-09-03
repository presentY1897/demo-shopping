import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

/**
 * Gate F8 of TASK-0105: `isDemo` does not spread into the business logic.
 *
 * The demo restriction is meant to be one value in the permission table — the
 * `demo` scope — not a condition every service remembers to write. The moment a
 * service starts asking whether an account is a demo, that promise is broken and
 * the next service to forget the question has a hole in it.
 *
 * So the column is readable from exactly one place per package: the mapper that
 * turns a row into `ResourceOwnership`, and the scope check that consumes it.
 * Anything else naming it fails here. A task that genuinely needs the flag —
 * issuing demo accounts (TASK-0024), sweeping expired ones (TASK-0025) — adds
 * its file to the list below in the same commit, which is the review this exists
 * to force.
 */

// Case insensitive so that `ownerIsDemo` — the same vocabulary one level up —
// counts as naming the flag too.
const MENTIONS_DEMO_FLAG = /isdemo/i

const ALLOWED = [
  // The one mapper: a row in, ownership out.
  'apps/api/src/auth/resource-ownership.ts',
  // The vocabulary itself, and the scope that reads it.
  'packages/shared/src/auth/resource-scope.ts',
  'packages/shared/src/auth/authorize.ts',
] as const

const SCANNED = ['apps/api/src', 'packages/shared/src'] as const

function repoRoot(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  return root
}

/** Repository-relative paths of every non-test TypeScript file in `dir`. */
function sourceFiles(root: string, dir: string): readonly string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'),
    )
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

function filesMentioningTheDemoFlag(): readonly string[] {
  const root = repoRoot()

  return SCANNED.flatMap((dir) => sourceFiles(root, dir)).filter((file) =>
    MENTIONS_DEMO_FLAG.test(readFileSync(join(root, file), 'utf8')),
  )
}

describe('demo handling stays inside the permission layer', () => {
  it('names the demo flag nowhere outside the authorization layer', () => {
    const offenders = filesMentioningTheDemoFlag().filter(
      (file) => !(ALLOWED as readonly string[]).includes(file),
    )

    expect(offenders).toEqual([])
  })

  it('keeps the allow list honest', () => {
    // An entry that no longer mentions the flag is one nobody will notice has
    // become a licence to reintroduce the branch anywhere.
    expect([...filesMentioningTheDemoFlag()].sort()).toEqual([...ALLOWED].sort())
  })
})
