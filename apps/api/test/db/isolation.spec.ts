import { describe, expect, it } from 'vitest'

import { currentPoolId, workerDatabaseName } from '../setup/test-databases.js'
import { useDatabase } from '../support/database.js'
import { createStock, createUser } from '../support/factories.js'

/**
 * The isolation the whole harness rests on: a worker owns a database, and every
 * test starts from an empty one.
 *
 * Written as assertions rather than trusted because the failure mode is silent —
 * a test that inherits another's rows usually still passes, right up until the
 * day the order changes.
 */

const db = useDatabase()

describe('worker isolation', () => {
  it('connects to the database named after this worker pool id', async () => {
    const { current_database: name } = await db.one<{ current_database: string }>(
      'SELECT current_database()',
    )

    expect(name).toBe(workerDatabaseName(currentPoolId()))
    expect(db.url).toContain(name)
  })

  it('carries the schema the migrations produced', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )

    expect(tables.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(['User', 'UserRole', 'Seller', 'Address', 'RefreshToken']),
    )
  })

  it('keeps the migration history, which the next run needs', async () => {
    const applied = await db.query('SELECT 1 FROM "_prisma_migrations"')

    expect(applied.length).toBeGreaterThan(0)
  })
})

describe('reset between tests', () => {
  it('leaves rows behind inside a single test', async () => {
    await createUser(db)
    await createUser(db)

    const { count } = await db.one<{ count: string }>('SELECT count(*)::text AS count FROM "User"')

    expect(count).toBe('2')
  })

  it('starts the next test with every table empty', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'`,
    )

    for (const { table_name: table } of tables) {
      const { count } = await db.one<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}"`,
      )

      expect({ table, count }).toEqual({ table, count: '0' })
    }
  })

  it('restarts identity sequences, so the first row is id 1 again', async () => {
    // Without RESTART IDENTITY a spec could pass only because an earlier test
    // happened to leave the sequence where the assertion expected it.
    const first = await createStock(db, { stock: 1 })

    expect(first.id).toBe(1)
  })

  it('restarts them for every test, not once per file', async () => {
    const first = await createStock(db, { stock: 1 })

    expect(first.id).toBe(1)
  })
})
