/**
 * The `AppMeta` key the sweep records its last run under.
 *
 * A row rather than a field on a service, so that the answer survives a restart
 * and is the same for every instance. `/health` reads it (F5), and "the
 * scheduler has stopped" is a timestamp that stopped moving.
 */
export const DEMO_CLEANUP_LAST_RUN_KEY = 'demo.cleanup.lastRunAt'

/** How often the sweep runs. */
export const DEMO_CLEANUP_INTERVAL_MS = 15 * 60_000

/**
 * How many accounts one sweep collects (R2).
 *
 * A cap rather than "all of them": a demo that went viral overnight would
 * otherwise put a thousand transactions into one tick, and the failure mode of
 * that is the API being unresponsive while it works — on the free instance,
 * indistinguishable from being down. What is left over is collected by the next
 * tick fifteen minutes later, which for expired demo data is soon enough.
 */
export const DEMO_CLEANUP_BATCH = 50

/** Why a demo store is suspended rather than deleted. */
export const DEMO_CLEANUP_REASON = '데모 계정이 만료되어 스토어를 닫았습니다.'

/** What one sweep did. */
export interface DemoCleanupReport {
  readonly swept: number
  /** Accounts whose transaction failed. They stay expired and are retried (F6). */
  readonly failed: number
  readonly at: Date
}
