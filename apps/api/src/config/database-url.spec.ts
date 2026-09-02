import { describe, expect, it } from 'vitest'

import { databaseUrlFrom } from './database-url.js'

const DERIVED = { DATABASE_URL: 'postgresql://shopping:shopping@localhost:5482/shopping' }
const EXPLICIT = 'postgresql://user:secret@db.example.com:5432/shopping'

describe('databaseUrlFrom', () => {
  it('uses the value derived from PORT_OFFSET when nothing was set', () => {
    expect(databaseUrlFrom({}, DERIVED)).toBe(DERIVED.DATABASE_URL)
  })

  it('lets an explicitly set URL win, so a managed database stays reachable', () => {
    expect(databaseUrlFrom({ DATABASE_URL: EXPLICIT }, DERIVED)).toBe(EXPLICIT)
  })

  it('treats an empty value as unset', () => {
    expect(databaseUrlFrom({ DATABASE_URL: '   ' }, DERIVED)).toBe(DERIVED.DATABASE_URL)
  })

  it('fails with a message that names the variable and carries no connection string', () => {
    // The Prisma CLI prints this straight to a terminal and into CI output.
    expect(() => databaseUrlFrom({ DATABASE_URL: '' }, {})).toThrow(/DATABASE_URL/)
    expect(() => databaseUrlFrom({ DATABASE_URL: '' }, {})).not.toThrow(/postgresql:\/\//)
  })
})
