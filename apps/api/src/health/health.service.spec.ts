import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'
import { healthResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import type { DemoCleanupReporter } from './demo-cleanup.reporter.js'
import type { SearchIndexReport, SearchIndexReporter } from './search-index.reporter.js'
import type { HealthIndicator } from './health-indicator.js'
import type { PaymentWebhookReporter } from './payment-webhook.reporter.js'
import { HealthService } from './health.service.js'

const CONFIG = { version: '1.4.2' } as AppConfig

/** The sweep's timestamp, stubbed. `null` is what a freshly booted API answers. */
function sweepAt(lastRunAt: string | null = null): DemoCleanupReporter {
  return { lastRunAt: () => Promise.resolve(lastRunAt) } as DemoCleanupReporter
}

/** The indexing queue, stubbed. Empty and idle unless a case says otherwise. */
function queue(report: Partial<SearchIndexReport> = {}): SearchIndexReporter {
  return {
    report: () =>
      Promise.resolve({ pending: 0, lastRunAt: null, oldestPendingAt: null, ...report }),
  } as SearchIndexReporter
}

/** 마지막 웹훅 수신 시각, 대역. `null` 이 「기록이 없다」이고 그것이 기본값이다. */
function webhookAt(lastReceivedAt: string | null = null): PaymentWebhookReporter {
  return { lastReceivedAt: () => Promise.resolve(lastReceivedAt) } as PaymentWebhookReporter
}

/**
 * The service, assembled.
 *
 * Every reporter added to `/health` is another constructor argument, and before
 * this helper each one meant editing eight call sites that did not care. A case
 * names only what it is about.
 */
function service(
  indicators: readonly HealthIndicator[],
  parts: {
    readonly config?: AppConfig
    readonly sweep?: DemoCleanupReporter
    readonly search?: SearchIndexReporter
    readonly webhook?: PaymentWebhookReporter
  } = {},
): HealthService {
  return new HealthService(
    indicators,
    parts.config ?? CONFIG,
    parts.sweep ?? sweepAt(),
    parts.search ?? queue(),
    parts.webhook ?? webhookAt(),
  )
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
    const result = await service(allOk()).check()

    expect(result.status).toBe('ok')
    expect(result.database).toBe('ok')
    expect(result.search).toBe('ok')
  })

  it('reports degraded — never down — when a dependency is unreachable', async () => {
    const result = await service([indicator('search', 'down')]).check()

    expect(result.status).toBe('degraded')
    expect(result.search).toBe('down')
  })

  it('keeps the API itself up when only the database is unreachable', async () => {
    // The database outage has to be visible without the process looking dead:
    // a load balancer that reads `down` would stop routing to the last instance.
    const result = await service([indicator('database', 'down'), indicator('search', 'ok')]).check()

    expect(result.status).toBe('degraded')
    expect(result.database).toBe('down')
    expect(result.search).toBe('ok')
  })

  it('reports degraded when a dependency answers something unexpected', async () => {
    const result = await service([indicator('search', 'degraded')]).check()

    expect(result.status).toBe('degraded')
  })

  it('reports an unregistered dependency as down instead of omitting it', async () => {
    const result = await service([]).check()

    expect(result.database).toBe('down')
    expect(result.search).toBe('down')
    expect(result.status).toBe('ok')
  })

  it('returns the configured version and a non-negative uptime', async () => {
    const result = await service(allOk()).check()

    expect(result.version).toBe('1.4.2')
    expect(result.uptime).toBeGreaterThanOrEqual(0)
  })

  it('matches the payload shape shared with the web apps', async () => {
    const result = await service(allOk()).check()

    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })

  it('queries the indicators in parallel', async () => {
    const slow = (key: HealthDependencyKey): HealthIndicator => ({
      key,
      check: () => new Promise<HealthStatus>((resolve) => setTimeout(() => resolve('ok'), 50)),
    })

    const startedAt = performance.now()
    await service([slow('database'), slow('search')]).check()

    expect(performance.now() - startedAt).toBeLessThan(90)
  })
})

describe('the demo cleanup timestamp (TASK-0025 F5)', () => {
  it('is null before the sweep has ever run', async () => {
    const result = await service(allOk()).check()

    expect(result.demoCleanup.lastRunAt).toBeNull()
  })

  it('carries the last run when there has been one', async () => {
    const at = '2026-09-05T00:15:00.000Z'
    const result = await service(allOk(), { sweep: sweepAt(at) }).check()

    expect(result.demoCleanup.lastRunAt).toBe(at)
  })

  it('does not make a stale sweep look like an unhealthy API', async () => {
    // The sweep not having run does not stop a single request, so it must not
    // move the overall verdict — the timestamp is published and the judgement is
    // left to whoever reads it.
    const result = await service(allOk()).check()

    expect(result.status).toBe('ok')
    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })
})

describe('the indexing queue (TASK-0038 F7)', () => {
  it('reports an empty queue and an idle worker', async () => {
    const result = await service(allOk()).check()

    expect(result.searchIndex).toEqual({ pending: 0, lastRunAt: null, oldestPendingAt: null })
  })

  it('reports how far behind the index is', async () => {
    const result = await service(allOk(), {
      search: queue({
        pending: 42,
        lastRunAt: '2026-09-05T00:00:00.000Z',
        oldestPendingAt: '2026-09-04T23:59:00.000Z',
      }),
    }).check()

    expect(result.searchIndex.pending).toBe(42)
    expect(result.searchIndex.oldestPendingAt).toBe('2026-09-04T23:59:00.000Z')
  })

  it('does not make a backlog look like an unhealthy API', async () => {
    // The `search` indicator reports the engine; this reports the pipeline that
    // feeds it. A pipeline that is behind while the engine is fine is a real
    // state, and a 'degraded' here would send somebody looking at Meilisearch.
    const result = await service(allOk(), { search: queue({ pending: 5_000 }) }).check()

    expect(result.status).toBe('ok')
    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })
})

describe('the last webhook (TASK-0056 2장)', () => {
  it('is null when there is no record of one', async () => {
    const result = await service(allOk()).check()

    expect(result.paymentWebhook.lastReceivedAt).toBeNull()
  })

  it('carries the last arrival when there has been one', async () => {
    const at = '2026-09-05T00:20:00.000Z'
    const result = await service(allOk(), { webhook: webhookAt(at) }).check()

    expect(result.paymentWebhook.lastReceivedAt).toBe(at)
  })

  it('does not make a quiet hour look like an unhealthy API', async () => {
    // 웹훅이 한 건도 안 온 배포는 흔하다 — 결제사 키가 없거나, 웹훅 URL 을 아직
    // 등록하지 않았거나, 아무도 결제하지 않은 것뿐이다. 그것을 `degraded` 로 올리면
    // 헬스체크가 늘 빨갛고, 늘 빨간 헬스체크는 아무도 안 본다. 웹훅이 **끊긴** 것을
    // 판정하는 것은 대사 배치 쪽 지표다.
    const result = await service(allOk()).check()

    expect(result.status).toBe('ok')
    expect(healthResponseSchema.safeParse(result).success).toBe(true)
  })
})
