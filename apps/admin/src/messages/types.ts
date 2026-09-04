import type { HealthStatus } from '@shopping/shared'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { ApiFailureReason } from '@/lib/api-failure'
import type { ErrorMessages } from '@/lib/errors'
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
  /** The category console (TASK-0029). */
  readonly categories: CategoryMessages
  /**
   * One sentence per error code the API can answer with (TASK-0117).
   *
   * Its own top-level slice rather than a corner of `categories`, because the
   * codes are not the category screen's: `AUTH_REQUIRED` and `INTERNAL_ERROR`
   * reach every screen, and a catalog that grew a second copy per feature is a
   * catalog whose two copies disagree.
   */
  readonly errors: ErrorMessages
  /** What is said about a failure nobody on this screen can fix (4.4). */
  readonly errorNotice: ErrorNoticeMessages
}

export interface ErrorNoticeMessages {
  readonly title: string
  /** Why a UUID is on screen at all. */
  readonly requestIdHint: string
  /** Accessible name of the id itself. */
  readonly requestIdLabel: string
  readonly copyLabel: string
  readonly copiedLabel: string
  /** Puts the notice away. A panel with no way out is a panel that stays. */
  readonly dismissLabel: string
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

/**
 * Everything `/categories` says.
 *
 * One slice for the whole screen rather than one per component: the tree, the
 * toolbar and the three dialogs are one task in an operator's head, and copy
 * that is split by component boundary is copy that stops agreeing with itself.
 */
export interface CategoryMessages {
  readonly title: string
  readonly description: string
  /** Accessible name of the tree itself. */
  readonly treeLabel: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly errorTitle: string
  readonly retryLabel: string
  /** How to drive the tree from the keyboard. Shown, not hidden in a tooltip. */
  readonly keyboardHint: string
  readonly slugLabel: string
  readonly inactiveBadge: string
  readonly selectionLabel: string
  readonly noSelection: string
  readonly childCountLabel: string
  readonly actions: CategoryActionMessages
  readonly form: CategoryFormMessages
  readonly retire: CategoryRetireMessages
  readonly conflict: CategoryConflictMessages
  readonly toast: CategoryToastMessages
  /**
   * One line per way a call can fail **before the API answers**.
   *
   * Everything the API *does* answer is keyed by `error.code` in `errors`
   * instead. Splitting them that way is the point of TASK-0117: a 409 used to
   * arrive as one reason with the real story in a Korean sentence, and this
   * record was where the screen's vocabulary for "conflict" ended.
   */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

export interface CategoryActionMessages {
  readonly addRoot: string
  readonly addChild: string
  readonly edit: string
  readonly moveUp: string
  readonly moveDown: string
  readonly moveOut: string
  readonly moveIn: string
  readonly deactivate: string
  readonly activate: string
  readonly remove: string
  /** Why the delete button is off — a disabled control with no reason is a dead end. */
  readonly removeBlocked: string
  readonly expandAll: string
  readonly collapseAll: string
}

export interface CategoryFormMessages {
  readonly addRootTitle: string
  readonly addChildTitle: string
  readonly editTitle: string
  readonly parentLabel: string
  readonly rootParent: string
  readonly nameLabel: string
  readonly namePlaceholder: string
  readonly slugFieldLabel: string
  readonly slugPlaceholder: string
  readonly slugHint: string
  readonly save: string
  readonly saving: string
  readonly cancel: string
  readonly closeLabel: string
  /**
   * What this form says about a value before it is sent.
   *
   * `slugTaken` used to live here too. It does not any more: "이미 쓰고 있는
   * 주소예요" is the server's answer rather than the form's rule, and it now
   * arrives as `CATEGORY_SLUG_TAKEN` and is looked up in `errors` like every
   * other code (TASK-0117). One sentence, one home.
   */
  readonly errors: {
    readonly nameRequired: string
    readonly nameTooLong: string
    readonly slugRequired: string
    readonly slugFormat: string
  }
}

export interface CategoryRetireMessages {
  readonly removeTitle: string
  readonly removeDescription: string
  readonly removeBlockedTitle: string
  readonly removeBlockedDescription: string
  readonly deactivateTitle: string
  readonly deactivateDescription: string
  readonly activateTitle: string
  readonly activateDescription: string
  readonly confirmRemove: string
  readonly confirmDeactivate: string
  readonly confirmActivate: string
  readonly cancel: string
  readonly closeLabel: string
}

export interface CategoryConflictMessages {
  readonly title: string
  readonly description: string
  readonly serverLabel: string
  readonly mineLabel: string
  readonly reloadLabel: string
  readonly overwriteLabel: string
  readonly cancel: string
  readonly closeLabel: string
}

export interface CategoryToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly moved: string
  readonly created: string
  readonly updated: string
  readonly removed: string
  readonly deactivated: string
  readonly activated: string
  readonly moveFailed: string
  readonly saveFailed: string
  /** Said with the failure, because the tree just jumped back on its own. */
  readonly restored: string
}
