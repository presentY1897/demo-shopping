import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'
import { healthResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import type { HealthIndicator } from './health-indicator.js'
import { HealthService } from './health.service.js'

const CONFIG = { version: '1.4.2' } as AppConfig

function indicator(key: HealthDependencyKey, status: HealthStatus): HealthIndicator {
  return { key, check: () => Promise.resolve(status) }
}

/** The full set the API registers, so a case only varies what it means to vary. */
function allOk(): HealthIndicator[] {
  return [indicator('database', 'ok'), indicator('search', 'ok')]
}

describe('HealthService', () => {
  it('reports ok while every dependency is ok', async () => {
    const result = await new HealthService(allOk(), CONFIG).check()

    expect(result.status).toBe('ok')
    expect(result.database).toBe('ok')
    expect(result.search).toBe('ok')
  })

  it('reports degraded — never down — when a dependency is unreachable', async () => {
    const result = await new HealthService([indicator('search', 'down')], CONFIG).check()

    expect(result.status).toBe('degraded')
    expect(result.search).toBe('down')
  })

  it('keeps the API itself up when only the database is unreachable', async () => {
    // The database outage has to be visible without the process looking dead:
    // a load balancer that reads `down` would stop routing to the last instance.
    const result = await new HealthService(
      [indicator('database', 'down'), indicator('search', 'ok')],
      CONFIG,
    ).check()

    expect(result.status).toBe('degraded')
    expect(result.database).toBe('down')
    expect(result.search).toBe('ok')
  })

  it('reports degraded when a dependency answers something unexpected', async () => {
    const result = await new HealthService([indicator('search', 'degraded')], CONFIG).check()

    expect(result.status).toBe('degraded')
  })

  it('reports an unregistered dependency as down instead of omitting it', async () => {
    const result = await new HealthService([], CONFIG).check()

    expect(result.database).toBe('down')
    expect(result.search).toBe('down')
    expect(result.status).toBe('ok')
  })

  it('returns the configured version and a non-negative uptime', async () => {
    const result = await new HealthService(allOk(), CONFIG).check()

    expect(result.version).toBe('1.4.2')
    expect(result.uptime).toBeGreaterThanOrEqual(0)
  })

  it('matches the payload shape shared with the web apps', async () => {
    const result = await new HealthService(allOk(), CONFIG).check()

    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })

  it('queries the indicators in parallel', async () => {
    const slow = (key: HealthDependencyKey): HealthIndicator => ({
      key,
      check: () => new Promise<HealthStatus>((resolve) => setTimeout(() => resolve('ok'), 50)),
    })

    const startedAt = performance.now()
    await new HealthService([slow('database'), slow('search')], CONFIG).check()

    expect(performance.now() - startedAt).toBeLessThan(90)
  })
})
