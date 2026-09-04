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
  // TASK-0024, and the review this list exists to force. Issuing an account is
  // the one thing that has to *write* the flag, and `User_demo_expiry_check`
  // means it must be written together with the expiry — so the pair lives in one
  // function whose whole job is that INSERT.
  //
  // Nothing else in that task names it. The rate limit counts
  // `demoExpiresAt IS NOT NULL`, the status endpoint answers with the expiry,
  // and the browser is never told the boolean exists — the two columns imply
  // each other, so reading the one that a screen actually needs costs nothing
  // and keeps this list one entry long (TASK-0024 4.5).
  'apps/api/src/demo/demo-account.ts',
  // TASK-0025, and the same review. The sweep has to *find* demo accounts, and
  // `isDemo` is the guard that keeps a real one out of a `deleteMany` — R1 names
  // "삭제 범위 오류로 공용 데이터 손실" as the risk and asks that every statement
  // carry it. Reading the flag here is the point, not an oversight.
  //
  // Nothing else in that task names it: the plan is a list of tables, the health
  // reporter reads a timestamp, and the force-expiry endpoint narrows by id.
  'apps/api/src/demo/demo-cleanup.service.ts',
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
