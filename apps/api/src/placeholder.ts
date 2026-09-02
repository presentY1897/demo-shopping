import type { HealthStatus } from '@shopping/shared'

/**
 * Keeps `apps/api` type-checkable and proves that the shared package resolves
 * from a NestJS (CommonJS) package. Replaced by the real bootstrap in TASK-0004.
 */
export const apiStatus: HealthStatus = 'up'
