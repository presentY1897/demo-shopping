import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

/**
 * Guards the parts of the database contract that live outside `schema.prisma`.
 *
 * Three of the rules TASK-0020 relies on cannot be written in PSL, so they are
 * hand written SQL at the bottom of a migration. Prisma is happy to regenerate a
 * migration without them and nothing else in the suite would notice: the schema
 * would still be "valid", the API would still boot, and two concurrent requests
 * would quietly end up with two default addresses. This spec reads the committed
 * files and fails when a rule goes missing.
 *
 * It deliberately reads the files rather than a live database — CI has no
 * Postgres, and the artefact that gets deployed is the migration, not the local
 * database someone happened to migrate.
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

/** Every committed migration's SQL, concatenated. */
function migrationSql(): string {
  return migrationDirectories()
    .map((name) => readFileSync(join(PRISMA_DIR, 'migrations', name, 'migration.sql'), 'utf8'))
    .join('\n')
}

/** Collapses whitespace so an assertion is not hostage to line wrapping. */
function flat(sql: string): string {
  return sql.replace(/\s+/g, ' ')
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

describe('constraints PSL cannot express', () => {
  it('scopes the Google identity to accounts that are not withdrawn', () => {
    // A plain `@unique` would let one withdrawal burn a Google account forever.
    expect(flat(migrationSql())).toContain(
      'CREATE UNIQUE INDEX "User_googleSub_active_key" ON "User" ("googleSub") WHERE "deletedAt" IS NULL',
    )
  })

  it('allows one default shipping address per user', () => {
    // Without the predicate this would be a unique index on "userId" alone and
    // a user could keep exactly one address in total.
    expect(flat(migrationSql())).toContain(
      'CREATE UNIQUE INDEX "Address_userId_default_key" ON "Address" ("userId") WHERE "isDefault"',
    )
  })

  it('keeps the demo flag and the demo expiry consistent', () => {
    expect(migrationSql()).toContain('"User_demo_expiry_check"')
  })

  it('requires a Google identity on a live real account', () => {
    expect(migrationSql()).toContain('"User_google_identity_check"')
  })

  it('bounds the commission rate to a valid basis point range', () => {
    expect(migrationSql()).toContain('"Seller_commissionRateBp_check"')
    expect(flat(migrationSql())).toContain('"commissionRateBp" BETWEEN 0 AND 10000')
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
