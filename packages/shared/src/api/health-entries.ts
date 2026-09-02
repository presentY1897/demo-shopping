import type { HealthResponse, HealthStatus } from '../health.js'
import { healthStatusSchema } from '../health.js'

export interface HealthEntry {
  /** Key as it appears in the payload: `status`, `search`, `database`, … */
  readonly key: string
  readonly status: HealthStatus
}

/**
 * Pulls every liveness field out of a health payload, in declaration order.
 *
 * Callers render the list they get instead of asking for fields by name. That
 * matters because the payload grows: `database` joins `search` with Prisma
 * (TASK-0005), and a screen that named its rows would silently keep showing the
 * old two. Non-liveness fields (`uptime`, `version`) are excluded because their
 * values are not a {@link HealthStatus}, so no key list has to be maintained
 * here either.
 */
export function healthEntries(response: HealthResponse): readonly HealthEntry[] {
  return Object.entries(response).flatMap(([key, value]) => {
    const parsed = healthStatusSchema.safeParse(value)
    return parsed.success ? [{ key, status: parsed.data }] : []
  })
}
