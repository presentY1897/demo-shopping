import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'
import { healthResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import type { DemoCleanupReporter } from './demo-cleanup.reporter.js'
import type { HealthIndicator } from './health-indicator.js'
import { HealthService } from './health.service.js'

const CONFIG = { version: '1.4.2' } as AppConfig

/** The sweep's timestamp, stubbed. `null` is what a freshly booted API answers. */
function sweepAt(lastRunAt: string | null = null): DemoCleanupReporter {
  return { lastRunAt: () => Promise.resolve(lastRunAt) } as DemoCleanupReporter
}

function indicator(key: HealthDependencyKey, status: HealthStatus): HealthIndicator {
  return { key, check: () => Promise.resolve(status) }
}

/** The full set the API registers, so a case only varies what it means to vary. */
function allOk(): HealthIndicator[] {
  return [indicator('database', 'ok'), indicator('search', 'ok')]
}

describe('HealthService', () => {
  it('reports ok while every dependency is ok', async () => {
    const result = await new HealthService(allOk(), CONFIG, sweepAt()).check()

    expect(result.status).toBe('ok')
    expect(result.database).toBe('ok')
    expect(result.search).toBe('ok')
  })

  it('reports degraded — never down — when a dependency is unreachable', async () => {
    const result = await new HealthService([indicator('search', 'down')], CONFIG, sweepAt()).check()

    expect(result.status).toBe('degraded')
    expect(result.search).toBe('down')
  })

  it('keeps the API itself up when only the database is unreachable', async () => {
    // The database outage has to be visible without the process looking dead:
    // a load balancer that reads `down` would stop routing to the last instance.
    const result = await new HealthService(
      [indicator('database', 'down'), indicator('search', 'ok')],
      CONFIG,
      sweepAt(),
    ).check()

    expect(result.status).toBe('degraded')
    expect(result.database).toBe('down')
    expect(result.search).toBe('ok')
  })

  it('reports degraded when a dependency answers something unexpected', async () => {
    const result = await new HealthService(
      [indicator('search', 'degraded')],
      CONFIG,
      sweepAt(),
    ).check()

    expect(result.status).toBe('degraded')
  })

  it('reports an unregistered dependency as down instead of omitting it', async () => {
    const result = await new HealthService([], CONFIG, sweepAt()).check()

    expect(result.database).toBe('down')
    expect(result.search).toBe('down')
    expect(result.status).toBe('ok')
  })

  it('returns the configured version and a non-negative uptime', async () => {
    const result = await new HealthService(allOk(), CONFIG, sweepAt()).check()

    expect(result.version).toBe('1.4.2')
    expect(result.uptime).toBeGreaterThanOrEqual(0)
  })

  it('matches the payload shape shared with the web apps', async () => {
    const result = await new HealthService(allOk(), CONFIG, sweepAt()).check()

    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })

  it('queries the indicators in parallel', async () => {
    const slow = (key: HealthDependencyKey): HealthIndicator => ({
      key,
      check: () => new Promise<HealthStatus>((resolve) => setTimeout(() => resolve('ok'), 50)),
    })

    const startedAt = performance.now()
    await new HealthService([slow('database'), slow('search')], CONFIG, sweepAt()).check()

    expect(performance.now() - startedAt).toBeLessThan(90)
  })
})

describe('the demo cleanup timestamp (TASK-0025 F5)', () => {
  it('is null before the sweep has ever run', async () => {
    const result = await new HealthService(allOk(), CONFIG, sweepAt()).check()

    expect(result.demoCleanup.lastRunAt).toBeNull()
  })

  it('carries the last run when there has been one', async () => {
    const at = '2026-09-05T00:15:00.000Z'
    const result = await new HealthService(allOk(), CONFIG, sweepAt(at)).check()

    expect(result.demoCleanup.lastRunAt).toBe(at)
  })

  it('does not make a stale sweep look like an unhealthy API', async () => {
    // The sweep not having run does not stop a single request, so it must not
    // move the overall verdict — the timestamp is published and the judgement is
    // left to whoever reads it.
    const result = await new HealthService(allOk(), CONFIG, sweepAt()).check()

    expect(result.status).toBe('ok')
    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })
})
