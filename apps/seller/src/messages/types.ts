import type { HealthStatus } from '@shopping/shared'
import type { ImageUploadListLabels } from '@shopping/ui/components'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { ApiFailureReason } from '@/lib/api-failure'
import type { ErrorMessages } from '@/lib/errors'
import type { HealthFailureReason } from '@/lib/health'
import type { RejectionReason } from '@/lib/uploads/gallery'
import type { UploadFailureKey } from '@/lib/uploads/failures'

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
   * The shell every console screen sits inside — sidebar, top bar, page header
   * (TASK-0019). Its own slice because the root layout renders it on every
   * route, while everything else here belongs to one screen.
   */
  readonly layout: ConsoleLayoutMessages
  /**
   * Screens whose route exists so the sidebar has no dead ends, and whose
   * content arrives with its own milestone (TASK-0019 4.10).
   */
  readonly placeholder: ConsolePlaceholderMessages
  /** Route-level loading, not-found and error states (P5). */
  readonly routeStates: RouteStateMessages
  /**
   * What the API's refusals are called here, keyed by `error.code` (TASK-0117).
   *
   * Exhaustive by type: a code added to `@shopping/shared` without a sentence in
   * this catalog fails `pnpm typecheck` rather than rendering a blank line to
   * whoever hit it.
   */
  readonly errors: ErrorMessages
  /** Failures where the API never answered, so there is no code to look up. */
  readonly apiFailures: Readonly<Record<ApiFailureReason, string>>
  /** The product image widget (TASK-0033). */
  readonly imageUpload: ImageUploadMessages
}

/**
 * Everything the image widget renders.
 *
 * `list` is the shape `@shopping/ui` asks for: the component holds no copy, so
 * the labels of every row control are here, in the app that owns the wording.
 */
export interface ImageUploadMessages {
  readonly title: string
  readonly description: string
  /** What is allowed — formats, size cap, how many. Sits under the drop zone. */
  readonly hint: string
  readonly pickLabel: string
  /** Replaces the label while a file is being dragged over the panel. */
  readonly dropLabel: string
  readonly fullNotice: string
  readonly emptyDescription: string
  readonly retryAllLabel: string
  readonly rejectedTitle: string
  readonly rejections: Readonly<Record<RejectionReason, string>>
  /** Heading of the `ErrorNotice` shown for a failure nobody here can fix. */
  readonly noticeTitle: string
  readonly requestIdLabel: string
  readonly requestIdHint: string
  readonly copyLabel: string
  readonly copiedLabel: string
  readonly list: ImageUploadListLabels
  /** One sentence per way an upload can fail on its own or at the bucket. */
  readonly failures: Readonly<Record<UploadFailureKey, string>>
  /**
   * The development-only screen the widget can be operated on until TASK-0114
   * mounts it in the product form (TASK-0033 4.11).
   */
  readonly preview: ImageUploadPreviewMessages
}

export interface ImageUploadPreviewMessages {
  readonly title: string
  readonly devOnlyNotice: string
  readonly storeLabel: string
  readonly outputTitle: string
  readonly outputEmpty: string
}

export interface ConsoleLayoutMessages {
  /** The console's name — sidebar heading and the mobile sheet's title. */
  readonly brand: string
  /** Every string the shared shell renders. Its shape is the shell's. */
  readonly shell: ConsoleShellLabels
  /**
   * The sidebar, from the route table in `docs/design/pages.md`.
   *
   * In the catalog rather than beside the components because the labels are
   * Korean and the app owns them (TASK-0019 4.9) — the shell renders whatever
   * it is handed. M04 puts a permission filter in front of this definition.
   */
  readonly menu: ConsoleMenu
  readonly notifications: ConsoleSlotMessages
  readonly account: ConsoleSlotMessages
}

/**
 * A top-bar slot that is reserved but not filled.
 *
 * A disabled control would be worse than none (TASK-0018 4.5), so the slot is a
 * working popover that says which milestone fills it.
 */
export interface ConsoleSlotMessages {
  /** Accessible name of the icon button. */
  readonly label: string
  readonly title: string
  readonly body: string
  readonly closeLabel: string
}

export interface ConsolePlaceholderMessages {
  readonly comingSoon: string
  readonly body: string
  /** `/products/new` is not a menu entry, so its title lives here. */
  readonly productNew: string
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
