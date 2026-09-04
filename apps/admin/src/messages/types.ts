import type {
  DenialReason,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  SellerStatus,
} from '@shopping/shared'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { AttributeType } from '@shopping/shared'

import type { SellerDecision } from '@/lib/sellers/decisions'

import type { ApiFailureReason } from '@/lib/api-failure'
import type { ErrorMessages } from '@/lib/errors'
import type { SessionRefusal } from '@/lib/auth/session-client'
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
  /**
   * Signing in, being kept out, and being told why (TASK-0023).
   *
   * Replaces the `layout.account` placeholder slot the shell has carried since
   * TASK-0019 — that popover said "M04 에서 이 자리에 들어옵니다", and this is M04.
   */
  readonly auth: AuthMessages
  /** The category console (TASK-0029). */
  readonly categories: CategoryMessages
  /** The attribute console (TASK-0031). */
  readonly attributes: AttributeMessages
  /** The seller onboarding review console (TASK-0110). */
  readonly sellers: SellerReviewMessages
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

export interface AuthMessages {
  readonly signIn: SignInMessages
  readonly outcome: AuthOutcomeMessages
  readonly denials: AuthDenialMessages
  readonly menu: UserMenuMessages
  readonly guard: ConsoleGuardMessages
}

export interface SignInMessages {
  readonly title: string
  readonly description: string
  /** The one real sign-in path. Email and password do not exist (TASK-0021). */
  readonly googleLabel: string
  /** TASK-0024 fills this. Until then it is shown blocked, with the reason. */
  readonly demoLabel: string
  readonly demoReason: string
  readonly checkingLabel: string
  readonly signedInTitle: string
  readonly signedInBody: string
  readonly continueLabel: string
  /** `NEXT_PUBLIC_API_URL` is missing, so there is nowhere to send anybody. */
  readonly configurationTitle: string
  readonly configurationBody: string
}

/**
 * What the callback said, and what a refused renewal said.
 *
 * Both unions are contracts `@shopping/shared` owns, so a value added there
 * fails `pnpm typecheck` here rather than rendering a blank line.
 */
export interface AuthOutcomeMessages {
  readonly failureTitle: string
  /** `status=cancelled`. Not an error: somebody pressed 취소 on Google. */
  readonly cancelled: string
  /** The query string was unreadable, so there is nothing specific to say. */
  readonly generic: string
  readonly failures: Readonly<Record<OauthFailureReason, string>>
  readonly notices: Readonly<Record<OauthNotice, string>>
  readonly sessions: Readonly<Record<SessionRefusal, string>>
}

/**
 * Why a control is not available.
 *
 * `missing_permission` and `out_of_scope` are the API's own two reasons
 * (`denialReasons`), so a disabled button and a 403 say the same thing.
 */
export type AuthDenialMessages = Readonly<Record<DenialReason | 'checking' | 'signed_out', string>>

export interface UserMenuMessages {
  readonly label: string
  readonly title: string
  readonly closeLabel: string
  readonly signedOutBody: string
  readonly signInLabel: string
  readonly signOutLabel: string
  readonly rolesLabel: string
  /** One per role, so the menu never shows `SELLER_OWNER` to a person. */
  readonly roleNames: Readonly<Record<string, string>>
  readonly profileLabel: string
  /** Profile editing arrives with TASK-0112; the entry says so until then. */
  readonly profileReason: string
}

/**
 * The console's own two states: still deciding, and decided against.
 *
 * `body` deliberately does not name a seller application state. The session
 * carries no `Seller.status` and the API that will is TASK-0108's, so telling
 * `PENDING` from `REJECTED` here would be a guess shown to the person it is
 * wrong about (TASK-0023 4장 · R2).
 */
