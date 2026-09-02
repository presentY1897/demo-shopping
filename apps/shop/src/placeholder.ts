import type { HealthStatus } from '@shopping/shared'

/**
 * Keeps `apps/shop` type-checkable and proves that the shared package resolves
 * from a Next.js (ESM, bundler resolution) package. Replaced in TASK-0006.
 */
export const shopApiStatus: HealthStatus = 'ok'
