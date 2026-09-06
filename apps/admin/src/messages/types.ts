import type {
  ClaimFault,
  ClaimHandlingStage,
  ClaimStatus,
  ClaimType,
  DenialReason,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  OrderActor,
  ReturnReason,
  SellerStatus,
} from '@shopping/shared'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { ApiFailureReason, AttributeType, ErrorMessages } from '@shopping/shared'

import type { ForceIssue, InterventionBlock } from '@/lib/claims/claim-console'
import type {
  DefectReturnBlock,
  DefectReturnIssue,
  DefectReturnTarget,
} from '@/lib/claims/defect-return'
import type { ReturnPhotoRejection } from '@/lib/claims/return-photos'
import type { SellerDecision } from '@/lib/sellers/decisions'

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
  /** The demo account banner and the button that issues one (TASK-0024). */
  readonly demo: DemoMessages
  /** The category console (TASK-0029). */
  readonly categories: CategoryMessages
  /** The attribute console (TASK-0031). */
  readonly attributes: AttributeMessages
  /** The seller onboarding review console (TASK-0110). */
  readonly sellers: SellerReviewMessages
  /** The claim intervention console (TASK-0071). */
  readonly claims: AdminClaimMessages
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

/**
 * The demo account: the button that issues one, and the banner that counts it
 * down (TASK-0024).
 *
 * Its own slice rather than more keys under `auth`. `auth` is about *being*
 * signed in and is read by one screen; this is read by the root layout on every
 * route, and the banner it draws is about the account rather than the session.
 *
 * `remaining` and `remainingMinutes` carry `{hours}` and `{minutes}`
 * placeholders. The numbers are handed to the catalog rather than assembled in
 * the component, because word order is a property of the language.
 */
