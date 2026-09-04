import { Inject, Injectable } from '@nestjs/common'
import type { HealthDependencyKey, HealthResponse, HealthStatus } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { DemoCleanupReporter } from './demo-cleanup.reporter.js'
import type { HealthIndicator } from './health-indicator.js'
import { HEALTH_INDICATORS } from './health-indicator.js'

type Reading = readonly [HealthDependencyKey, HealthStatus]

/** An unregistered dependency is reported as down rather than silently omitted. */
function statusOf(readings: readonly Reading[], key: HealthDependencyKey): HealthStatus {
  return readings.find(([name]) => name === key)?.[1] ?? 'down'
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(HEALTH_INDICATORS) private readonly indicators: readonly HealthIndicator[],
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly demoCleanup: DemoCleanupReporter,
  ) {}

  /**
   * Checks every dependency in parallel and summarises the result.
   *
   * The summary is `degraded`, never `down`: this code only runs because the
   * process is alive and serving, so the API itself is up by definition. Adding
   * a dependency means registering one more indicator and reading it here.
   */
  async check(): Promise<HealthResponse> {
    const [readings, lastRunAt] = await Promise.all([
      Promise.all(
        this.indicators.map(async (indicator): Promise<Reading> => [
          indicator.key,
          await indicator.check(),
        ]),
      ),
      this.demoCleanup.lastRunAt(),
    ])

    return {
      status: readings.every(([, status]) => status === 'ok') ? 'ok' : 'degraded',
      database: statusOf(readings, 'database'),
      search: statusOf(readings, 'search'),
      uptime: Math.round(process.uptime()),
      version: this.config.version,
      demoCleanup: { lastRunAt },
    }
  }
}