export interface ConsoleGuardMessages {
  readonly checkingLabel: string
  readonly title: string
  readonly body: string
  readonly signInLabel: string
  readonly signOutLabel: string
  /** Says which milestone turns this screen into a real one. */
  readonly pendingNote: string
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

/**
 * Everything `/attributes` says.
 *
 * One slice for the whole screen, for the reason {@link CategoryMessages} gives:
 * the picker, the list, the form, the preview and the two dialogs are one task
 * in an operator's head, and copy split along component boundaries is copy that
 * stops agreeing with itself.
 *
 * `errors` is **not** here. Everything the API answers is keyed by `error.code`
 * in the top-level `errors` slice, and a second copy per feature is a second
 * copy that disagrees (TASK-0117 4.2).
 */
export interface AttributeMessages {
  readonly title: string
  readonly description: string
  readonly categoryLabel: string
  readonly categoryPlaceholder: string
  /** Between the names of a category path: `여성 › 아우터 › 코트`. */
  readonly categorySeparator: string
  /** Marks a retired category in the picker; definitions on it are still live. */
  readonly categoryInactiveSuffix: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** There is no category to define anything on yet — a different emptiness. */
  readonly noCategoryTitle: string
  readonly noCategoryDescription: string
  readonly errorTitle: string
  readonly retryLabel: string
  /** Names the table and the region that scrolls it. */
  readonly listLabel: string
  readonly columns: AttributeColumnMessages
  /** What each of the five types is called to an operator. */
  readonly typeLabels: Readonly<Record<AttributeType, string>>
  /** One line saying what a type is for, shown under the type choice. */
  readonly typeHints: Readonly<Record<AttributeType, string>>
  /** Where an inherited definition comes from. `{name}` is the category. */
  readonly inheritedFrom: string
  readonly yes: string
  readonly no: string
  readonly keyHeadingHint: string
  readonly actions: AttributeActionMessages
  readonly form: AttributeFormMessages
  readonly preview: AttributePreviewMessages
  readonly retire: AttributeRetireMessages
  readonly conflict: AttributeConflictMessages
  readonly toast: AttributeToastMessages
  /** One line per way a call can fail **before** the API answers. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

export interface AttributeColumnMessages {
  readonly label: string
  readonly key: string
  readonly type: string
  readonly required: string
  readonly filterable: string
  readonly source: string
  readonly actions: string
}

export interface AttributeActionMessages {
  readonly add: string
  readonly edit: string
  readonly remove: string
  readonly moveUp: string
  readonly moveDown: string
  /**
   * Takes the picker to the category that owns an inherited definition.
   *
   * A disabled 수정 button would be a dead end; this is the way out of it
   * (TASK-0031 4.2). `{name}` is that category.
   */
  readonly goToSource: string
  /** Accessible name of the per-row filter switch. `{label}` is the attribute. */
  readonly toggleFilterable: string
}

export interface AttributeFormMessages {
  readonly addTitle: string
  readonly editTitle: string
  readonly categoryLabel: string
  readonly keyLabel: string
  readonly keyPlaceholder: string
  readonly keyHint: string
  /** Why `key` cannot be edited. Shown instead of an input. */
  readonly keyLockedHint: string
  readonly labelLabel: string
  readonly labelPlaceholder: string
  readonly typeLabel: string
  readonly typePlaceholder: string
  /** Why `type` cannot be edited. */
  readonly typeLockedHint: string
  readonly optionsLabel: string
  readonly optionsHint: string
  readonly optionPlaceholder: string
  /** Accessible name of one choice's input. `{index}` is its position. */
  readonly optionItemLabel: string
  readonly optionAddLabel: string
  /** Accessible name of one choice's delete button. `{index}` is its position. */
  readonly optionRemoveLabel: string
  readonly requiredLabel: string
  readonly requiredHint: string
  readonly filterableLabel: string
  readonly filterableHint: string
  readonly save: string
  readonly saving: string
  readonly cancel: string
  readonly closeLabel: string
  /** Shown at form level when a refusal named no field this form owns. */
  readonly submitError: string
  /**
   * What this form says about a value before it is sent.
   *
   * The **rules** are `packages/shared`'s — `attributeKeySchema`,
   * `attributeLabelSchema`, `optionIssues` — and only the wording is here
   * (TASK-0031 4.5). Nothing the API answers belongs in this record.
   */
  readonly errors: {
    readonly keyRequired: string
    readonly keyFormat: string
    readonly labelRequired: string
    readonly labelTooLong: string
    readonly typeRequired: string
    readonly optionsRequired: string
    readonly optionsForbidden: string
    readonly optionsDuplicate: string
    readonly optionInvalid: string
  }
}

export interface AttributePreviewMessages {
  readonly title: string
  readonly description: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** Marks the definition that is still open in the form. */
  readonly draftBadge: string
  /**
   * What the generated form says about a value.
   *
   * `{label}` is the attribute's own label, so the preview scolds in the same
   * words the seller's product form will (TASK-0114).
   */
  readonly errors: {
    readonly required: string
    readonly invalidNumber: string
    readonly invalidChoice: string
  }
}

export interface AttributeRetireMessages {
  readonly title: string
  readonly description: string
  readonly blockedTitle: string
  readonly blockedDescription: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
}

export interface AttributeConflictMessages {
  readonly title: string
  readonly description: string
  readonly serverLabel: string
  readonly mineLabel: string
  readonly reloadLabel: string
  readonly overwriteLabel: string
  readonly cancel: string
  readonly closeLabel: string
}

export interface AttributeToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly created: string
  readonly updated: string
  readonly removed: string
  readonly moved: string
  readonly filterableOn: string
  readonly filterableOff: string
  readonly saveFailed: string
  readonly moveFailed: string
  /** Said with a failure, because the list has just been re-read (4.6). */
  readonly reloaded: string
}

