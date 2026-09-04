import type {
  DenialReason,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  SellerStatus,
} from '@shopping/shared'
import type { ImageUploadListLabels } from '@shopping/ui/components'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { ApiFailureReason } from '@/lib/api-failure'
import type { ErrorMessages } from '@/lib/errors'
import type { StoreFieldErrorMessages } from '@/lib/sellers/store-form'
import type { SessionRefusal } from '@/lib/auth/session-client'
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
   * Signing in, being kept out, and being told why (TASK-0023).
   *
   * Replaces the `layout.account` placeholder slot the shell has carried since
   * TASK-0019 — that popover said "M04 에서 이 자리에 들어옵니다", and this is M04.
   */
  readonly auth: AuthMessages
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
  /** Applying to sell, and the store settings that are the same form (TASK-0109). */
  readonly store: StoreMessages
}

/**
 * Everything `/apply` and `/settings` render.
 *
 * One slice for two routes because they are one screen: the five faces a store
 * can have are the same form with a different banner and a different verb
 * (TASK-0109 4장), so splitting the copy would be the first step towards
 * splitting the screen.
 */
export interface StoreMessages {
  /**
   * `/apply`'s heading. `/settings` takes its own from the sidebar entry
   * (`screenTitle`), which is what keeps the label somebody clicked and the
   * heading they land on the same words.
   */
  readonly applyTitle: string
  readonly applyDescription: string
  readonly settingsDescription: string
  /** Announced from the first frame while `GET /sellers/me` is in flight. */
  readonly loadingLabel: string
  readonly form: StoreFormMessages
  /** Result of the live brand name check, shown beside the field. */
  readonly availability: StoreAvailabilityMessages
  readonly status: StoreStatusMessages
  readonly conflict: StoreConflictMessages
  /** `/settings` reached by somebody who has no store. Points at `/apply`. */
  readonly absent: StoreAbsentMessages
  /** `GET /sellers/me` never answered. Not a refusal about the store. */
  readonly failure: StoreFailureMessages
}

export interface StoreFormMessages {
  readonly brandNameLabel: string
  readonly brandNameHint: string
  readonly slugLabel: string
  readonly slugHint: string
  /** Why the address cannot be edited once the store exists (TASK-0108 R4). */
  readonly slugLockedHint: string
  readonly introductionLabel: string
  readonly introductionHint: string
  readonly logoUrlLabel: string
  /** Says that the upload widget replaces this field in TASK-0033's successor. */
  readonly logoUrlHint: string
  /** One sentence per way an input can be wrong. Shape is the schema builder's. */
  readonly errors: StoreFieldErrorMessages
  /** Heading of the form level error box, above the fields. */
  readonly errorTitle: string
  /** Shown when a rejected submit placed nothing anywhere. */
  readonly submitFailed: string
  readonly applyLabel: string
  readonly reapplyLabel: string
  readonly saveLabel: string
  readonly appliedNotice: string
  readonly savedNotice: string
}

export type StoreAvailabilityMessages = Readonly<Record<'checking' | 'available' | 'taken', string>>

/**
 * The banner over the form, one per status.
 *
 * `label` is keyed by the contract's own union, so a status added to
 * `@shopping/shared` fails `pnpm typecheck` here rather than rendering a store
 * whose state has no name.
 */
export interface StoreStatusMessages {
  /** The badge over the banner. */
  readonly label: Readonly<Record<SellerStatus, string>>
  /**
   * What the banner says, keyed by the contract's union rather than reached by a
   * `switch`. A status added to `@shopping/shared` fails `pnpm typecheck` here
   * instead of rendering a store whose state has no words (TASK-0109 4장 —
   * 문자열 리터럴을 화면에 적지 않는다).
   */
  readonly notice: Readonly<Record<SellerStatus, StoreStatusNoticeMessages>>
  /** Precedes the sentence an operator wrote into `statusReason`. */
  readonly reasonLabel: string
}

export interface StoreStatusNoticeMessages {
  readonly title: string
  readonly body: string
}

export interface StoreConflictMessages {
  readonly title: string
  readonly body: string
  readonly reloadLabel: string
  readonly overwriteLabel: string
}

export interface StoreAbsentMessages {
  readonly title: string
  readonly body: string
  readonly applyLabel: string
}

export interface StoreFailureMessages {
  readonly title: string
  readonly retryLabel: string
  readonly requestIdLabel: string
  readonly requestIdHint: string
  readonly copyLabel: string
  readonly copiedLabel: string
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
  /**
   * The sidebar an account that cannot enter this console gets: the one screen
   * it can use (TASK-0109 4장).
   *
   * Not a filtered {@link ConsoleLayoutMessages.menu}. Filtering is by
   * permission and an applicant is a `BUYER`, which holds nearly every `*.read`
   * the menu gates on — so the filter would leave eight links that all bounce
   * off `ConsoleGuard`.
   */
  readonly onboardingMenu: ConsoleMenu
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
