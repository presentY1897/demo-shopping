import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

/** Multi-provider token: every indicator registered under it is checked. */
export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS')

/**
 * One external system the API depends on.
 *
 * `check` must never reject and never hang — a health endpoint that fails
 * because a dependency is down reports the API itself as dead, and a load
 * balancer would then take the last healthy instance out of rotation.
 */
export interface HealthIndicator {
  readonly key: HealthDependencyKey
  check(): Promise<HealthStatus>
}
