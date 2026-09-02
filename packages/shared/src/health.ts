import { z } from 'zod'

/**
 * Liveness of the API or of one of its dependencies.
 *
 * - `up` — reachable and answering within the timeout
 * - `degraded` — reachable but slow or partially unavailable
 * - `down` — unreachable
 *
 * The full `/health` payload is defined in TASK-0004; this is the sample type
 * that proves the shared package wiring works end to end.
 */
export const healthStatusSchema = z.enum(['up', 'degraded', 'down'])

export type HealthStatus = z.infer<typeof healthStatusSchema>
