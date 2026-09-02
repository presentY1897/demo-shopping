import type { AppConfig } from '../config/app-config.js'

/** The `pg` pool settings the driver adapter is built from. */
export interface DatabasePoolOptions {
  readonly connectionString: string
  /** Upper bound on simultaneous connections held by this process. */
  readonly max: number
  /** How long to wait for a connection before giving up. */
  readonly connectionTimeoutMillis: number
}

/**
 * Translates the validated configuration into `pg` pool options.
 *
 * Prisma 7 runs on a driver adapter, so the pool belongs to `pg` and is sized
 * here rather than through `?connection_limit=` on the URL. Both numbers exist
 * because the deployment target is a free Neon instance (D-060) reached from a
 * Render container: connections are the scarce resource there, and a compute
 * that has auto-suspended answers the first connection attempt slowly rather
 * than not at all — without a deadline that attempt would hang forever, since
 * `pg` waits indefinitely by default.
 */
export function databasePoolOptions(config: AppConfig): DatabasePoolOptions {
  return {
    connectionString: config.database.url,
    max: config.database.poolSize,
    connectionTimeoutMillis: config.database.connectTimeoutMs,
  }
}
