import type { DensityLevel } from '@shopping/ui'
import type { HealthStatus } from '@shopping/shared'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

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
  readonly health: HealthMessages
  /**
   * Everything the visitor is told while the API is still waking up (TASK-0101).
   *
   * Its own slice rather than more keys under `health`: the panel describes a
   * result, this describes the wait for one, and the wait is what a client
   * component renders. Keeping them apart is what lets the page hand the client
   * boundary two small plain objects instead of the whole catalog.
   */
  readonly wake: WakeMessages
  /**
   * The base component gallery (TASK-0015). Development only, like the token
   * preview, but the copy still lives here: `packages/ui` cannot see this
   * catalog and must contain no Korean, so every string the gallery renders
   * arrives through this shape.
   */
  readonly components: ComponentGalleryMessages
  /**
   * The shell every screen sits inside — header, footer, mobile menu, density
   * toggle (TASK-0018). Its own slice because it is rendered by the root layout
   * on every route, while everything above belongs to one screen.
   */
  readonly layout: LayoutMessages
  /** The temporary home screen. TASK-0044 replaces it with the real one. */
  readonly home: HomeMessages
  /**
   * Screens whose route exists so the header's links are not dead ends, and
   * whose content arrives with its own milestone (TASK-0018 4.5).
   */
  readonly placeholder: PlaceholderMessages
  /** Route-level loading, not-found and error states (P5). */
  readonly routeStates: RouteStateMessages
}

export interface LayoutMessages {
  readonly skipToContent: string
  /** Accessible name of the logo link. The visible name is `app.name`. */
  readonly homeLabel: string
  readonly nav: NavMessages
  readonly search: SearchSlotMessages
  readonly density: DensityControlMessages
  readonly account: {
    readonly cart: string
    readonly mypage: string
  }
  readonly footer: FooterMessages
}

export interface NavMessages {
  /** Names the `<nav>` landmark; there is more than one on the page. */
  readonly label: string
  readonly openMenu: string
  readonly closeMenu: string
  readonly menuTitle: string
  readonly menuDescription: string
  /**
   * The category list, fixed for now. TASK-0042 replaces it with the tree the
   * catalogue API serves; the shape is the same either way.
   */
  readonly categories: readonly { readonly slug: string; readonly label: string }[]
  /** Announced inside a link while its route is still loading. */
  readonly pendingLabel: string
}

export interface SearchSlotMessages {
  readonly label: string
  readonly placeholder: string
  readonly submit: string
}

export interface DensityControlMessages {
  readonly legend: string
  /** One per step. Also the accessible name of each option in the toggle. */
  readonly names: Readonly<Record<DensityLevel, string>>
  /** Accessible name of the button that opens the toggle on a phone. */
  readonly openLabel: string
  readonly hintTitle: string
  readonly hintBody: string
  readonly hintDismiss: string
}

export interface FooterMessages {
  readonly label: string
  readonly demoTitle: string
  readonly demoBody: string
  readonly densityTitle: string
  readonly densityBody: string
  readonly copyright: string
}

export interface HomeMessages {
  readonly title: string
  readonly description: string
  readonly previewTitle: string
  readonly previewDescription: string
  /** Names of the placeholder cards. No real brand names anywhere (D-035). */
  readonly previewItems: readonly string[]
  readonly previewImageLabel: string
  readonly previewPriceLabel: string
}

export interface PlaceholderMessages {
  readonly comingSoon: string
  readonly search: { readonly title: string; readonly body: string; readonly queryLabel: string }
  readonly category: { readonly title: string; readonly body: string }
  readonly cart: { readonly title: string; readonly body: string }
  readonly mypage: { readonly title: string; readonly body: string }
}

export interface RouteStateMessages {
  readonly loadingLabel: string
  readonly notFoundTitle: string
  readonly notFoundBody: string
  readonly errorTitle: string
  readonly errorBody: string
  readonly retryLabel: string
  readonly homeLabel: string
}

export interface HealthMessages {
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

export interface WakeMessages {
  /** Announced from the first frame; the skeleton itself is hidden from AT. */
  readonly loadingLabel: string
  readonly preparing: string
  readonly preparingHint: string
  /** Added once the wait is long enough that it is certainly a cold start. */
  readonly coldStartNotice: string
  readonly elapsedLabel: string
  readonly secondsUnit: string
  readonly attemptLabel: string
  readonly progressLabel: string
  readonly failureTitle: string
  readonly failureHint: string
  readonly retryLabel: string
  readonly search: SearchReadinessMessages
}

export interface SearchReadinessMessages {
  readonly title: string
  readonly ready: string
  readonly preparingTitle: string
  /** The engine itself is still asleep — `search: "down"`. */
  readonly waking: string
  /** The engine answers but the index is not query-ready — `search: "degraded"`. */
  readonly indexing: string
  readonly autoRecheck: string
  readonly recheckLabel: string
}
