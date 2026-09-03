import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { HealthIndicator } from './health-indicator.js'
import { SEARCH_INDEXES } from './search-indexes.js'

/** Meilisearch answers `{ "status": "available" }` on this unauthenticated route. */
const HEALTH_PATH = '/health'
const AVAILABLE = 'available'

function isAvailable(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === AVAILABLE
}

/**
 * Whether one index can answer a query right now.
 *
 * An index that exists but holds nothing is not usable: after a restart
 * Meilisearch comes back with no documents (no persistent disk on the free
 * plan), and a search against it returns zero results rather than an error —
 * which is exactly the silence TASK-0101 F7 exists to replace with a notice.
 *
 * `isIndexing` is treated as not-ready as well. Meilisearch keeps serving the
 * previous documents while it indexes, but during the restore the index is
 * being filled from empty, so what it serves is a partial catalogue.
 */
function isQueryReady(stats: unknown): boolean {
  if (typeof stats !== 'object' || stats === null) return false
  if (!('numberOfDocuments' in stats)) return false
  if ('isIndexing' in stats && stats.isIndexing === true) return false

  return Number(stats.numberOfDocuments) > 0
}

/**
 * Reports the search capability as a whole, not just the engine's pulse.
 *
 * | value | meaning |
 * | --- | --- |
 * | `down` | the engine cannot be reached — asleep, or dead |
 * | `degraded` | the engine answers, but an expected index is not query-ready |
 * | `ok` | the engine answers and every expected index can serve a query |
 *
 * The middle row is what makes "재색인 중이면 검색 대신 안내" possible without a
 * new response field: the payload schema lives in `packages/shared`, which this
 * TASK does not own, so the readiness signal rides on the existing `search`
 * key (TASK-0101 4.7). A visitor cannot act on the difference between "waking"
 * and "reindexing" anyway — both mean search is not available yet.
 *
 * **This never triggers a reindex.** `/health` is what the platform's probe
 * calls, and hanging recovery work off it would put that work on every probe
 * (TASK-0009 4장). Reporting is the whole job.
 */
@Injectable()
export class SearchHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'search'

  private readonly logger = new Logger(SearchHealthIndicator.name)

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SEARCH_INDEXES) private readonly indexes: readonly string[],
  ) {}

  async check(): Promise<HealthStatus> {
    const base = this.config.search.host.replace(/\/+$/, '')

    try {
      const response = await fetch(`${base}${HEALTH_PATH}`, {
        // Without a deadline a hung search host would hold the health request
        // open until the caller's own timeout, which is the whole failure mode
        // this endpoint exists to reveal.
        signal: AbortSignal.timeout(this.config.search.timeoutMs),
        headers: { accept: 'application/json' },
      })

      if (!response.ok) return 'down'

      const body: unknown = await response.json()
      if (!isAvailable(body)) return 'degraded'
    } catch (error) {
      this.logger.warn(`검색 엔진에 연결하지 못했습니다: ${reasonOf(error)}`)
      return 'down'
    }

    return await this.indexReadiness(base)
  }

  /**
   * `ok` when every expected index can serve a query.
   *
   * With no expected index the loop is vacuous and no request is sent — which is
   * the state today (see `EXPECTED_SEARCH_INDEXES`), so this costs the probe
   * nothing until TASK-0038 lands.
   */
  private async indexReadiness(base: string): Promise<HealthStatus> {
    if (this.indexes.length === 0) return 'ok'

    const readings = await Promise.all(this.indexes.map((uid) => this.isIndexReady(base, uid)))

    return readings.every(Boolean) ? 'ok' : 'degraded'
  }

  private async isIndexReady(base: string, uid: string): Promise<boolean> {
    const url = `${base}/indexes/${encodeURIComponent(uid)}/stats`

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.search.timeoutMs),
        headers: {
          accept: 'application/json',
          // Every data route is behind the master key; only `/health` is open.
          authorization: `Bearer ${this.config.search.masterKey}`,
        },
      })

      // 404 is an index that does not exist yet — the state a restart leaves
      // behind. 403 is a key mismatch. Both mean search cannot answer.
      if (!response.ok) {
        this.logger.warn(`검색 색인 '${uid}' 상태를 읽지 못했습니다: HTTP ${response.status}`)
        return false
      }

      return isQueryReady(await response.json())
    } catch (error) {
      this.logger.warn(`검색 색인 '${uid}' 상태를 읽지 못했습니다: ${reasonOf(error)}`)
      return false
    }
  }
}

/** The exception class, not its message: the message can contain the host. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}
