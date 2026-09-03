import { beforeEach, describe, expect, it } from 'vitest'

import type { Barrier } from '../support/concurrently.js'
import { barrier, concurrently, fulfilled } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createStock } from '../support/factories.js'

/**
 * The reason TASK-0106 exists: proving that "one stock unit, two simultaneous
 * requests, one winner" is a statement this repository can actually test.
 *
 * Both halves are necessary.
 *
 * - The **safe** reservation must let exactly one caller through. That alone
 *   proves nothing: an assertion that only one succeeded passes just as well
 *   when the two calls never overlapped.
 * - The **negative control** is a deliberately wrong reservation — read the
 *   stock, then write it back — and it must *reproduce* the oversell. When it
 *   does, the harness demonstrably creates a real race, and the safe version's
 *   pass becomes evidence about the implementation rather than about luck.
 *
 * The wrong implementation lives here, in raw SQL, and is never reachable from
 * `apps/api/src` (risk R6). It is a fixture that shows what the harness can
 * detect, not code anyone can call by accident.
 *
 * `TestStock` is a fixture table too (`test/setup/test-schema.sql`): stock
 * reservation itself is TASK-0048, and inventing the endpoint here would be
 * building the feature rather than the ground it stands on.
 */

const db = useDatabase()

/** F2/F3 ask for 20 consecutive runs; a race that fails once in twenty is not fixed. */
const RUNS = Array.from({ length: 20 }, (_unused, index) => index + 1)

let variant = ''

beforeEach(async () => {
  const stock = await createStock(db, { stock: 1 })

  variant = stock.variant
})

interface Attempt {
  readonly reserved: boolean
  /** Backend process id, to prove the two attempts were on different connections. */
  readonly backendPid: number
}

/**
 * How the real thing will be written (TASK-0048): one conditional UPDATE.
 *
 * The `stock >= $2` predicate is evaluated by the database while it holds the
 * row lock, so the loser re-reads the committed value and matches nothing. No
 * amount of application-level checking can achieve that.
 */
function reserveSafely(quantity: number): Promise<Attempt> {
  return db.withConnection(async (client) => {
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const backendPid = rows[0]?.pid ?? 0

    await client.query('BEGIN')
    try {
      const updated = await client.query(
        `UPDATE "TestStock" SET "stock" = "stock" - $2
          WHERE "variant" = $1 AND "stock" >= $2`,
        [variant, quantity],
      )

      if (updated.rowCount === 0) {
        await client.query('ROLLBACK')
        return { reserved: false, backendPid }
      }

      await client.query(`INSERT INTO "TestReservation" ("variant", "quantity") VALUES ($1, $2)`, [
        variant,
        quantity,
      ])
      await client.query('COMMIT')
      return { reserved: true, backendPid }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  })
}

/**
 * The wrong implementation, on purpose. Never called by anything but this file.
 *
 * The barrier is what makes the failure deterministic instead of occasional:
 * every caller reads before any caller writes, which is exactly the interleaving
 * a busy production database produces on its own.
 */
function reserveNaively(quantity: number, gate: Barrier): Promise<Attempt> {
  return db.withConnection(async (client) => {
    const { rows: pidRows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    const backendPid = pidRows[0]?.pid ?? 0

    await client.query('BEGIN')

    const { rows } = await client.query<{ stock: number }>(
      `SELECT "stock" FROM "TestStock" WHERE "variant" = $1`,
      [variant],
    )
    const seen = rows[0]?.stock ?? 0

    // Read-then-write: the value below is already stale by the time it is used.
    await gate.arrive()

    if (seen < quantity) {
      await client.query('ROLLBACK')
      return { reserved: false, backendPid }
    }

    await client.query(`UPDATE "TestStock" SET "stock" = $2 WHERE "variant" = $1`, [
      variant,
      seen - quantity,
    ])
    await client.query(`INSERT INTO "TestReservation" ("variant", "quantity") VALUES ($1, $2)`, [
      variant,
      quantity,
    ])
    await client.query('COMMIT')

    return { reserved: true, backendPid }
  })
}

async function stockOf(): Promise<number> {
  const { stock } = await db.one<{ stock: number }>(
    `SELECT "stock" FROM "TestStock" WHERE "variant" = $1`,
    [variant],
  )

  return stock
}

async function reservationCount(): Promise<number> {
  const { count } = await db.one<{ count: string }>(
    `SELECT count(*)::text AS count FROM "TestReservation" WHERE "variant" = $1`,
    [variant],
  )

  return Number(count)
}

describe('conditional update under concurrent reservation', () => {
  it.each(RUNS)('lets exactly one of two simultaneous requests through (run %i)', async () => {
    const results = await concurrently(2, () => reserveSafely(1))
    const attempts = fulfilled(results)

    expect(attempts).toHaveLength(2)
    expect(attempts.filter((attempt) => attempt.reserved)).toHaveLength(1)

    // Same competition, different connections — the premise of the whole test.
    expect(new Set(attempts.map((attempt) => attempt.backendPid)).size).toBe(2)

    expect(await stockOf()).toBe(0)
    expect(await reservationCount()).toBe(1)
  })

  it('never lets stock go negative, even with more requests than units', async () => {
    const results = await concurrently(5, () => reserveSafely(1))

    expect(fulfilled(results).filter((attempt) => attempt.reserved)).toHaveLength(1)
    expect(await stockOf()).toBe(0)
  })
})

describe('negative control — read-then-write oversells', () => {
  it.each(RUNS)('reproduces the lost update the safe version prevents (run %i)', async () => {
    const gate = barrier(2)
    const results = await concurrently(2, () => reserveNaively(1, gate))
    const attempts = fulfilled(results)

    expect(attempts).toHaveLength(2)
    // Both callers believe they reserved the single unit.
    expect(attempts.filter((attempt) => attempt.reserved)).toHaveLength(2)
    expect(new Set(attempts.map((attempt) => attempt.backendPid)).size).toBe(2)

    // One unit of stock, two reservations: exactly one oversell.
    expect(await stockOf()).toBe(0)
    expect(await reservationCount()).toBe(2)
  })
})
