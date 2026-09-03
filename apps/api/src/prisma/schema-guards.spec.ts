import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

/**
 * Guards the two things whose subject really is a **file**.
 *
 * 1. every committed migration ships its SQL — deployments run `migrate deploy`
 *    and never regenerate anything, so a directory without its SQL is a
 *    migration that only ever existed on someone's machine;
 * 2. no floating point column exists anywhere in the schema (gate S4).
 *
 * The five constraints that PSL cannot express used to be checked here too, by
 * looking for their SQL text in the migration. That only ever caught a deletion:
 * turning `WHERE "isDefault"` into `WHERE NOT "isDefault"` kept the string
 * present while breaking the rule, and whether the constraint actually worked
 * was verified by hand in psql (D-207).
 *
 * TASK-0106 gave CI a PostgreSQL, so those assertions moved to
 * `test/db/schema-constraints.spec.ts`, where each rule is *tried* — a violation
 * has to be refused with the right SQLSTATE and constraint name, and the cases
 * that must be permitted have to succeed. That is strictly stronger: an index
 * that disappears makes the violating INSERT succeed and fails the spec. Keeping
 * both would only leave two answers to the same question.
 */

function apiDir(): string {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')
  return join(repoRoot, 'apps', 'api')
}

const PRISMA_DIR = join(apiDir(), 'prisma')

function schema(): string {
  return readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8')
}

function migrationDirectories(): readonly string[] {
  return readdirSync(join(PRISMA_DIR, 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

describe('committed migrations', () => {
  it('ships SQL for every migration', () => {
    // Deployments run `migrate deploy` and never regenerate anything, so a
    // directory without its SQL is a migration that only ever existed locally.
    for (const name of migrationDirectories()) {
      expect(() =>
        readFileSync(join(PRISMA_DIR, 'migrations', name, 'migration.sql'), 'utf8'),
      ).not.toThrow()
    }
  })

  it('has at least one migration', () => {
    expect(migrationDirectories().length).toBeGreaterThan(0)
  })
})

describe('money and rate columns', () => {
  it('declares no floating point field', () => {
    // Gate S4. Amounts are integer KRW and rates are integer basis points; a
    // `Float` anywhere in this schema is a settlement bug waiting to happen.
    const offenders = schema()
      .split('\n')
      .filter((line) => /^\s+\w+\s+(Float|Decimal)\b/.test(line))

    expect(offenders).toEqual([])
  })

  it('declares no floating point native type', () => {
    expect(schema()).not.toMatch(/@db\.(Real|DoublePrecision|Money|Decimal)\b/)
  })

  it('stores the seller commission as an integer', () => {
    expect(schema()).toMatch(/^\s+commissionRateBp\s+Int\?/m)
  })
})
