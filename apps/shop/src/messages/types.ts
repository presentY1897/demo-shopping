import type { HealthStatus } from '@shopping/shared'
import type { DensityLevel } from '@shopping/ui'

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
  /**
   * The design token preview. Development only (see `app/tokens/page.tsx`), but
   * the copy still lives here: a page that hardcodes Korean is a page nobody
   * remembers to translate, and the rule does not get an exception for tools.
   */
  readonly tokens: {
    readonly title: string
    readonly description: string
    readonly devOnlyNotice: string
    readonly linkLabel: string
    readonly density: {
      readonly legend: string
      readonly names: Readonly<Record<DensityLevel, string>>
      readonly current: string
      readonly hint: string
    }
    readonly sections: {
      readonly color: string
      readonly typography: string
      readonly spacing: string
      readonly shape: string
      readonly control: string
      readonly grid: string
      readonly comparison: string
    }
    readonly captions: {
      readonly color: string
      readonly typography: string
      readonly spacing: string
      readonly shape: string
      readonly control: string
      readonly grid: string
      readonly comparison: string
    }
    readonly labels: {
      readonly palette: string
      readonly semantic: string
      readonly measuredHeight: string
      readonly measuring: string
      readonly columns: string
      readonly columnsFromCss: string
      readonly columnsFromMatrix: string
      readonly viewportWidth: string
      readonly sampleText: string
      readonly sampleButton: string
      readonly iconButton: string
      readonly touchFloor: string
    }
  }
}
