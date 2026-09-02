import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { HealthIndicator } from './health-indicator.js'

/** Meilisearch answers `{ "status": "available" }` on this unauthenticated route. */
const HEALTH_PATH = '/health'
const AVAILABLE = 'available'

function isAvailable(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === AVAILABLE
}

@Injectable()
export class SearchHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'search'

  private readonly logger = new Logger(SearchHealthIndicator.name)

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async check(): Promise<HealthStatus> {
    const url = `${this.config.search.host.replace(/\/+$/, '')}${HEALTH_PATH}`

    try {
      const response = await fetch(url, {
        // Without a deadline a hung search host would hold the health request
        // open until the caller's own timeout, which is the whole failure mode
        // this endpoint exists to reveal.
        signal: AbortSignal.timeout(this.config.search.timeoutMs),
        headers: { accept: 'application/json' },
      })

      if (!response.ok) return 'down'

      const body = await response.json()
      return isAvailable(body) ? 'ok' : 'degraded'
    } catch (error) {
      this.logger.warn(`검색 엔진에 연결하지 못했습니다: ${reasonOf(error)}`)
      return 'down'
    }
  }
}

/** The exception class, not its message: the message can contain the host. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}