export interface DemoMessages {
  /** What the banner calls itself inside the last hour (TASK-0025). */
  readonly endingSoonLabel: string
  /** Names the banner in place of an `aria-label`, so it is read either way. */
  readonly bannerLabel: string
  /** `{hours}` · `{minutes}` */
  readonly remaining: string
  /** `{minutes}` — the last hour, where "0시간 12분" would read as a bug. */
  readonly remainingMinutes: string
  readonly expired: string
  /** Replaces the button's label while the request is in flight. */
  readonly issuePending: string
  readonly issueFailedTitle: string
  readonly issueFailed: string
  /** The one refusal where waiting is the right next action. */
  readonly rateLimited: string
  readonly unreachable: string
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

/**
 * Everything `/claims`, `/claims/[id]` and the dashboard's attention panel say
 * (TASK-0071).
 *
 * One slice for the three, for the reason {@link CategoryMessages} gives: they
 * are one task in an operator's head — 「지금 손댈 클레임이 있나」 — and the
 * dashboard panel is that question asked from the other side of the console.
 *
 * **The vocabulary is its own record set, keyed by the contract's unions.** A
 * status added to `@shopping/shared` fails `pnpm typecheck` here rather than
 * rendering `RETURN_REJECTED` at an operator, which is the same device the
 * seller console uses.
 */
export interface AdminClaimMessages {
  readonly title: string
  readonly description: string
  readonly vocabulary: ClaimVocabularyMessages
  readonly scope: ClaimScopeMessages
  readonly list: AdminClaimListMessages
  readonly overdue: OverdueClaimMessages
  readonly failedRefunds: FailedRefundMessages
  readonly attention: ClaimAttentionMessages
  readonly detail: AdminClaimDetailMessages
  readonly force: ClaimForceMessages
  readonly defectReturn: DefectReturnMessages
  readonly appeal: ClaimAppealMessages
  /** Shown instead of the screen when the account may not read claims at all. */
  readonly forbiddenTitle: string
  /** One line per way a call can fail **before** the API answers. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/** The domain's own words, one per value of each union the API answers with. */
export interface ClaimVocabularyMessages {
  readonly statusLabels: Readonly<Record<ClaimStatus, string>>
  readonly typeLabels: Readonly<Record<ClaimType, string>>
  readonly faultLabels: Readonly<Record<ClaimFault, string>>
  readonly stageLabels: Readonly<Record<ClaimHandlingStage, string>>
  readonly returnReasonLabels: Readonly<Record<ReturnReason, string>>
  /** Who moved a claim. The history column an intervention is judged from. */
  readonly actorLabels: Readonly<Record<OrderActor, string>>
}

/**
 * What this console says about **the reach of its own writes** (F5).
 *
 * The screen never disables a control to express this. A `DEMO_ADMIN` holds
 * `claim.handle` narrowed to `demo`, and no response on this screen carries
 * `ownerIsDemo` — so per-row certainty is not available to it, and a greyed
 * button would be a guess with the reason hidden in a tooltip. Both sentences
 * below are things the screen can say truthfully instead: `demoNotice` before
 * anything is pressed, `outOfScope` after the server has answered about one
 * particular claim.
 */
export interface ClaimScopeMessages {
  readonly demoNotice: string
  /** The 403 the demo scope produces, said as a sentence about this claim. */
  readonly outOfScope: string
}

export interface AdminClaimListMessages {
  readonly tabs: {
    readonly label: string
    readonly all: string
    readonly overdue: string
    readonly failedRefunds: string
    /** The fourth tab is a place to **start** something, not a list to read. */
    readonly defectReturn: string
    /** `{name}` · `{count}` — a tab that carries a number carries it this way. */
    readonly countLabel: string
  }
  readonly listLabel: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** Empty *because of the filter*, which is a different emptiness. */
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly columns: AdminClaimColumnMessages
  readonly badges: {
    readonly overdue: string
    readonly appealPending: string
    readonly intervention: string
  }
  readonly narrow: AdminClaimNarrowMessages
  readonly filters: AdminClaimFilterMessages
  readonly pagination: {
    readonly label: string
    readonly previous: string
    readonly next: string
    readonly pageUnit: string
    readonly countUnit: string
  }
}

export interface AdminClaimColumnMessages {
  readonly orderNumber: string
  readonly seller: string
  readonly buyer: string
  readonly type: string
  readonly status: string
  readonly stage: string
  readonly items: string
  readonly requestedAt: string
  readonly dueAt: string
  readonly flags: string
  /** `{count}` — how many units the claim covers. */
  readonly quantity: string
}

/**
 * Narrowing to one store or one buyer.
 *
 * The filter exists in the contract as a uuid (`sellerId` · `buyerId`) and this
 * console has no endpoint that lists either exhaustively — the seller queue is
 * itself a page. So the choice is made **from a row**, where the value is real
 * and named, rather than from a select that would quietly omit whoever is not
 * on its first page.
 */
export interface AdminClaimNarrowMessages {
  /** `{name}` — the store's brand name, as the button's accessible name. */
  readonly seller: string
  /** `{id}` — the buyer's account id, shortened for the eye but whole in the name. */
  readonly buyer: string
  readonly activeSeller: string
  readonly activeBuyer: string
  readonly clear: string
}

export interface AdminClaimFilterMessages {
  readonly legend: string
  readonly statusLabel: string
  readonly statusAll: string
  readonly stageLabel: string
  readonly stageAll: string
  readonly typeLabel: string
  readonly typeAll: string
  readonly fromLabel: string
  readonly toLabel: string
  /** Why a day is enough: the API takes an instant and the console makes one. */
  readonly periodHint: string
  readonly appealedLabel: string
  readonly reset: string
}

export interface OverdueClaimMessages {
  readonly title: string
  readonly description: string
  readonly listLabel: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** The scan hit its ceiling — a backlog this size is an incident, not a page. */
  readonly truncatedNotice: string
}

export interface FailedRefundMessages {
  readonly title: string
  readonly description: string
  readonly listLabel: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly hasMoreNotice: string
  readonly columns: {
    readonly orderNumber: string
    readonly seller: string
    readonly status: string
    readonly amount: string
    readonly attempts: string
    readonly lastError: string
    readonly waitingSince: string
  }
  /** `{count}` — how many times the refund has been tried. */
  readonly attemptCount: string
  /** Nothing has been tried yet, which is not the same as "no error". */
  readonly noAttempt: string
  readonly noError: string
}

/**
 * The dashboard's slice of this screen (F7).
 *
 * The counts alone would make the panel a badge; the rows are what make it
 * usable, so it renders the same two tables the console does and links on.
 */
export interface ClaimAttentionMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly errorTitle: string
  /** `{count}` each. */
  readonly overdueCount: string
  readonly failedCount: string
  readonly allClear: string
  readonly link: string
}

export interface AdminClaimDetailMessages {
  readonly backLabel: string
  readonly title: string
  /** `{orderNumber}` */
  readonly subtitle: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly notFoundTitle: string
  readonly notFoundDescription: string
  readonly sections: {
    readonly actions: string
    readonly summary: string
    readonly items: string
    readonly request: string
    readonly appeal: string
    readonly intervention: string
    readonly history: string
  }
  readonly summary: {
    readonly type: string
    readonly status: string
    readonly fault: string
    readonly requestedBy: string
    readonly requestedAt: string
    readonly updatedAt: string
    readonly orderNumber: string
  }
  readonly items: {
    readonly caption: string
    readonly product: string
    readonly option: string
    readonly sku: string
    readonly quantity: string
    readonly noOption: string
  }
  readonly history: {
    readonly caption: string
    readonly at: string
    readonly change: string
    readonly actor: string
    readonly reason: string
    readonly created: string
    /** `{from}` → `{to}` */
    readonly step: string
    readonly noReason: string
    readonly empty: string
  }
  /**
   * The two directions of an intervention, which point at each other (F6).
   *
   * `overturnsClaimId` on the intervention, `overturnedByClaimIds` on the
   * rejection: the same fact from both ends, and the screen draws both so that
   * neither claim reads as an orphan.
   */
  readonly intervention: {
    readonly overturnsTitle: string
    readonly overturnsBody: string
    readonly openOriginal: string
    readonly overturnedTitle: string
    readonly overturnedBody: string
    /** `{index}` — interventions are a list, because a partial claim can be split. */
    readonly openIntervention: string
    readonly none: string
  }
  readonly actions: {
    readonly force: string
    readonly dismissAppeal: string
  }
  /**
   * Why this claim cannot be acted on, **as sentences rather than a grey button**
   * (TASK-0063 4.1 · this task's report).
   *
   * `state` is keyed by {@link InterventionBlock}, so a status that stops being
   * overturnable without a sentence here fails the typecheck.
   */
  readonly blocked: {
    readonly title: string
    readonly state: Readonly<Record<InterventionBlock, string>>
    /** Appended to TASK-0023's `reason(permission)`, which says *that* not *which*. */
    readonly permission: string
    readonly refusedTitle: string
  }
  readonly toast: {
    readonly regionLabel: string
    readonly closeLabel: string
    readonly forced: string
    readonly dismissed: string
  }
  readonly failureTitle: string
}

export interface ClaimForceMessages {
  readonly title: string
  readonly description: string
  /**
   * What actually happens, in four sentences rather than one paragraph.
   *
   * The 구매확정 dialog (TASK-0063) is the tone: a paragraph is not read, and
   * the two facts that matter here — somebody's money moves, somebody's stock
   * moves — are not the same fact.
   */
  readonly consequences: {
    readonly newClaim: string
    readonly money: string
    readonly appeal: string
    readonly irreversible: string
  }
  readonly itemsLabel: string
  readonly itemsCaption: string
  readonly faultLabel: string
  readonly faultHint: string
  readonly returnReasonLabel: string
  readonly returnReasonHint: string
  /** `{fault}` — what the chosen reason will be recorded as. */
  readonly faultPreview: string
  /** Why no amount is shown, said plainly rather than left as a blank. */
  readonly amountNotice: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
  readonly errors: {
    readonly reasonRequired: string
    readonly reasonTooLong: string
  }
}

/**
 * 확정 후 하자 반품 — the one entry point that begins at an **order** (F4).
 *
 * Everything else in this slice starts from a claim that already exists. This
 * one does not: the intervention it files has no original to overturn, so no row
 * of any list leads here and the screen has to find its target itself.
 *
 * Three things it must say, and the catalog is where they are said:
 *
 * | What | Why it is a sentence and not a control |
 * | --- | --- |
 * | 주문번호로는 찾을 수 없다 | There is no route from an order number to a seller's share. Leaving it unsaid makes an operator type the number they were given, once per attempt |
 * | 확정을 되돌린다 · 정산 회수가 따라온다 | The 구매확정 dialog in `apps/shop` is the tone. A paragraph is not read, and "money moves" and "a settlement has to be clawed back" are not the same fact |
 * | 단순 변심은 없다 | A reason missing from a list reads as an oversight unless the screen says why it is missing |
 */
export interface DefectReturnMessages {
  readonly title: string
  readonly description: string
  readonly consequences: {
    readonly reopens: string
    readonly money: string
    /** The M12 half: a settlement already paid has to be recovered. */
    readonly settlement: string
    readonly irreversible: string
  }
  readonly lookup: DefectReturnLookupMessages
  readonly blocked: {
    readonly title: string
    /** One sentence per state this screen cannot start from. */
    readonly state: Readonly<Record<DefectReturnBlock, string>>
  }
  readonly form: DefectReturnFormMessages
  readonly confirm: {
    readonly title: string
    readonly description: string
    readonly itemsCaption: string
    readonly confirm: string
    readonly cancel: string
    readonly closeLabel: string
  }
  readonly done: {
    readonly title: string
    readonly body: string
    readonly open: string
    readonly again: string
  }
  readonly failureTitle: string
}

/** Finding the seller's share, and saying what cannot be used to find it. */
export interface DefectReturnLookupMessages {
  readonly legend: string
  readonly label: string
  readonly hint: string
  readonly placeholder: string
  readonly submit: string
  /** Why an order number does not work here. Stays on screen, not an error. */
  readonly unavailableNotice: string
  readonly errors: Readonly<Record<Exclude<DefectReturnTarget, 'seller_order_id'>, string>>
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly notFoundTitle: string
  readonly notFoundDescription: string
}

/**
 * The photo box, and the two sentences that keep it from being sent empty.
 *
 * **Two screens draw this same box** — the confirmed-order defect return and the
 * dialog that overturns a rejected one (`ReturnPhotoField`) — because the server
 * asks both of them for the same thing: 하자·오배송 반품에는 사진이 필수
 * (`returnPhotoDecision`). One set of strings rather than two, so that the
 * sentence explaining *why* the button did nothing cannot drift between the two
 * places a photo is attached.
 *
 * `issues` is narrower here than the defect return form's own list: this
 * interface owns only what a photo box can be short of. A catalog satisfies it
 * with the wider record it already writes.
 */
export interface ReturnPhotoMessages {
  readonly photosLabel: string
  /** `{max}` — `RETURN_PHOTO_MAX_COUNT`, interpolated rather than written out. */
  readonly photosHint: string
  readonly photosDropLabel: string
  readonly photosDropActive: string
  readonly photosListLabel: string
  /** `{name}` — the file's name, so a remove button says which one. */
  readonly photoRemove: string
  readonly photoStatus: Readonly<Record<'uploading' | 'ready' | 'failed', string>>
  readonly photoFailures: Readonly<Record<ReturnPhotoRejection | 'storage', string>>
  /** Heading over what is still missing. Shown only after somebody pressed. */
  readonly issuesLabel: string
  readonly issues: Readonly<Record<ForceIssue, string>>
}

export interface DefectReturnFormMessages extends ReturnPhotoMessages {
  readonly found: string
  readonly itemsLegend: string
  readonly itemsHint: string
  /** `{product}` · `{option}` — the checkbox's accessible name. */
  readonly itemLabel: string
  readonly noOption: string
  /** `{count}` — what the server said is left, never a subtraction done here. */
  readonly remaining: string
  /** `{product}` — the quantity select's name, one per chosen row. */
  readonly quantityLabel: string
  readonly reasonLabel: string
  /** Why 단순 변심 is not in the list. The restriction, said rather than implied. */
  readonly reasonHint: string
  /** `{fault}` — what the chosen reason will be recorded as. */
  readonly faultPreview: string
  readonly noteLabel: string
  readonly noteHint: string
  readonly notePlaceholder: string
  readonly submit: string
  /** Everything this form can be short of — the photo box's two, and its own. */
  readonly issues: Readonly<Record<DefectReturnIssue, string>>
}

export interface ClaimAppealMessages {
  readonly pendingTitle: string
  readonly pendingBody: string
  readonly reviewedTitle: string
  readonly none: string
  readonly filedAt: string
  readonly reason: string
  readonly reviewedAt: string
  readonly outcome: string
  readonly outcomes: Readonly<Record<'UPHELD' | 'DISMISSED', string>>
  readonly reviewNote: string
  readonly noNote: string
  readonly dismiss: {
    readonly title: string
    readonly description: string
    readonly reasonLabel: string
    readonly reasonHint: string
    readonly reasonPlaceholder: string
    readonly confirm: string
    readonly cancel: string
    readonly closeLabel: string
    readonly errors: {
      readonly reasonRequired: string
      readonly reasonTooLong: string
    }
  }
}
