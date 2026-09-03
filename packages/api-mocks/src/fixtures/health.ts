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
})
