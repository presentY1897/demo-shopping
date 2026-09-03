/**
 * Names and connection strings of the databases the suite runs against.
 *
 * Shared by the global setup (which creates them) and by every worker (which
 * connects to exactly one of them), so the two can never disagree about which
 * database a worker owns.
 */

/** Migrated once per run; every worker database is a file level copy of it. */
export const TEMPLATE_DATABASE = 'shopping_test_tpl'

/** Worker databases are `shopping_test_w1` … `shopping_test_w<maxWorkers>`. */
export const WORKER_DATABASE_PREFIX = 'shopping_test_w'

/**
 * Database the maintenance connection uses.
 *
 * `CREATE DATABASE` and `DROP DATABASE` cannot run inside the database they
 * operate on, so the setup connects to the cluster's default one instead.
 */
export const MAINTENANCE_DATABASE = 'postgres'

/** Rows the truncation between tests must not remove. */
export const PRESERVED_TABLES: readonly string[] = ['_prisma_migrations']

/** Same connection string, pointed at another database on the same cluster. */
export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString)

  url.pathname = `/${database}`
  return url.toString()
}

export function workerDatabaseName(poolId: number): string {
  return `${WORKER_DATABASE_PREFIX}${String(poolId)}`
}

/**
 * How many worker databases exist.
 *
 * `vitest.config.mjs` publishes the value it configured as `maxWorkers`; the
 * fallback only matters if this module is ever loaded outside a vitest run.
 */
export function maxWorkers(): number {
  return Number(process.env.VITEST_MAX_WORKERS ?? '') || 4
}

/**
 * Which worker database this process owns.
 *
 * `VITEST_POOL_ID` rather than `VITEST_WORKER_ID`: a worker that gets recycled
 * receives a new worker id (they increase for as long as the run lasts) while
 * the pool id stays inside `1..maxWorkers`, which is what keeps the number of
 * databases finite.
 */
export function currentPoolId(): number {
  const poolId = Number(process.env.VITEST_POOL_ID ?? '')

  return Number.isInteger(poolId) && poolId >= 1 ? poolId : 1
}
