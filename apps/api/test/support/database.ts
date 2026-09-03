import type { PoolClient, QueryResultRow } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeEach } from 'vitest'

import { PRESERVED_TABLES } from '../setup/test-databases.js'

/**
 * Access to this worker's database.
 *
 * Everything here goes through `pg` rather than Prisma on purpose: a spec that
 * asserts the database refuses something (QUALITY-GATES S5) must reach the
 * database with nothing in between, or a rejection by Prisma's own validation
 * would be indistinguishable from a rejection by a constraint.
 */
export interface Database {
  /** Connection string of this worker's database. */
  readonly url: string
  /** Rows of a query, run on a connection borrowed from the pool. */
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<T[]>
  /** The single row a query must return; throws when the count is not one. */
  one: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<T>
  /** Number of rows a statement affected. */
  execute: (text: string, values?: readonly unknown[]) => Promise<number>
  /**
   * Runs `work` on a connection of its own, returned to the pool afterwards.
   *
   * This is what makes a race reproducible: two calls that each hold their own
   * connection interleave, while two calls sharing one are serialised by `pg`
   * and would pass a concurrency assertion without ever competing.
   */
  withConnection: <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>
  /** Empties every table. Called automatically before each test. */
  truncate: () => Promise<void>
}

/**
 * Names of the tables to empty between tests, cached for the worker's lifetime.
 *
 * On `globalThis` and not in a module variable because vitest re-evaluates
 * modules for every test file, while the worker — and the database it is
 * connected to — outlives them all. The schema cannot change inside one run, so
 * one query per worker is enough.
 */
const TABLE_CACHE = Symbol.for('shopping.test.truncatable-tables')

type TableCache = Map<string, readonly string[]>

function tableCache(): TableCache {
  const host = globalThis as typeof globalThis & { [TABLE_CACHE]?: TableCache }

  return (host[TABLE_CACHE] ??= new Map<string, readonly string[]>())
}

/**
 * Reads the table list from the catalogue instead of a hand written array.
 *
 * A list maintained by hand goes stale the first time a migration adds a table,
 * and the symptom — rows surviving into the next test — looks like a flaky test
 * rather than a missing name.
 */
async function truncatableTables(pool: Pool, url: string): Promise<readonly string[]> {
  const cache = tableCache()
  const cached = cache.get(url)

  if (cached !== undefined) return cached

  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> ALL($1::text[])
      ORDER BY table_name`,
    [PRESERVED_TABLES],
  )

  const tables = rows.map((row) => row.table_name)

  cache.set(url, tables)
  return tables
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL

  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL 이 없습니다. test/setup/worker-database.mts 가 setupFiles 에 등록되어 있는지 확인하세요.',
    )
  }
  return url
}

/**
 * Connects this spec to the worker database and empties it before every test.
 *
 * Call it in the body of a `describe` (or at the top level of a spec) and keep
 * the result: the hooks are registered as a side effect.
 *
 * There is no transaction anywhere in here. Every write a test makes is really
 * committed, so locks, isolation levels and advisory locks behave exactly as
 * they will in production — which is the entire reason D-207 rejected rollback
 * based isolation.
 */
export function useDatabase(): Database {
  const url = databaseUrl()
  // Constructing a pool opens nothing; `pg` connects on the first query, so a
  // spec that ends up skipped pays nothing for this.
  const pool = new Pool({ connectionString: url, max: 10 })

  const database: Database = {
    url,

    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await pool.query<T>(text, [...values])

      return result.rows
    },

    async one<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<T> {
      const rows = await database.query<T>(text, values)
      const [row] = rows

      if (rows.length !== 1 || row === undefined) {
        throw new Error(`행 1개를 기대했지만 ${String(rows.length)}개가 반환되었습니다.`)
      }
      return row
    },

    async execute(text: string, values: readonly unknown[] = []): Promise<number> {
      const result = await pool.query(text, [...values])

      return result.rowCount ?? 0
    },

    async withConnection<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect()

      try {
        return await work(client)
      } finally {
        client.release()
      }
    },

    async truncate(): Promise<void> {
      const tables = await truncatableTables(pool, url)

      if (tables.length === 0) return

      // One statement for all of them: separate TRUNCATEs would each take their
      // own lock and could deadlock against the foreign keys between them.
      await pool.query(
        `TRUNCATE TABLE ${tables.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
      )
    },
  }

  beforeEach(async () => {
    await database.truncate()
  })

  afterAll(async () => {
    await pool.end()
  })

  return database
}