/**
 * Everything `/sellers` and `/sellers/[id]` say.
 *
 * One slice for both screens, for the reason {@link CategoryMessages} gives —
 * they are one task in an operator's head, and the same four decisions are taken
 * from either. Copy split along a route boundary is copy that stops agreeing
 * with itself.
 *
 * **No sentence here interpolates a value.** Every other console slice grew a
 * `{name}` placeholder and a `fill` helper for it; this one puts the store's
 * name in its own element instead. It reads better in the dialog (the name gets
 * a line of its own) and it removes the one thing a placeholder can do wrong,
 * which is being rendered as `{brandName}` at somebody.
 */
export interface SellerReviewMessages {
  readonly title: string
  readonly description: string
  /** Names the table and the region that scrolls it. */
  readonly listLabel: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** The queue is empty *because of the filter*, which is a different emptiness. */
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly filterLabel: string
  /** The "every status" choice. Sends no `status` at all. */
  readonly filterAll: string
  /** One per status, so an operator never reads `SUSPENDED`. */
  readonly statusLabels: Readonly<Record<SellerStatus, string>>
  readonly columns: SellerReviewColumnMessages
  /** Stands in for a column the API answered `null` for. */
  readonly emptyValue: string
  readonly pagination: SellerReviewPaginationMessages
  /** What each decision is called. Also the row button's visible text. */
  readonly actions: Readonly<Record<SellerDecision, string>>
  /**
   * The second half of a blocked button's sentence.
   *
   * The first half is TASK-0023's `reason(permission)`, which says *that* the
   * role cannot; this says *which* capability is missing. Keyed by permission
   * rather than by decision because that is what the two share.
   */
  readonly denials: {
    readonly approve: string
    readonly suspend: string
  }
  /**
   * Shown to an account whose `seller.approve` is narrowed to `demo`.
   *
   * A standing notice rather than a per-row judgment: the response carries no
   * `ownerIsDemo`, so this screen cannot tell which application is a demo
   * account's (TASK-0110 4장 · R4).
   */
  readonly demoScopeNotice: string
  /** Shown instead of the queue when the account may not read it at all. */
  readonly forbiddenTitle: string
  readonly detail: SellerReviewDetailMessages
  readonly dialog: SellerDecisionDialogMessages
  readonly toast: SellerReviewToastMessages
  /** One line per way a call can fail **before** the API answers. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

export interface SellerReviewColumnMessages {
  readonly brandName: string
  readonly slug: string
  readonly status: string
  readonly appliedAt: string
  readonly changedAt: string
  readonly reason: string
  readonly actions: string
}

export interface SellerReviewPaginationMessages {
  /** Names the `<nav>`; a page may hold more than one. */
  readonly label: string
  readonly previous: string
  readonly next: string
  /** Composed as `2 페이지 · 20건`, by concatenation rather than a placeholder. */
  readonly pageUnit: string
  readonly countUnit: string
}

export interface SellerReviewDetailMessages {
  readonly backLabel: string
  readonly applicationTitle: string
  readonly statusTitle: string
  readonly brandNameLabel: string
  readonly slugLabel: string
  readonly introductionLabel: string
  readonly logoLabel: string
  /** The applicant's account id. The response carries no name (TASK-0108 4장). */
  readonly ownerLabel: string
  readonly appliedAtLabel: string
  readonly statusLabel: string
  readonly reasonLabel: string
  readonly changedAtLabel: string
  readonly loadingLabel: string
  readonly notFoundTitle: string
  readonly notFoundDescription: string
  readonly errorTitle: string
  /** Alt text for the store's logo. */
  readonly logoAlt: string
  /** Said when this status offers nothing to do — `REJECTED` waits on the seller. */
  readonly noActions: string
}

export interface SellerDecisionDialogMessages {
  readonly titles: Readonly<Record<SellerDecision, string>>
  readonly descriptions: Readonly<Record<SellerDecision, string>>
  readonly confirms: Readonly<Record<SellerDecision, string>>
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  readonly cancel: string
  readonly closeLabel: string
  /** Shown at dialog level when a refusal named no field this form owns. */
  readonly submitError: string
  /**
   * What the dialog says about the reason before it is sent.
   *
   * The **rules** are `sellerStatusReasonSchema`'s and only the wording is here
   * — the same arrangement `attributeFormSchema` uses (TASK-0110 4장).
   */
  readonly errors: {
    readonly reasonRequired: string
    readonly reasonTooLong: string
  }
}

export interface SellerReviewToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  /** One per decision — "승인했어요" reads better than "처리했어요". */
  readonly decided: Readonly<Record<SellerDecision, string>>
  readonly failed: string
  /**
   * Somebody else decided first.
   *
   * Said with the re-read, because the row has just changed under the operator
   * and a silent refresh would look like their own click did it.
   */
  readonly conflict: string
}
