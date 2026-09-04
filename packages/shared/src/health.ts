import { z } from 'zod'

/**
 * Liveness of the API itself or of one of its dependencies.
 *
 * - `ok` — reachable and answering within the timeout
 * - `degraded` — reachable but answering something unexpected
 * - `down` — unreachable, or answering with an error
 */
export const healthStatusSchema = z.enum(['ok', 'degraded', 'down'])

export type HealthStatus = z.infer<typeof healthStatusSchema>

/**
 * Dependencies reported by `GET /api/v1/health`, one key per external system.
 *
 * Adding one is a three step change: append the key here, add the field to
 * `healthResponseSchema`, and register an indicator in the API's health module.
 */
export const healthDependencyKeys = ['database', 'search'] as const

export type HealthDependencyKey = (typeof healthDependencyKeys)[number]

/**
 * Payload of `GET /api/v1/health`.
 *
 * `status` describes the API as a whole: it is `ok` only while every dependency
 * is `ok`, and `degraded` as soon as one is not. The endpoint answers 200 in
 * both cases — a search or database outage must not make the API look dead to a
 * load balancer that would then stop routing traffic to it.
 */
export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  database: healthStatusSchema,
  search: healthStatusSchema,
  /** Seconds since the API process started. */
  uptime: z.number().nonnegative(),
  /** Version of the deployed API build. */
  version: z.string().min(1),
  /**
   * When the demo cleanup sweep last finished (TASK-0025 F5).
   *
   * `null` before the first run of a freshly started API, which is a real state
   * and not a failure — the sweep runs on an interval, not at boot.
   *
   * **Not a `HealthDependencyKey`.** The dependency keys are things the API
   * talks to and whose absence makes it unable to answer; a sweep that has not
   * run yet does not stop a single request. What it stops is demo data being
   * collected, and the way to notice that is a timestamp going stale — so the
   * timestamp is what is published, and the judgement is left to whoever reads
   * it (요구사항 「스케줄러가 멈추면 헬스체크로 알 수 있다」).
   */
  demoCleanup: z.object({ lastRunAt: z.iso.datetime().nullable() }),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
