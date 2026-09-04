import { healthResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * A healthy API, as `GET /api/v1/health` actually answers it.
 *
 * The values are copied from a real response rather than invented: `uptime` is
 * whole seconds because `HealthService` rounds, and `version` is the API
 * package's version. C2 checks the shape; keeping the values realistic is what
 * keeps a screen from being built against numbers that never occur (TASK-0107 R3).
 */
export const healthOk = defineFixture(healthResponseSchema, {
  status: 'ok',
  database: 'ok',
  search: 'ok',
  uptime: 12,
  version: '0.0.0',
  demoCleanup: { lastRunAt: '2026-09-05T00:00:00.000Z' },
})

/**
 * Search is down, so the summary is `degraded` — never `down`, because the
 * endpoint only answers at all while the process is serving.
 */
export const healthDegraded = defineFixture(healthResponseSchema, {
  status: 'degraded',
  database: 'ok',
  search: 'down',
  uptime: 12,
  version: '0.0.0',
  demoCleanup: { lastRunAt: '2026-09-05T00:00:00.000Z' },
})

/**
 * The engine is up but the catalogue is not searchable yet.
 *
 * The free plan has no persistent disk, so a restart leaves Meilisearch with no
 * documents and a search against it answers zero results rather than an error
 * (TASK-0009 4장). `search: 'degraded'` is how the API reports that, and it is
 * what makes a screen say "준비 중" instead of "결과 없음" (TASK-0101 4.7).
 */
export const healthSearchIndexing = defineFixture(healthResponseSchema, {
  status: 'degraded',
  database: 'ok',
  search: 'degraded',
  uptime: 12,
  version: '0.0.0',
  demoCleanup: { lastRunAt: '2026-09-05T00:00:00.000Z' },
})
