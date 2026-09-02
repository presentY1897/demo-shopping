import type { HealthStatus } from '@shopping/shared'

import type { HealthFailureReason } from '@/lib/health'

/**
 * Shape every locale catalog implements.
 *
 * Korean is the only catalog today (DECISIONS 1장: 다국어는 구조만 선반영,
 * 한국어·KRW 우선), but no component reads Korean text directly — they read this
 * interface, so adding a locale is adding a file.
 */
export interface Messages {
  readonly app: {
    readonly name: string
    readonly description: string
  }
  readonly health: {
    readonly title: string
    readonly endpointLabel: string
    /** Label per payload key. A key with no entry falls back to the key itself. */
    readonly itemLabels: Readonly<Record<string, string>>
    readonly statusLabels: Readonly<Record<HealthStatus, string>>
    readonly uptimeLabel: string
    readonly uptimeUnit: string
    readonly versionLabel: string
    readonly failureTitle: string
    readonly failures: Readonly<Record<HealthFailureReason, string>>
    readonly notice: string
  }
}
