import type {
  BulkIssueTarget,
  ClaimFault,
  CommissionScope,
  ClaimHandlingStage,
  ClaimStatus,
  ClaimType,
  CouponAudience,
  CouponDiscountType,
  CouponLifecycle,
  CouponScopeType,
  DenialReason,
  HealthStatus,
  NotificationType,
  OauthFailureReason,
  OauthNotice,
  OrderActor,
  OrderStatus,
  ProductStatus,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  ReturnReason,
  Role,
  SchedulerStatus,
  SellerSortKey,
  SellerStatus,
  SettlementApprovalFailure,
  SettlementItemType,
  SettlementStatus,
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
import type { CommissionFieldErrorMessages } from '@/lib/commissions/form-schema'
import type { PendingKey } from '@/lib/dashboard/dashboard-console'
import type { ExpiryStatus, PolicyField } from '@/lib/demo/demo-console'
import type { SchedulerNames } from '@/lib/dashboard/schedulers'
import type { BulkIssueOutcome, CouponCostGap } from '@/lib/coupons/platform-coupons'
import type { HandleFieldErrorMessages } from '@/lib/reports/handle-form'
import type { ReportEffect, ReportOutcome } from '@/lib/reports/outcomes'
import type { ReportRefusal, ReportScope } from '@/lib/reports/report-console'
import type { SellerDecision } from '@/lib/sellers/decisions'
import type { SettlementExportColumns } from '@/lib/settlements/csv'
import type { HoldFieldErrorMessages } from '@/lib/settlements/hold-form'
import type { CalculationLineKey } from '@/lib/settlements/settlement-console'
import type { SettlementAction } from '@/lib/settlements/transitions'

import type { OrderFilterIssue } from '@/lib/catalog/order-console'
import type { ProductRefusal } from '@/lib/catalog/product-console'
import type { StoreEventKind } from '@/lib/stores/store-console'
import type { PointsFieldErrorMessages, ReasonFieldErrorMessages } from '@/lib/users/forms'
import type { UserRefusal } from '@/lib/users/user-console'

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
  /** 플랫폼 부담 쿠폰의 발행자 콘솔 (TASK-0073). */
  readonly coupons: PlatformCouponMessages
  /** 수수료율 설정 (TASK-0079). */
  readonly commissions: CommissionMessages
  /** 정산 승인·지급 (TASK-0081). */
  readonly settlements: SettlementMessages
  /** 신고 목록과 처리 (TASK-0091). */
  readonly reports: ReportMessages
  /**
   * 알림함 — 상단바의 드롭다운과 `/notifications` (TASK-0090).
   *
   * `layout` 이 아니라 자기 슬라이스인 이유는 이것이 **화면 하나**이기 때문이다.
   * 셸이 빌려 쓰는 것은 상단바 슬롯의 이름 넷뿐이고(`slot`), 나머지는 페이지와
   * 드롭다운이 함께 읽는 같은 문장들이다. TASK-0019 가 자리만 잡아 둔
   * `layout.notifications` 팝오버를 대체한다 — 그 팝오버는 「알림함은 M11 에서 이
   * 자리에 들어옵니다」라고 말하고 있었고, 이것이 그 M11 이다.
   */
  readonly notifications: NotificationMessages
  /**
   * `/` — 플랫폼 전체를 한 화면에서 (TASK-0092).
   *
   * 자기 슬라이스인 이유는 이것이 **화면 하나**이기 때문이고, 그 화면이 읽는 문이
   * 셋이라 안에서 다시 셋으로 갈린다(`pending` · `metrics` · `system`). 셋을 하나로
   * 접지 않는 것은 계약이 셋인 것과 같은 이유다 — 한 섹션이 실패해도 나머지는
   * 그려지고, 그러려면 섹션마다 자기 오류 문장이 있어야 한다.
   */
  readonly dashboard: DashboardMessages
  /**
   * `/users` — 회원을 찾고, 사유를 적고 열어 보고, 조치한다 (TASK-0093).
   *
   * 자기 슬라이스인 이유는 이것이 **화면 하나**이기 때문이고, 그 안이 다시 갈리는
   * 것은 이 화면이 하는 일이 **읽기 하나와 쓰기 넷**이라서다. 넷은 각자 다른 자격을
   * 요구하고 각자 다른 사유를 받는다 — 한 덩어리로 접으면 「왜 이 버튼만 막혔는가」를
   * 말할 자리가 사라진다.
   */
  readonly users: UserMessages
  /**
   * `/sellers` 의 두 번째 탭 — **스토어 지표와 제재 이력** (TASK-0094).
   *
   * `sellers` 슬라이스와 **다른 것이다.** 저쪽은 「이 신청을 승인할까」를 묻는 M04 의
   * 심사 콘솔이고, 이쪽은 「어느 스토어를 봐야 하나」를 묻는다 — 계약의 경로가
   * `admin/sellers` 와 `admin/stores` 로 갈린 것과 같은 이유다 (4.3). 상태의 한국어
   * 이름만은 저쪽 것을 빌려 쓴다: 두 탭이 같은 상태를 다르게 부르면 그것이 한 화면인
   * 이유가 없어진다.
   */
  readonly stores: StoreMessages
  /**
   * `/products` — 모든 스토어의 상품, 그리고 강제로 내리기 (TASK-0095).
   *
   * 자기 슬라이스인 이유는 이것이 **화면 하나**이기 때문이고, 그 안이 갈리는 것은 이
   * 화면이 하는 일이 **읽기 하나와 쓰기 하나**라서다. 읽기는 `product.read` 이고
   * 쓰기는 `catalog.write` 인데, 데모 관리자에게는 그 쓰기가 `demo` 로 좁혀져 있다
   * (F8 · D-058) — 한 덩어리로 접으면 「왜 이것만 거절됐는가」를 말할 자리가 사라진다.
   */
  readonly adminProducts: AdminProductMessages
  /**
   * `/orders` — 모든 주문을 가로질러, 그리고 결제와 환불 (TASK-0095).
   *
   * **상태를 바꾸는 문구가 없고, 없다는 사실을 말하는 문구가 있다** (F7 · 4.4).
   * 버튼이 그냥 없으면 읽는 사람은 그것을 자기 권한 문제로 읽고 다른 계정으로 다시
   * 들어와 본다.
   */
  readonly adminOrders: AdminOrderMessages
  /**
   * `/demo` — 발급된 데모 계정과 정리 상태 (TASK-0096).
   *
   * `demo` 슬라이스와 **다른 것이다.** 저쪽은 방문자가 데모 계정을 받는 배너와
   * 버튼이고 루트 레이아웃이 모든 라우트에서 읽는다. 이쪽은 운영자가 그 계정들을
   * 들여다보는 화면 하나다.
   */
  readonly demoConsole: DemoConsoleMessages
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
  /**
   * 심사 탭의 이름.
   *
   * `/sellers` 가 두 가지를 하게 되면서(TASK-0094) 이 문자열은 페이지의 제목이 아니라
   * **탭 하나의 이름**이 되었다. 페이지의 제목은 사이드바에서 나온다 (`screenTitle`).
   */
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

/**
 * `/coupons` 가 말하는 것 전부 (TASK-0073).
 *
 * 화면 하나에 한 조각이다 — 목록·발행 폼·일괄 지급 대화상자는 운영자의 머릿속에서 한
 * 가지 일이고, 컴포넌트 경계를 따라 쪼갠 문구는 서로 어긋나기 시작한다
 * ({@link CategoryMessages} 가 같은 이유로 그렇게 되어 있다).
 *
 * `errors` 는 **여기 없다.** API 가 답하는 것은 전부 위쪽 `errors` 조각에 코드로
 * 키가 잡혀 있고, 기능마다 사본을 두면 그 사본이 언젠가 다른 말을 한다 (TASK-0117 4.2).
 */
export interface PlatformCouponMessages {
  readonly title: string
  readonly description: string
  /**
   * 부담 주체를 말하는 한 벌 — **폼과 목록이 같은 문장을 쓴다** (F2).
   *
   * 두 곳에 따로 적으면 한쪽만 고쳐지고, 그때 「판매자 정산에서 차감되지 않는다」가
   * 화면마다 다른 말이 된다. 그 사실이 이 화면의 존재 이유이므로 문장은 한 벌이다.
   */
  readonly burden: CouponBurdenMessages
  /** 다섯 상태의 이름. `Record` 라 상태가 늘면 여기가 typecheck 에서 걸린다. */
  readonly lifecycleLabels: Readonly<Record<CouponLifecycle, string>>
  /** 어느 그룹에 닿는 쿠폰인가 (D-224). 「체험용」이 그중 하나다. */
  readonly audienceLabels: Readonly<Record<CouponAudience, string>>
  readonly discountTypeLabels: Readonly<Record<CouponDiscountType, string>>
  readonly scopeTypeLabels: Readonly<Record<CouponScopeType, string>>
  /**
   * 이 화면을 아예 볼 수 없는 계정에게. **목록의 오류 제목과 다른 문장이다** —
   * 「불러오지 못했어요」는 다시 시도하면 될 것처럼 읽히는데, 이것은 아무리 눌러도
   * 되지 않는다.
   */
  readonly forbiddenTitle: string
  /** 데모 관리자가 무엇까지 할 수 있는지, 그리고 서버가 거절했을 때의 한 줄 (F7). */
  readonly scope: CouponScopeMessages
  readonly tabs: {
    readonly label: string
    readonly list: string
    readonly issue: string
  }
  readonly list: CouponListMessages
  readonly form: CouponFormMessages
  readonly bulk: CouponBulkIssueMessages
  /** 발급 뒤에 뜨는 짧은 알림. 되돌릴 수 있는 일이라 배너가 아니라 토스트다. */
  readonly toast: CouponToastMessages
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

export interface CouponBurdenMessages {
  /** 목록의 모든 줄에 붙는 뱃지. 이 화면에는 플랫폼 쿠폰만 있다. */
  readonly badge: string
  /** 목록 위 한 줄 — 여기 있는 것이 전부 플랫폼 몫이라는 사실. */
  readonly listNotice: string
  /** 폼 안 한 줄 — 지금 만드는 것이 누구 돈인지. */
  readonly formNotice: string
}

export interface CouponScopeMessages {
  /** 데모 관리자에게 늘 참인 문장. 무엇을 누르기 전에 선다. */
  readonly demoNotice: string
  /** 서버가 이 한 건을 거절한 뒤. 데모 계정에게만 이 문장이 나간다. */
  readonly outOfScope: string
}

export interface CouponListMessages {
  readonly listLabel: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** 조건이 걸려 있어 비었을 때. 「없다」와 다른 말이다. */
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly columns: CouponColumnMessages
  readonly filters: {
    readonly legend: string
    readonly lifecycleLabel: string
    readonly lifecycleAll: string
    readonly fromLabel: string
    readonly toLabel: string
    /**
     * 기간이 「걸침」이라는 것과, 하루의 경계가 어디인지.
     *
     * 감추면 「9월 1일부터」로 좁힌 사람이 8월에 시작한 쿠폰을 보고 필터가 고장 난
     * 줄 안다 — 그것이 계약이 고른 규칙이고(겹침), 화면이 말하지 않으면 아무도
     * 모른다.
     */
    readonly periodHint: string
    readonly reset: string
  }
  /**
   * 필터와 페이지에 **무관한** 누계 (F6).
   *
   * 보이는 줄들의 합이 아니라 플랫폼이 낸 모든 쿠폰의 합이다. 그 사실을 적어 두지
   * 않으면 상태를 좁힌 사람이 「합계가 안 바뀐다」를 버그로 읽는다.
   */
  readonly totals: {
    readonly title: string
    readonly usedLabel: string
    readonly discountLabel: string
    readonly scopeNote: string
  }
  /** 칸 하나가 그리는 짧은 값들. 자리 표시자는 서버가 실어 보낸 숫자로 채운다. */
  readonly values: {
    /** `10% · 최대 5,000원` 의 뒷부분. */
    readonly ceiling: string
    /** 최소 주문금액이 있는 쿠폰에만. */
    readonly minimum: string
    /** 수량이 `null` 인 쿠폰. 「0장」이 아니라 「무제한」이다. */
    readonly unlimited: string
    /** `240 / 1,000장`. */
    readonly issued: string
    readonly issuedUnlimited: string
    /** `120장 · 50%`. */
    readonly used: string
    /** `2026. 9. 1. ~ 2026. 9. 30.` */
    readonly period: string
    readonly code: string
    readonly noCode: string
  }
  readonly actions: {
    readonly suspend: string
    readonly resume: string
    readonly bulkIssue: string
    /**
     * 중단된 쿠폰에서 지급 버튼을 대신하는 문장.
     *
     * 서버가 `COUPON_SUSPENDED` 로 거절하므로 버튼을 두면 누를 때마다 거절이다.
     * 다음에 할 일이 **재개**라는 것까지 말한다 — 그 버튼은 바로 옆에 있다.
     */
    readonly suspendedNoIssue: string
    /**
     * 끝난 쿠폰의 자리에 버튼 대신 서는 문장.
     *
     * 회색 버튼을 쓰지 않는 이유는 이 콘솔의 다른 자리와 같다 (TASK-0063 4.1) —
     * 못 누르는 컨트롤은 키보드가 건너뛰고, 그래서 왜 못 누르는지도 읽히지 않는다.
     */
    readonly ended: string
  }
  readonly pagination: {
    readonly label: string
    readonly previous: string
    readonly next: string
    readonly pageUnit: string
    readonly countUnit: string
  }
}

export interface CouponColumnMessages {
  readonly name: string
  readonly burden: string
  readonly discount: string
  readonly period: string
  readonly issued: string
  readonly used: string
  readonly discountTotal: string
  readonly lifecycle: string
  readonly actions: string
}

export interface CouponFormMessages {
  readonly title: string
  readonly description: string
  readonly nameLabel: string
  readonly namePlaceholder: string
  readonly discountTypeLabel: string
  /** 유형을 아직 고르지 않았을 때. 단위를 말할 수 없으므로 값만 말한다. */
  readonly discountValueLabel: string
  /** 유형마다 값의 뜻이 다르다 — 원인가 퍼센트인가. */
  readonly discountValueLabels: Readonly<Record<CouponDiscountType, string>>
  readonly discountValueHints: Readonly<Record<CouponDiscountType, string>>
  readonly maxDiscountLabel: string
  readonly maxDiscountHint: string
  readonly minOrderLabel: string
  readonly minOrderHint: string
  readonly scopeTypeLabel: string
  readonly categoryLabel: string
  readonly categoryPlaceholder: string
  /** 카테고리 이름 사이의 구분자. `여성 › 아우터 › 코트`. */
  readonly categorySeparator: string
  readonly categoryLoading: string
  /**
   * 상품·판매자 범위를 왜 고를 수 없는지.
   *
   * 계약에는 넷이 있지만 이 콘솔에는 상품과 판매자를 빠짐없이 답하는 엔드포인트가
   * 없다. 첫 페이지만 담은 셀렉트는 거기 없는 것을 조용히 못 고르게 만들므로,
   * 반쪽짜리 목록을 내는 대신 **왜 없는지**를 적는다.
   */
  readonly scopeUnsupported: string
  readonly validFromLabel: string
  readonly validUntilLabel: string
  readonly periodHint: string
  readonly issueLimitLabel: string
  readonly issueLimitHint: string
  readonly withCodeLabel: string
  readonly withCodeHint: string
  readonly submit: string
  readonly submitting: string
  /** 서버가 이 폼의 어느 칸도 가리키지 않고 거절했을 때. */
  readonly submitError: string
  readonly cost: CouponCostMessages
  readonly confirm: CouponConfirmMessages
  /** 보내기 전에 이 폼이 스스로 말하는 것. */
  readonly errors: {
    readonly nameRequired: string
    readonly nameTooLong: string
    readonly discountTypeRequired: string
    readonly discountValueRequired: string
    readonly percentOutOfRange: string
    readonly amountOutOfRange: string
    readonly minOrderInvalid: string
    readonly issueLimitInvalid: string
    readonly periodRequired: string
    readonly periodInverted: string
    readonly categoryRequired: string
  }
}

export interface CouponCostMessages {
  readonly title: string
  /** 아직 채워지지 않았다. 숫자 대신 이 한 줄이 선다. */
  readonly incomplete: string
  readonly perCouponLabel: string
  readonly totalLabel: string
  /** `1,000장 × 5,000원`. 곱셈을 보여 주는 것이 숫자 하나보다 낫다. */
  readonly formula: string
  /** 이 값이 상한이지 예측이 아니라는 사실. */
  readonly caveat: string
  readonly unboundedTitle: string
  /** 왜 계산할 수 없는지 — 구멍마다 할 일이 다르다. */
  readonly gaps: Readonly<Record<CouponCostGap, string>>
}

export interface CouponConfirmMessages {
  readonly title: string
  readonly description: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
}

export interface CouponBulkIssueMessages {
  readonly title: string
  readonly description: string
  readonly targetLabel: string
  readonly targetLabels: Readonly<Record<BulkIssueTarget, string>>
  readonly targetHints: Readonly<Record<BulkIssueTarget, string>>
  readonly confirm: string
  readonly submitting: string
  readonly cancel: string
  readonly close: string
  readonly closeLabel: string
  readonly resultTitle: string
  /**
   * 한 번의 지급이 무슨 일이었나 — 네 가지.
   *
   * 「0장 나갔습니다」가 셋으로 갈리기 때문이다(`bulkIssueOutcomeOf`): 모두 이미
   * 갖고 있거나, 수량이 다 찼거나, 조건에 맞는 사람이 없거나. 셋에 발행자가 할 일이
   * 전부 다르므로 문장도 셋이다. `{count}` 는 사건마다 다른 수를 가리킨다 —
   * 나간 수이거나, 이미 갖고 있는 사람 수이거나, 아무것도 아니다.
   */
  readonly outcomes: Readonly<Record<BulkIssueOutcome, string>>
  /** 나간 지급에 딸리는 한 줄. 이미 갖고 있어 건너뛴 사람이 있었을 때만. */
  readonly skipped: string
  /**
   * 아직 남았다는 사실 — **숫자를 적지 않는다.**
   *
   * 서버가 싣는 `remaining` 은 한 번에 훑는 상한(`BULK_ISSUE_MAX_RECIPIENTS`)보다 한
   * 명 더 읽어 얻은 값이라 「남았는가」에는 답하지만 「몇 명인가」에는 답하지 않는다.
   * 그것을 인원수로 적으면 수천 명이 남았는데 「1명 남았어요」라고 말하게 된다.
   */
  readonly remaining: string
}

export interface CouponToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly created: string
  readonly suspended: string
  readonly resumed: string
  readonly failedTitle: string
}

/**
 * `/commissions` 가 말하는 것 전부 (TASK-0079).
 *
 * 화면 하나에 한 조각이다 — 지금 요율·바꾸는 폼·미리보기·이력은 운영자의 머릿속에서
 * 한 가지 일이고, 컴포넌트 경계를 따라 쪼갠 문구는 서로 어긋나기 시작한다
 * ({@link PlatformCouponMessages} 가 같은 이유로 그렇게 되어 있다).
 *
 * `errors` 는 **여기 없다.** API 가 답하는 것은 전부 위쪽 `errors` 조각에 코드로 키가
 * 잡혀 있고, 기능마다 사본을 두면 그 사본이 언젠가 다른 말을 한다 (TASK-0117 4.2).
 */
export interface CommissionMessages {
  readonly title: string
  readonly description: string
  /**
   * 이 화면을 아예 볼 수 없는 계정에게. **목록의 오류 제목과 다른 문장이다** —
   * 「불러오지 못했어요」는 다시 시도하면 될 것처럼 읽히는데, 이것은 아무리 눌러도
   * 되지 않는다.
   */
  readonly forbiddenTitle: string
  /**
   * 세 범위의 이름. `Record` 라 계약에 범위가 하나 늘면 여기가 typecheck 에서 걸린다.
   *
   * 목록의 절 제목이자 라디오의 항목이라 **한 벌뿐이다.** 두 곳에 따로 적으면 고른
   * 것과 그것이 나타나는 절의 이름이 달라진다.
   */
  readonly scopeLabels: Readonly<Record<CommissionScope, string>>
  readonly open: CommissionOpenRatesMessages
  readonly editor: CommissionEditorMessages
  readonly simulation: CommissionSimulationMessages
  readonly history: CommissionHistoryMessages
  /** 저장 뒤에 뜨는 짧은 알림. 되돌릴 수 있는 일이라 배너가 아니라 토스트다. */
  readonly toast: CommissionToastMessages
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/** 지금 유효한 요율들 — 세 절로 나뉜 목록 (F1 · F2 · F3). */
export interface CommissionOpenRatesMessages {
  readonly title: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  /**
   * 세 절이 왜 그 순서인지 — 판매자 개별율이 카테고리를, 카테고리가 전역을 이긴다.
   *
   * 목록 위에 서지 않으면 세 요율이 동시에 걸린 스토어에서 **어느 것이 적용되는지**를
   * 화면이 말하지 않는 것이 된다.
   */
  readonly priorityNotice: string
  readonly globalTitle: string
  /**
   * 전역 요율이 아직 설정되지 않았다. `{rate}` 는 그때 쓰이는 폴백이다.
   *
   * 「0%」가 아니라 이 문장인 이유는 계약이 적어 둔 그대로다: 「설정을 안 했다」와
   * 「수수료를 받지 않기로 했다」는 다른 결정이다.
   */
  readonly globalUnset: string
  readonly categoryTitle: string
  readonly categoryEmpty: string
  readonly sellerTitle: string
  readonly sellerEmpty: string
  readonly categoryListLabel: string
  readonly sellerListLabel: string
  readonly columns: {
    readonly target: string
    readonly rate: string
    /** 이 요율이 언제부터 적용됐나. 끝은 없다 — 열려 있는 행이므로. */
    readonly since: string
    readonly changedBy: string
  }
  /** `여성 › 아우터 › 코트` 의 구분자. */
  readonly categorySeparator: string
  /**
   * 이름을 찾지 못한 대상. `{id}` 가 그 자리에 남는다.
   *
   * 빈칸으로 두지 않는다 — 요율은 걸려 있는데 어디에 걸렸는지 화면이 말하지 못하면,
   * 그것을 지우거나 고칠 방법도 없다.
   */
  readonly unknownTarget: string
}

/** 한 범위의 요율을 바꾸는 자리 (F1 · F2 · F7). */
export interface CommissionEditorMessages {
  readonly title: string
  readonly description: string
  readonly scopeLabel: string
  readonly categoryLabel: string
  readonly categoryPlaceholder: string
  readonly categoryLoading: string
  readonly sellerLabel: string
  readonly sellerPlaceholder: string
  readonly sellerLoading: string
  /** 스토어 목록을 못 받았다. 전역·카테고리 요율은 그래도 바꿀 수 있다. */
  readonly sellerUnavailable: string
  /**
   * 목록이 잘려 있다는 사실.
   *
   * 콘솔에 스토어를 **찾는** 엔드포인트가 없어 심사 큐의 첫 페이지를 쓴다
   * (`use-sellers.ts`). 반쪽짜리 목록을 말없이 내면, 거기 없는 스토어를 고르려던
   * 사람은 그 스토어가 없다고 읽는다.
   */
  readonly sellerNotice: string
  /** 이 범위에 지금 걸린 요율. `{rate}` 하나를 품은 한 줄이다. */
  readonly currentLabel: string
  /** 이 범위에는 아직 요율이 없다. `{rate}` 는 그때 실제로 쓰이는 폴백. */
  readonly currentUnset: string
  readonly rateLabel: string
  /** 어떤 모양으로 쓰는가 — 소수점 아래 둘째 자리까지. */
  readonly rateHint: string
  readonly ratePlaceholder: string
  readonly submit: string
  readonly submitting: string
  /** 서버가 이 폼의 어느 칸도 가리키지 않고 거절했을 때. */
  readonly submitError: string
  /**
   * 누르기 전에 한 번 더 묻는 자리.
   *
   * 이미 팔린 것에는 소급되지 않지만(F4), 잘못 바꾼 채 하루가 지나면 그날 판 것
   * 전부가 잘못된 요율로 굳는다 — 되돌릴 수 있다는 것이 위험을 줄여 주지 않는
   * 종류의 값이다 (`permissions.ts` 의 `commission.write`).
   */
  readonly confirm: {
    readonly title: string
    /** `{scope}` 와 `{rate}` — 무엇을 몇 퍼센트로 바꾸는지. */
    readonly description: string
    readonly confirm: string
    readonly cancel: string
    readonly closeLabel: string
  }
  /** 보내기 전에 이 폼이 스스로 말하는 것. */
  readonly errors: CommissionFieldErrorMessages
}

/** 바꾸면 얼마가 달라지나 (F6). */
export interface CommissionSimulationMessages {
  readonly title: string
  /** 아직 물어볼 것이 없다 — 범위나 요율이 비어 있다. */
  readonly idle: string
  readonly loadingLabel: string
  readonly errorTitle: string
  /** `{days}` · `{sales}` · `{current}` · `{proposed}` 를 한 줄로. */
  readonly summary: string
  readonly orderCount: string
  /**
   * 돌아본 기간에 팔린 것이 없다.
   *
   * **「0원 → 0원」을 그리지 않는다.** 그 두 숫자는 「영향이 없다」로 읽히는데,
   * 실제로는 「비교할 근거가 없다」이고 둘은 전혀 다른 말이다.
   */
  readonly nothingTitle: string
  readonly nothingDescription: string
  /** 이 숫자가 예측이 아니라 「지난달에 이랬다면」이라는 사실. */
  readonly caveat: string
}

/** 이 범위가 지나온 요율 (F5). */
export interface CommissionHistoryMessages {
  readonly title: string
  readonly description: string
  /** 범위를 아직 완결하지 않았다. */
  readonly idle: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly listLabel: string
  readonly columns: {
    readonly changedAt: string
    readonly change: string
    readonly changedBy: string
  }
  /** `3.5% → 4%`. */
  readonly change: string
  /** 처음 설정된 줄. 「무엇에서」가 없으므로 화살표도 없다. `{to}` 하나뿐이다. */
  readonly firstChange: string
}

export interface CommissionToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  /** `{scope}` 를 `{rate}` 로. */
  readonly saved: string
  readonly failedTitle: string
}

/**
 * `/settlements` 와 `/settlements/[id]` 가 말하는 것 전부 (TASK-0081).
 *
 * 화면이 둘인데 조각이 하나다 — 목록과 상세는 운영자의 머릿속에서 한 가지 일이고,
 * 상태 이름·항목 유형·실패 사유처럼 **양쪽이 함께 쓰는 어휘**가 두 벌이 되면 목록의
 * 「보류」와 상세의 「보류」가 언젠가 다른 말이 된다 ({@link AdminClaimMessages} 가
 * 같은 이유로 같은 모양이다).
 *
 * `errors` 는 **여기 없다.** API 가 답하는 것은 전부 위쪽 `errors` 조각에 코드로
 * 키가 잡혀 있고(`SETTLEMENT_WRONG_STATUS` 도 거기 있다), 기능마다 사본을 두면 그
 * 사본이 언젠가 다른 말을 한다 (TASK-0117 4.2).
 */
export interface SettlementMessages {
  readonly title: string
  readonly description: string
  /**
   * 이 화면을 아예 볼 수 없는 계정에게. **목록의 오류 제목과 다른 문장이다** —
   * 「불러오지 못했어요」는 다시 시도하면 될 것처럼 읽히는데, 이것은 아무리 눌러도
   * 되지 않는다.
   */
  readonly forbiddenTitle: string
  /**
   * 네 상태의 이름. `Record` 라 계약에 상태가 하나 늘면 여기가 typecheck 에서
   * 걸린다 — 그리고 그 상태는 이름 없이 화면에 나타날 수 없다.
   */
  readonly statusLabels: Readonly<Record<SettlementStatus, string>>
  /**
   * 정산서 줄의 두 유형.
   *
   * 차감 줄이 판매 줄과 **눈에 띄게 달라 보여야** 한다 — 금액이 음수이고, 이번
   * 회차의 판매가 아니라 지난 회차의 되돌림이기 때문이다.
   */
  readonly itemTypeLabels: Readonly<Record<SettlementItemType, string>>
  readonly list: SettlementListMessages
  readonly detail: SettlementDetailMessages
  readonly actions: SettlementActionMessages
  readonly bulk: SettlementBulkMessages
  readonly export: SettlementExportMessages
  /** 처리 뒤에 뜨는 짧은 알림. */
  readonly toast: SettlementToastMessages
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/** 정산서 목록 — 회차·판매자·상태로 좁히고, 필터의 총액을 본다. */
export interface SettlementListMessages {
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** 좁혀 놓고 아무것도 안 나왔을 때. 「없다」와 뜻이 다르다. */
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  readonly columns: {
    readonly select: string
    readonly period: string
    readonly brandName: string
    readonly status: string
    readonly salesAmount: string
    readonly payoutAmount: string
    readonly holdReason: string
    readonly open: string
  }
  /** `8월 24일 ~ 8월 30일`. 끝은 **포함하는 날**로 그린다 (`inclusiveEnd`). */
  readonly period: string
  /** 한 줄을 고르는 체크박스의 이름. `{brand}` 가 들어간다. */
  readonly selectRow: string
  /** 이 페이지에서 승인할 수 있는 줄을 전부 고르는 체크박스. */
  readonly selectPage: string
  /** 승인할 수 없는 상태라 고를 수 없는 줄. */
  readonly notSelectable: string
  readonly openLabel: string
  readonly filters: {
    readonly legend: string
    readonly dayLabel: string
    /** 아무 날이나 고르면 **그 날이 속한 회차**를 본다는 사실. */
    readonly dayHint: string
    /** 고른 날이 접힌 회차. `{period}` 하나를 품는다. */
    readonly resolved: string
    readonly statusLabel: string
    readonly statusAll: string
    readonly reset: string
  }
  /** 지금 판매자로 좁혀 두었다는 칩. */
  readonly narrow: {
    readonly activeSeller: string
    readonly clear: string
  }
  /**
   * 필터가 고른 것 전체의 합계 (F: 정산 총액 요약).
   *
   * **`scopeNotice` 를 빼면 이 숫자가 거짓말이 된다.** 20건짜리 표 위에 200건의
   * 합이 서 있는데 그 사실을 적지 않으면, 읽는 사람은 화면의 스무 줄을 더해 보고
   * 숫자가 틀렸다고 판단한다.
   */
  readonly totals: {
    readonly title: string
    readonly payoutLabel: string
    readonly countLabel: string
    readonly countValue: string
    readonly scopeNotice: string
  }
  readonly pagination: {
    readonly label: string
    readonly next: string
    readonly previous: string
    readonly pageUnit: string
    readonly countUnit: string
  }
}

/** 정산서 한 장 — 계산 근거와 항목 (F1 · F2). */
export interface SettlementDetailMessages {
  readonly backLabel: string
  readonly title: string
  /** `{brand}` 의 `{period}` 회차. */
  readonly subtitle: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly notFoundTitle: string
  readonly notFoundDescription: string
  readonly sections: {
    readonly actions: string
    readonly summary: string
    readonly calculation: string
    readonly items: string
  }
  readonly summary: {
    readonly brandName: string
    readonly period: string
    readonly status: string
    readonly createdAt: string
    readonly heldAt: string
    readonly approvedAt: string
    readonly paidAt: string
    readonly holdReason: string
    /** 아직 일어나지 않은 일. 빈칸으로 두면 「못 읽었다」와 같아진다. */
    readonly none: string
  }
  /**
   * TASK-0081 4장이 그린 다섯 줄.
   *
   * `Record` 라 줄이 하나 늘면 문구가 없는 것을 typecheck 이 잡는다. 「− 수수료」의
   * 빼기 기호까지 문구에 들어 있다 — 금액의 부호는 `Intl` 이 그리고, 줄 이름은
   * **무엇을 빼는 중인지**를 말한다.
   */
  readonly calculation: {
    readonly caption: string
    readonly lines: Readonly<Record<CalculationLineKey, string>>
    /** 이 표가 서버의 계산을 **되풀이해 그린 것**이라는 사실. */
    readonly note: string
  }
  readonly items: {
    readonly caption: string
    readonly empty: string
    readonly columns: {
      readonly type: string
      readonly orderNumber: string
      readonly salesAmount: string
      readonly commissionAmount: string
      readonly sellerCouponAmount: string
      readonly payoutAmount: string
    }
    /** 주문으로 내려가는 링크의 이름 (F2). `{orderNumber}` 가 들어간다. */
    readonly openOrder: string
    /** 관리자 주문 화면이 아직 오지 않았다는 사실 (TASK-0095). */
    readonly openOrderHint: string
    /** 차감 줄이 왜 음수인지. 표 위의 한 줄이다. */
    readonly adjustmentNotice: string
  }
}

/** 승인 · 보류 · 지급 (F3 · F4 · F5 · F7). */
export interface SettlementActionMessages {
  /** 버튼의 이름. `Record` 라 판단이 하나 늘면 여기가 걸린다. */
  readonly labels: Readonly<Record<SettlementAction, string>>
  /**
   * 더 옮길 곳이 없는 정산서 (F5).
   *
   * 비활성 버튼이 아니라 **문장**이다. 지급완료에서 나가는 화살표는 없고, 그것은
   * 권한 문제가 아니라 이 정산서의 성질이라 「권한이 없어요」로 말할 수 없다.
   */
  readonly locked: {
    readonly title: string
    readonly description: string
  }
  /** 처리가 거절됐을 때 버튼 위에 서는 배너. */
  readonly failedTitle: string
  /**
   * 누르기 전에 한 번 더 묻는 자리 (R1).
   *
   * 지급 확정에는 **금액이 다시 적힌다.** 잘못 지급하면 되돌리는 화살표가 없고
   * (`settlementTransitions`), 오류는 다음 회차에서 조정할 수밖에 없다.
   */
  readonly confirm: {
    readonly approve: SettlementConfirmMessages
    readonly pay: SettlementConfirmMessages
  }
  /** 보류 대화상자 — 사유 없이는 나갈 수 없다 (F4). */
  readonly hold: {
    readonly title: string
    readonly description: string
    readonly reasonLabel: string
    readonly reasonHint: string
    readonly reasonPlaceholder: string
    readonly submit: string
    readonly submitting: string
    readonly cancel: string
    readonly closeLabel: string
    /** 서버가 이 폼의 어느 칸도 가리키지 않고 거절했을 때. */
    readonly submitError: string
    readonly errors: HoldFieldErrorMessages
  }
}

export interface SettlementConfirmMessages {
  readonly title: string
  /** `{brand}` · `{period}` · `{amount}` 를 품는다. */
  readonly description: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
}

/** 일괄 승인 (F6). */
export interface SettlementBulkMessages {
  /** `{count}` 건을 골랐다. */
  readonly selected: string
  readonly approve: string
  readonly approving: string
  readonly clear: string
  /** 한 번에 보낼 수 있는 상한을 넘겼다. `{max}` 가 들어간다. */
  readonly tooMany: string
  readonly confirm: SettlementConfirmMessages
  /**
   * 결과 — **실패한 것을 조용히 빼지 않는다.**
   *
   * 「10건 골랐는데 8건이 승인됐다」를 화면이 말하지 못하면 남은 2건은 아무도 다시
   * 보지 않고, 그 2건이야말로 사람이 봐야 하는 것들이다.
   */
  readonly result: {
    readonly title: string
    readonly approved: string
    readonly failedTitle: string
    readonly failedDescription: string
    readonly reasons: Readonly<Record<SettlementApprovalFailure, string>>
    readonly listLabel: string
    readonly columns: {
      readonly settlement: string
      readonly reason: string
    }
    readonly open: string
    readonly dismiss: string
  }
}

/** CSV 내보내기 (F8). */
export interface SettlementExportMessages {
  readonly label: string
  readonly exporting: string
  /** 내보낼 것이 없다. 필터가 아무것도 고르지 못한 자리다. */
  readonly empty: string
  /** `{count}` 건을 받았다. */
  readonly done: string
  /** 파일 이름의 앞부분. 날짜가 뒤에 붙는다. */
  readonly filePrefix: string
  /** 이 파일이 **지금 필터가 고른 전부**라는 사실 — 화면의 한 페이지가 아니라. */
  readonly note: string
  readonly columns: SettlementExportColumns
  /**
   * 보류된 적이 없는 줄의 사유 칸 — **빈 문자열이다.**
   *
   * 화면의 표는 그 자리에 `—` 를 그리지만(빈칸은 「없다」와 「못 읽었다」를 섞는다),
   * 스프레드시트에서 대시는 정렬과 필터에 걸리는 값이 된다. 사유가 적힌 줄만 골라
   * 보려는 사람이 거르는 것이 정확히 그 빈칸이다.
   */
  readonly emptyHoldReason: string
}

export interface SettlementToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly approved: string
  readonly held: string
  readonly paid: string
  /** `{count}` 건을 승인했다. 실패가 있으면 그것은 토스트가 아니라 표로 남는다. */
  readonly bulkApproved: string
  readonly exported: string
  readonly failedTitle: string
}

/* --------------------------------------------------- 신고 처리 (TASK-0091) -- */

export interface ReportMessages {
  readonly title: string
  readonly description: string
  /**
   * 이 화면을 아예 볼 수 없는 계정에게. **목록의 오류 제목과 다른 문장이다** —
   * 「불러오지 못했어요」는 다시 시도하면 될 것처럼 읽히는데, 이것은 아무리 눌러도
   * 되지 않는다.
   */
  readonly forbiddenTitle: string
  /**
   * 네 상태의 이름. `Record` 라 계약에 상태가 하나 늘면 여기가 typecheck 에서
   * 걸린다 — 그리고 그 상태는 이름 없이 화면에 나타날 수 없다.
   */
  readonly statusLabels: Readonly<Record<ReportStatus, string>>
  /** 신고할 수 있는 네 가지 대상. */
  readonly targetTypeLabels: Readonly<Record<ReportTargetType, string>>
  /**
   * 왜 신고했나 — 계약이 목록을 고정한 다섯 가지.
   *
   * 자유 입력이 아닌 이유는 분류를 위해서다(`reports.ts`). 화면이 그 다섯을 이름으로
   * 부르지 못하면 분류는 다시 한 건씩 읽는 일이 된다.
   */
  readonly reasonLabels: Readonly<Record<ReportReason, string>>
  readonly list: ReportListMessages
  readonly handle: ReportHandleMessages
  /** 처리 뒤에 뜨는 짧은 알림. */
  readonly toast: ReportToastMessages
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/** 신고 목록 — 상태·대상으로 좁히고, 발췌와 신고 횟수로 판단한다. */
export interface ReportListMessages {
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** 좁혀 놓고 아무것도 안 나왔을 때. 「없다」와 뜻이 다르다. */
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  readonly columns: {
    readonly createdAt: string
    readonly target: string
    readonly reason: string
    readonly status: string
    readonly excerpt: string
    readonly handle: string
  }
  /** 필터가 고를 수 있는 다섯 묶음의 이름. 「처리됨」이 셋을 한꺼번에 뜻한다. */
  readonly scopeLabels: Readonly<Record<ReportScope, string>>
  readonly filters: {
    readonly legend: string
    readonly scopeLabel: string
    readonly scopeAll: string
    readonly targetLabel: string
    readonly targetAll: string
    readonly reset: string
  }
  /**
   * 처리 대기 건수 (필터 무관).
   *
   * **`scopeNotice` 를 빼면 이 숫자가 거짓말이 된다.** 「반려」만 보고 있는 화면
   * 위에 12라는 숫자가 서 있는데 그 사실을 적지 않으면, 읽는 사람은 화면의 줄을
   * 세어 보고 숫자가 틀렸다고 판단한다.
   */
  readonly pending: {
    readonly title: string
    readonly countValue: string
    readonly scopeNotice: string
    /** 대기 건만 보러 가는 버튼. 누르면 상태 필터가 「처리 대기」로 간다. */
    readonly only: string
    /** 대기가 0건이다 — 이 화면에서 가장 좋은 소식이다. */
    readonly none: string
  }
  /** 이 대상이 몇 번 신고됐나. `{count}` 가 들어간다. */
  readonly reportCount: string
  /** 대상이 지금 가려져 있다. 자동 임시 숨김도 여기에 나타난다. */
  readonly targetHidden: string
  /** 신고된 내용이 오지 않았다 — 지워졌거나 읽을 수 없는 대상이다. */
  readonly excerptEmpty: string
  /** 처리 버튼과, 이미 처리된 줄의 자리. */
  readonly handleLabel: string
  readonly handledAt: string
  readonly handledNote: string
  readonly pagination: {
    readonly label: string
    readonly next: string
    readonly previous: string
    readonly pageUnit: string
    readonly countUnit: string
  }
}

/**
 * 처리 대화상자 — 숨김 · 삭제 · 반려 (F4 · F5 · F6).
 *
 * **`outcomeEffects` 가 이 슬라이스의 핵심이다.** 세 버튼의 이름만 있으면 운영자는
 * 반려를 「무시」로 읽고, 자동 임시 숨김이 걸린 대상은 아무도 복구하지 않는다.
 */
export interface ReportHandleMessages {
  readonly title: string
  readonly description: string
  readonly closeLabel: string
  readonly cancel: string
  readonly submit: string
  readonly submitting: string
  /** 무엇에 대한 신고인지를 대화상자 안에서 다시 보여 주는 자리. */
  readonly summary: {
    readonly target: string
    readonly reason: string
    readonly detail: string
    readonly excerpt: string
    readonly reportCount: string
    readonly createdAt: string
    /** 값이 없다. 빈칸으로 두면 「없다」와 「못 읽었다」가 섞인다. */
    readonly none: string
  }
  /** 대상이 이미 가려져 있다는 사실 — 반려가 **무엇을 되돌리는지**의 근거다. */
  readonly hiddenNotice: string
  /** 같은 대상의 다른 대기 신고도 함께 닫힌다 (TASK-0091 4.7). */
  readonly siblingNotice: string
  /** 상품에는 삭제가 없다는 사실 (TASK-0091 4.4). */
  readonly productNotice: string
  readonly outcomeLegend: string
  readonly outcomeLabels: Readonly<Record<ReportOutcome, string>>
  /**
   * 각 처리가 **대상에** 하는 일.
   *
   * `Record<ReportEffect, string>` 이라 효과가 하나 늘면 문구가 없는 것을 typecheck
   * 이 잡는다. 셋 중 `reveal` 이 가장 중요하다 — 그것이 「반려하면 다시 보인다」다.
   */
  readonly outcomeEffects: Readonly<Record<ReportEffect, string>>
  readonly noteLabel: string
  readonly noteHint: string
  readonly notePlaceholder: string
  /** 되돌릴 수 없는 처리 앞의 두 번째 걸음 (R1). */
  readonly confirm: {
    readonly title: string
    readonly description: string
    readonly confirm: string
    readonly back: string
    readonly noteLabel: string
  }
  readonly failedTitle: string
  /**
   * 이 화면이 따로 할 말이 있는 두 거절 (`refusalOf`).
   *
   * 나머지는 카탈로그가 코드로 문장을 고른다. 여기 둘을 적어 두는 이유는 그 문장이
   * **다음 행동**을 담고 있어야 하기 때문이다 — 하나는 「이 계정으로는 안 된다」이고
   * 다른 하나는 「목록을 다시 읽어라」다.
   */
  readonly refusals: Readonly<Record<ReportRefusal, string>>
  /** 남이 먼저 처리했을 때 내미는 버튼. */
  readonly refreshLabel: string
  /** 서버가 이 폼의 어느 칸도 가리키지 않고 거절했을 때. */
  readonly submitError: string
  readonly errors: HandleFieldErrorMessages
}

export interface ReportToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  /** 처리 하나가 끝났다. `Record` 라 처리가 하나 늘면 여기가 걸린다. */
  readonly handled: Readonly<Record<ReportOutcome, string>>
  readonly failedTitle: string
}

/* ------------------------------------------------------ 알림함 (TASK-0090) -- */

export interface NotificationMessages {
  /** 상단바의 종. 셸이 빌려 쓰는 넷이다. */
  readonly slot: {
    readonly label: string
    /** 안 읽은 것이 있을 때의 이름. `{count}` 가 들어간다 — 배지의 숫자는 그림이다. */
    readonly labelWithCount: string
    readonly title: string
    readonly closeLabel: string
  }
  readonly title: string
  readonly description: string
  /**
   * 유형별 이름.
   *
   * `Record<NotificationType, string>` 이라 계약에 유형이 하나 늘면 여기가
   * typecheck 에서 걸린다. **관리자가 받지 않는 유형에도 문장이 있다** — 받는
   * 사람의 역할이 유형에 묻어 있지만(`notifications.ts`) 그것은 서버의 규약이고,
   * 이름 없는 유형이 화면에 나타나는 길을 열어 둘 이유는 없다.
   */
  readonly typeLabels: Readonly<Record<NotificationType, string>>
  /** 배지가 상한을 넘었을 때. `{max}` 가 들어간다. */
  readonly badgeOverflow: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  /** 「안 읽은 것만」을 켜 두고 아무것도 없을 때. 「없다」와 뜻이 다르다. */
  readonly unreadEmptyTitle: string
  readonly unreadEmptyDescription: string
  readonly listLabel: string
  /** 안 읽은 줄에 붙는 표시. 색만으로는 말하지 않는다 (P2). */
  readonly unreadLabel: string
  /** 안 읽은 것이 몇 건인가. `{count}` 가 들어간다. */
  readonly unreadCount: string
  readonly allReadLabel: string
  readonly allReadDone: string
  readonly markReadLabel: string
  /** 드롭다운에서 알림함 전체로. */
  readonly viewAll: string
  readonly unreadOnlyLabel: string
  readonly unreadOnlyDescription: string
  /** 누를 곳이 없는 알림 — `link` 가 없는 것들이다. */
  readonly noLink: string
  readonly failedTitle: string
  /** 로그인하기 전의 종. 배지도 목록도 없다. */
  readonly signedOut: string
  readonly pagination: {
    readonly label: string
    readonly next: string
    readonly previous: string
    readonly pageUnit: string
    readonly countUnit: string
  }
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/* --------------------------------------------------- 대시보드 (TASK-0092) -- */

/**
 * `/` — 지금 무엇을 해야 하고, 플랫폼은 어떻게 돌아가고 있는가.
 *
 * 안이 셋으로 갈린 것은 **계약이 셋이기 때문**이다(문 셋). 한 문이 실패해도 나머지
 * 두 섹션은 그려져야 하고, 그러려면 오류 제목과 「다시 시도」가 섹션마다 있어야 한다 —
 * 하나로 접으면 지표를 못 읽었을 때 처리 대기 항목까지 사라지고, 대시보드에서 그것은
 * 「플랫폼이 죽었나」로 읽힌다.
 */
export interface DashboardMessages {
  readonly description: string
  /**
   * 이 화면을 아예 볼 수 없는 계정에게 (F6).
   *
   * **섹션의 오류 제목과 다른 문장이다** — 「불러오지 못했어요」는 다시 시도하면 될
   * 것처럼 읽히는데, 이것은 아무리 눌러도 되지 않는다. 서버도 같은 판단을 세 문 전부에
   * 대해 내린다(`order.read` 의 스코프가 `any` 여야 한다).
   */
  readonly forbiddenTitle: string
  readonly pending: DashboardPendingMessages
  readonly metrics: DashboardMetricMessages
  readonly chart: DashboardChartMessages
  readonly rankings: DashboardRankingMessages
  readonly system: DashboardSystemMessages
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/**
 * 처리 대기 — **이 화면의 목적** (F2).
 *
 * `labels` 가 `Record<PendingKey, string>` 이라 계약에 대기 항목이 하나 늘면 여기가
 * typecheck 에서 걸린다. 이름 없는 줄이 대시보드 맨 위에 나타나는 길을 열어 둘 이유는
 * 없다.
 */
export interface DashboardPendingMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  /** 네 줄이 전부 0이다 — 이 화면에서 가장 좋은 소식이라 표가 아니라 문장으로 적는다. */
  readonly allClear: string
  /** 다 합쳐 몇 건인가. `{count}` 가 들어간다. */
  readonly totalCount: string
  readonly labels: Readonly<Record<PendingKey, string>>
  /** 줄 하나의 건수. `{count}` 가 들어간다. */
  readonly countValue: string
  readonly listLabel: string
}

/**
 * 큰 숫자 넷과 그 증감 (F1 · F3).
 *
 * 단위가 항목마다 다른 것(건 · 명 · 곳)은 문법의 문제라 카탈로그의 몫이다. 컴포넌트가
 * 숫자에 「건」을 붙이기 시작하면 그 순간부터 로케일이 하나뿐인 앱이 된다.
 */
export interface DashboardMetricMessages {
  readonly title: string
  readonly regionLabel: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly salesLabel: string
  readonly orderCountLabel: string
  readonly newUsersLabel: string
  readonly activeSellersLabel: string
  /** `{count}` 가 들어간다. 세 항목이 각자 다른 단위를 쓴다. */
  readonly orderCountValue: string
  readonly newUsersValue: string
  readonly activeSellersValue: string
  /** 「활성 판매자」가 등록된 스토어 수가 아니라는 사실. 안 적으면 틀린 수로 읽힌다. */
  readonly activeSellersNote: string
  readonly comparison: DashboardComparisonMessages
  readonly filters: DashboardFilterMessages
  /** 지금 보고 있는 기간. `{from}` · `{to}` 가 들어간다. */
  readonly periodValue: string
}

/**
 * 직전 같은 기간과의 비교.
 *
 * **`none` 이 실패가 아니다** — 직전 기간이 0이면 증감률은 없는 수다(`growthOf`).
 * 부호를 화살표나 색으로만 말하지 않는 것도 여기서 정해진다: 문장이 「늘었어요 ·
 * 줄었어요」를 들고 있고, 그 앞의 퍼센트는 언제나 절댓값이다 (P2).
 */
export interface DashboardComparisonMessages {
  /** 무엇과 비교한 것인가. `{days}` 가 들어간다 — 「전월 대비」가 아니다. */
  readonly label: string
  /** `{percent}` */
  readonly up: string
  readonly down: string
  readonly flat: string
  readonly none: string
}

/** 기간 두 칸과 되돌리기 하나. 잘못 고른 기간은 **막지 않고 그 자리에서 말한다.** */
export interface DashboardFilterMessages {
  readonly legend: string
  readonly fromLabel: string
  readonly toLabel: string
  readonly reset: string
  /** 날짜 칸을 비웠을 때. 서버의 400 은 어느 칸인지 말할 수 없다. */
  readonly rangeIncomplete: string
  readonly rangeReversed: string
  /** 계약의 상한을 넘겼다. `{max}` 가 들어간다. */
  readonly rangeTooLong: string
}

/**
 * 거래액 추이 — **그림 하나와 표 하나** (F1).
 *
 * 표는 접혀 있을 수 있지만 **DOM 에서 사라지지 않는다.** 그림에는 `aria-hidden` 이
 * 붙어 있어, 표가 없으면 스크린리더로 읽는 사람에게 이 섹션은 아무 데이터도 아니다.
 */
export interface DashboardChartMessages {
  readonly title: string
  /** 가장 많이 판 날의 금액. `{amount}` 가 들어간다. */
  readonly peak: string
  readonly empty: string
  readonly caption: string
  readonly tableCaption: string
  readonly showTable: string
  readonly hideTable: string
  readonly dateHeader: string
  readonly salesHeader: string
  readonly orderCountHeader: string
}

/** 인기 상품·판매자. 계약이 다섯 줄까지만 보내므로 「전체」로 읽히지 않게 적는다. */
export interface DashboardRankingMessages {
  readonly productsTitle: string
  readonly productsCaption: string
  readonly productsEmpty: string
  readonly sellersTitle: string
  readonly sellersCaption: string
  readonly sellersEmpty: string
  readonly nameHeader: string
  readonly brandHeader: string
  readonly salesHeader: string
  readonly orderCountHeader: string
  /** 상위 몇 개까지인가. `{count}` 가 들어간다. */
  readonly note: string
}

/**
 * 시스템 상태 (F4).
 *
 * `names` 가 `Record<SchedulerKey, string>` 으로 **전수**라, 서버에 배치가 하나 늘고
 * 여기에 이름을 안 적으면 `pnpm typecheck` 이 먼저 걸린다. 그것이 없으면 새 배치는
 * `reservation.sweep.lastRunAt` 같은 점 찍힌 열쇠를 달고 조용히 표에 나타나고, 이
 * 섹션은 개발자만 읽을 수 있는 표가 된다.
 *
 * `statusLabels` 도 `Record` 인 이유는 같다. 그리고 셋의 문장은 **서로 달라야 한다** —
 * 「한 번도 안 돌았다」는 갓 뜬 프로세스의 정상 상태이고 「멈췄다」는 사고다.
 */
export interface DashboardSystemMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly summary: DashboardSystemSummaryMessages
  readonly statusLabels: Readonly<Record<SchedulerStatus, string>>
  readonly names: SchedulerNames
  readonly caption: string
  readonly nameHeader: string
  readonly statusHeader: string
  readonly lastRunHeader: string
  /** 한 번도 안 돈 배치의 「마지막 실행」 칸. 빈칸으로 두면 「못 읽었다」와 섞인다. */
  readonly neverRun: string
  /** 밀린 일을 셀 수 없는 배치 (`backlog` 가 `null`). */
  /** 색인 큐 — 배치가 아니라 줄 서 있는 일이라 따로 그린다. */
  readonly searchIndex: {
    readonly title: string
    /** `{count}` */
    readonly pending: string
    /** `{at}` */
    readonly oldest: string
  }
  /**
   * 이 콘솔이 모르는 열쇠가 왔다.
   *
   * API 와 콘솔은 따로 배포되므로 **실제로 일어난다.** 그 줄을 숨기면 멈춘 배치가
   * 아무 데도 안 보이게 되므로 열쇠라도 그리고, 왜 이름이 없는지를 이 문장이 말한다.
   */
  readonly unnamedNotice: string
  readonly demo: DashboardDemoMessages
}

/**
 * 섹션 머리의 한 문장 — 표를 읽지 않고도 알아야 하는 것.
 *
 * 셋이 서로 다른 행동을 부른다: `stopped` 는 지금 손봐야 하고, `idle` 은 방금 뜬
 * 프로세스라 기다리면 되며, `ok` 는 아무것도 안 해도 된다.
 */
export interface DashboardSystemSummaryMessages {
  /** `{count}` */
  readonly stopped: string
  readonly idle: string
  readonly ok: string
}

/** 데모 계정 현황 요약. 자세한 것은 `/demo` 가 답한다. */
export interface DashboardDemoMessages {
  readonly title: string
  /** `{count}` */
  readonly activeAccounts: string
  readonly expiringWithinHour: string
  readonly link: string
}

/* ------------------------------------------------- 회원 관리 (TASK-0093) -- */

/**
 * `/users` — 훑을 때는 가려진 값으로, 열 때는 사유를 적고.
 *
 * 안이 다섯으로 갈린 것은 이 화면이 하는 일이 **읽기 하나와 쓰기 넷**이기 때문이다.
 * 열람(`view`)은 `user.read` 로 되지만 정지(`suspension`)와 적립금(`points`)은
 * `user.write` 라 최고관리자만 하고, 역할(`roles`)은 거기에 확인 한 걸음이 더 붙는다
 * (R1). 한 덩어리로 접으면 「왜 이 버튼만 막혔는가」를 말할 자리가 사라진다.
 */
export interface UserMessages {
  readonly description: string
  /**
   * 이 화면을 아예 볼 수 없는 계정에게.
   *
   * **섹션의 오류 제목과 다른 문장이다** — 「불러오지 못했어요」는 다시 시도하면 될
   * 것처럼 읽히는데, 이것은 아무리 눌러도 되지 않는다.
   */
  readonly forbiddenTitle: string
  /**
   * 역할의 한국어 이름 — **이 콘솔에서 한 벌**.
   *
   * `Record<Role, string>` 이라 역할이 하나 늘면 여기가 typecheck 에서 걸린다.
   * `/demo` 의 역할별 통계도 이것을 읽는다(페이지가 넘겨준다): 두 화면이 같은 역할을
   * 다르게 부르면 그것이 이 표가 하나인 이유다.
   */
  readonly roleNames: Readonly<Record<Role, string>>
  readonly list: UserListMessages
  readonly view: UserViewMessages
  readonly detail: UserDetailMessages
  readonly roles: UserRoleMessages
  readonly suspension: UserSuspensionMessages
  readonly points: UserPointsMessages
  readonly toast: UserToastMessages
  /** 이 화면이 따로 할 말이 있는 거절. 카탈로그의 한 줄로는 못 하는 말들이다. */
  readonly refusals: Readonly<Record<UserRefusal, string>>
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/**
 * 목록 — **가려진 값만 있는 표** (F6).
 *
 * `maskedNotice` 가 없으면 `hong***@example.com` 은 고장으로 읽힌다. 가려져 있다는
 * 것과 **왜 가려져 있는지**, 그리고 검색은 원본을 찾는다는 사실을 화면이 말해야
 * 사람이 별이 박힌 문자열을 검색창에 붙여 넣지 않는다 (4.2).
 */
export interface UserListMessages {
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  readonly maskedNotice: string
  readonly columns: UserColumnMessages
  readonly filters: UserFilterMessages
  readonly demoBadge: string
  readonly suspendedBadge: string
  readonly activeBadge: string
  /** 한 번도 로그인하지 않았다. 빈칸은 「못 읽었다」와 섞인다. */
  readonly neverLoggedIn: string
  readonly noRoles: string
  readonly openLabel: string
  readonly pagination: UserPaginationMessages
}

export interface UserColumnMessages {
  readonly account: string
  readonly roles: string
  readonly status: string
  readonly createdAt: string
  readonly lastLoginAt: string
  readonly open: string
}

/**
 * 네 축과 되돌리기 하나.
 *
 * 검색은 **누른 뒤에** 나간다. 글자마다 보내면 「hong」을 치는 사이에 요청이 네 번
 * 나가고, 그중 셋은 아무도 보지 않을 답이다. 나머지 셋은 고르는 즉시 나간다 —
 * 셀렉트에는 「다 골랐다」는 순간이 있다.
 */
export interface UserFilterMessages {
  readonly legend: string
  readonly searchLabel: string
  readonly searchPlaceholder: string
  /** 검색은 **가려지지 않은 원본**을 찾는다는 사실 (4.2). */
  readonly searchHint: string
  readonly searchSubmit: string
  readonly roleLabel: string
  readonly roleAll: string
  readonly demoLabel: string
  readonly demoAll: string
  readonly demoOnly: string
  readonly realOnly: string
  readonly suspendedLabel: string
  readonly suspendedAll: string
  readonly suspendedOnly: string
  readonly activeOnly: string
  readonly reset: string
}

/** Composed as `2 페이지 · 20건`, by concatenation rather than a placeholder. */
export interface UserPaginationMessages {
  readonly label: string
  readonly next: string
  readonly previous: string
  readonly pageUnit: string
  readonly countUnit: string
}

/**
 * 열람 사유를 받는 대화상자 (F7).
 *
 * **미리 채워 두지 않는다.** 「운영 확인」 같은 기본 문장이 들어 있으면 그 기록은
 * 아무것도 증명하지 못하고, 그때 남는 것은 감사 기록이 아니라 감사 기록의 모양이다.
 * `notice` 가 그 사실을 미리 말한다 — 적은 문장이 남는다는 것을 알고 적는 것과
 * 모르고 적는 것은 다른 문장이 된다.
 */
export interface UserViewMessages {
  readonly title: string
  readonly description: string
  readonly closeLabel: string
  readonly cancel: string
  readonly submit: string
  readonly submitting: string
  /** 어떤 계정을 여는지 — **가려진 값으로.** 여기서 원본을 보여 주면 문이 없어진다. */
  readonly targetLabel: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  readonly notice: string
  readonly failedTitle: string
  readonly submitError: string
  readonly errors: ReasonFieldErrorMessages
}

/**
 * 열린 계정 — 가려지지 않은 값과 요약 (F2).
 *
 * `statsNote` 는 계약이 **숫자만** 싣는 이유를 말한다. 주문 목록이나 리뷰 본문까지
 * 여기 있으면 「요약을 보려고 연 화면」이 사실상 그 사람의 전부를 여는 화면이 되고,
 * 열람 기록 하나가 그 전부를 덮는다 (`adminUserStatsSchema`).
 */
export interface UserDetailMessages {
  readonly title: string
  readonly closeLabel: string
  readonly loadingLabel: string
  readonly emailLabel: string
  readonly nameLabel: string
  readonly rolesLabel: string
  readonly createdAtLabel: string
  readonly lastLoginAtLabel: string
  readonly statusLabel: string
  readonly neverLoggedIn: string
  readonly statusActive: string
  readonly statusSuspended: string
  /** `{datetime}` */
  readonly suspendedSince: string
  /** `{reason}` */
  readonly suspendedReason: string
  readonly demoNotice: string
  readonly statsTitle: string
  readonly statsNote: string
  readonly stats: UserStatsMessages
}

export interface UserStatsMessages {
  readonly orderCount: string
  readonly paidAmount: string
  readonly reviewCount: string
  readonly questionCount: string
  readonly pointBalance: string
  readonly couponCount: string
  /** `{count}` 가 들어간다. 금액이 아닌 것들이 단위를 갖는다. */
  readonly countValue: string
}

/**
 * 역할 부여·회수 (F3 · R1).
 *
 * 관리자 역할에는 확인이 한 걸음 더 붙는다. 부여하는 순간 이 콘솔 전체가 열리므로
 * 목록에서 잘못 고른 한 번이 곧 최고관리자 한 명이고, 회수는 되지만 **그 사이에
 * 일어난 일은 되돌아오지 않는다.**
 */
export interface UserRoleMessages {
  readonly title: string
  readonly description: string
  readonly grantLabel: string
  readonly grantSubmit: string
  readonly grantPlaceholder: string
  /** `{role}` */
  readonly revokeLabel: string
  readonly none: string
  readonly exhausted: string
  readonly adminNotice: string
  readonly confirm: UserRoleConfirmMessages
  readonly failedTitle: string
}

export interface UserRoleConfirmMessages {
  readonly title: string
  /** `{role}` */
  readonly description: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
}

/**
 * 정지와 해제 (F4).
 *
 * `notice` 가 **정지는 탈퇴가 아니라는 것**과 **살아 있는 세션도 끊긴다는 것**을
 * 말한다. 앞엣것을 안 말하면 운영자가 되돌릴 수 있는 조치를 되돌릴 수 없는 것으로
 * 알고 망설이고, 뒤엣것을 안 말하면 「정지했는데 아직 쓰고 있다」를 의심하게 된다 —
 * 실제로는 그렇지 않다 (4.4).
 */
export interface UserSuspensionMessages {
  readonly title: string
  readonly description: string
  readonly notice: string
  readonly suspendLabel: string
  readonly reinstateLabel: string
  readonly submitting: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  readonly activeTitle: string
  /** `{datetime}` */
  readonly activeSince: string
  /**
   * `{reason}` — 정지 때 적힌 사유.
   *
   * 계약이 `suspendedReason` 을 따로 nullable 로 싣기 때문에 **없을 수 있는 줄**이다
   * (데이터베이스는 `User_suspended_reason_check` 로 둘을 묶어 두었다). 없을 때
   * 빈칸이나 「없음」을 그리는 대신 줄 자체를 그리지 않는다 — 사유 없는 정지는
   * 이 설계가 만들지 않는 것이라, 그 자리에 무엇이든 적으면 거짓이 된다.
   */
  readonly activeReason: string
  readonly failedTitle: string
  readonly submitError: string
  readonly errors: ReasonFieldErrorMessages
}

/**
 * 적립금 수동 조정 (F5).
 *
 * `applied` 셋이 이 슬라이스의 핵심이다. 차감은 **잔액까지만** 가므로, 요청한 숫자를
 * 그대로 그리면 화면이 거짓말을 한다 — 5만원을 빼려 했고 1만원만 빠졌는데 화면은
 * 「-50,000원 조정했어요」라고 말한다 (`pointsOutcome`).
 */
export interface UserPointsMessages {
  readonly title: string
  readonly description: string
  readonly notice: string
  readonly balanceLabel: string
  readonly amountLabel: string
  readonly amountHint: string
  readonly amountPlaceholder: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  readonly submitLabel: string
  readonly submitting: string
  readonly failedTitle: string
  readonly submitError: string
  readonly errors: PointsFieldErrorMessages
  readonly applied: UserPointsAppliedMessages
}

export interface UserPointsAppliedMessages {
  /** `{amount}` — 요청한 만큼 그대로 움직였다. */
  readonly exact: string
  /** `{requested}` · `{applied}` — 잔액까지만 갔다. */
  readonly clipped: string
  /** `{requested}` — 잔액이 없어 **아무 줄도 남지 않았다.** */
  readonly none: string
}

export interface UserToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly suspended: string
  readonly reinstated: string
  /** `{role}` */
  readonly granted: string
  readonly revoked: string
}

/* -------------------------------------------- 데모 계정 관리 (TASK-0096) -- */

/**
 * `/demo` — 발급 현황과 정리 상태.
 *
 * 안이 셋으로 갈린 것은 **문이 셋이기 때문**이다(정책 · 계정 · 통계). 한 문이
 * 실패해도 나머지 두 섹션은 그려져야 하고, 그러려면 오류 제목과 「다시 시도」가
 * 섹션마다 있어야 한다.
 */
export interface DemoConsoleMessages {
  readonly description: string
  readonly forbiddenTitle: string
  readonly policy: DemoPolicyMessages
  readonly accounts: DemoAccountsMessages
  readonly stats: DemoStatsMessages
  readonly toast: DemoToastMessages
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/**
 * 정책 세 칸 (F6).
 *
 * `notice` 가 **이후 발급분에만 적용된다**는 사실을 말한다. 말하지 않으면 운영자는
 * 수명을 1시간으로 줄인 뒤 목록에서 24시간이 남은 계정들을 보고 「안 먹혔다」고
 * 읽는다 — 실제로는 쓰고 있던 사람의 데모를 눈앞에서 지우지 않으려고 그렇게 한 것이다
 * (4.4 · R1).
 *
 * `fields` 와 `errors` 가 `Record<PolicyField, …>` 라, 계약에 칸이 하나 늘면 여기가
 * typecheck 에서 걸린다.
 */
export interface DemoPolicyMessages {
  readonly title: string
  readonly description: string
  readonly notice: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly fields: Readonly<Record<PolicyField, DemoPolicyFieldMessages>>
  readonly errors: Readonly<Record<PolicyField, DemoPolicyFieldErrorMessages>>
  readonly submitLabel: string
  readonly submitting: string
  readonly failedTitle: string
  readonly submitError: string
  readonly current: DemoPolicyCurrentMessages
}

export interface DemoPolicyFieldMessages {
  readonly label: string
  readonly hint: string
}

export interface DemoPolicyFieldErrorMessages {
  readonly required: string
  /** `{min}` · `{max}` — 계약의 스키마에서 읽은 값이 들어간다 (`policy-form.ts`). */
  readonly range: string
}

/** 지금 저장되어 있는 값, 사람이 읽는 단위로. */
export interface DemoPolicyCurrentMessages {
  readonly title: string
  /** `{hours}` */
  readonly ttlHours: string
  /** `{count}` */
  readonly seedOrders: string
  /** `{amount}` */
  readonly virtualCardLimit: string
}

/**
 * 계정 목록과 그 위의 두 버튼 (F1 · F2 · F4 · F5).
 *
 * `expireNotice` 가 **강제 만료는 지우는 것이 아니라는 것**을 말한다. 만료 시각을
 * 지금으로 당길 뿐이고 실제 삭제는 다음 정리가 하므로, 누른 직후 목록에 그 계정이
 * 그대로 있다 — 말하지 않으면 운영자는 실패로 읽는다 (4.1).
 *
 * `cleanupNotice` 는 실패가 **표가 아니라 칸**이라는 것을 말한다. 다음 주기가
 * 성공하면 그 칸은 그냥 비워진다 (4.3).
 */
export interface DemoAccountsMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  readonly columns: DemoAccountColumnMessages
  readonly failedOnlyLabel: string
  /** 넷 다 서로 다른 행동을 부른다 — 만료 시각이 없는 계정까지 (`expiryStatus`). */
  readonly expiryLabels: Readonly<Record<ExpiryStatus, string>>
  readonly noRoles: string
  readonly cleanupNone: string
  /** `{datetime}` */
  readonly cleanupFailedAt: string
  readonly cleanupNotice: string
  readonly expireLabel: string
  readonly expireNotice: string
  readonly confirm: DemoExpireConfirmMessages
  readonly sweepLabel: string
  readonly sweeping: string
  readonly sweepNotice: string
  readonly failedTitle: string
  readonly pagination: UserPaginationMessages
}

export interface DemoAccountColumnMessages {
  readonly account: string
  readonly roles: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly cleanup: string
  readonly actions: string
}

export interface DemoExpireConfirmMessages {
  readonly title: string
  readonly description: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
}

/**
 * 발급 통계 (F7).
 *
 * 일별과 역할별을 **한 답에서** 그린다 — 두 축을 따로 물으면 두 요청 사이에 발급이
 * 일어나 합이 안 맞는다 (4.5). `unnamedRoleNotice` 는 이 콘솔이 이름을 모르는 역할이
 * 왔을 때의 문장이다: 그 줄을 숨기면 역할별 합이 조용히 전체와 어긋난다.
 */
export interface DemoStatsMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly summary: DemoStatsSummaryMessages
  readonly filters: DemoStatsFilterMessages
  readonly daysCaption: string
  readonly dateHeader: string
  readonly issuedHeader: string
  readonly roleHeader: string
  readonly byRoleCaption: string
  readonly byRoleEmpty: string
  readonly unnamedRoleNotice: string
  /** `{count}` */
  readonly totalIssued: string
}

export interface DemoStatsSummaryMessages {
  readonly activeLabel: string
  readonly failedLabel: string
  /** `{at}` `{swept}` `{failed}` — 마지막 정리가 무엇을 했는가 (F3). */
  readonly lastCleanup: string
  readonly lastCleanupNever: string
  /** `{count}` */
  readonly countValue: string
}

/** 기간 두 칸과 되돌리기 하나. 잘못 고른 기간은 **막지 않고 그 자리에서 말한다.** */
export interface DemoStatsFilterMessages {
  readonly legend: string
  readonly fromLabel: string
  readonly toLabel: string
  readonly reset: string
  /**
   * 날짜 칸이 비어 있거나 아직 다 채워지지 않았다.
   *
   * **가장 흔한 상태다.** 칸을 지우거나 고치는 도중 브라우저는 빈 문자열을 주고, 그
   * 값을 그대로 보내면 서버가 400 으로 답한다 — 그때 화면이 할 수 있는 말은 어느
   * 칸인지도 못 짚는 한 줄뿐이다.
   */
  readonly rangeIncomplete: string
  readonly rangeReversed: string
  /** `{max}` */
  readonly rangeTooLong: string
}

export interface DemoToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly expired: string
  readonly policySaved: string
  /** `{swept}` · `{failed}` */
  readonly swept: string
  /** 아무것도 집히지 않았다. 0을 두 번 그리는 대신 한 문장으로 말한다. */
  readonly sweptNothing: string
}

/* ----------------------------------------------- 스토어 지표 (TASK-0094) -- */

/**
 * `/sellers` 의 두 번째 탭 — **어느 스토어를 봐야 하나.**
 *
 * 안이 셋으로 갈린 것은 이 화면이 답하는 질문이 셋이기 때문이다: 목록은 「어느
 * 스토어인가」, 이력은 「이 스토어가 몇 번 정지됐나」(F6), 그리고 `metricNotice` 는
 * **숫자에 없는 것이 무엇인가**를 말한다 — 클레임률의 빈칸이 0%가 아니라는 사실은
 * 표만 봐서는 알 수 없고, 그것을 모르면 정렬의 맨 위가 무엇인지도 오해한다 (4.5).
 */
export interface StoreMessages {
  readonly tabLabel: string
  readonly description: string
  /** 이 탭을 아예 볼 수 없는 계정에게. 「불러오지 못했어요」와 다른 문장이다. */
  readonly forbiddenTitle: string
  readonly list: StoreListMessages
  readonly history: StoreHistoryMessages
  /** 한 줄씩, API 가 답하기 **전에** 실패한 경우에 대해. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

/**
 * 지표 표 (F1 · F2 · F7).
 *
 * `noSales` 와 `noRatings` 가 이 화면의 핵심 문장이다. 계약은 주문이 없는 스토어의
 * 클레임률을 `null` 로 싣고, 리뷰가 없는 스토어의 평점은 0으로 싣는다 — 둘 다 0으로
 * 그리면 **아직 아무것도 안 한 스토어가 「완벽한 스토어」이거나 「최악의 스토어」로**
 * 목록의 끝에 선다 (4.5).
 */
export interface StoreListMessages {
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  /** 표를 읽기 전에 알아야 하는 것 — 빈칸이 0이 아니라는 사실 (4.5). */
  readonly metricNotice: string
  readonly demoBadge: string
  /** 주문이 한 건도 없어 클레임률을 낼 수 없다. **0%가 아니다.** */
  readonly noSales: string
  /** 리뷰가 한 건도 없다. 0.0점이 아니다. */
  readonly noRatings: string
  /** `{score}` · `{count}` */
  readonly ratingValue: string
  /** `{count}` */
  readonly countValue: string
  readonly productCountValue: string
  readonly followerValue: string
  readonly historyLabel: string
  readonly columns: StoreColumnMessages
  readonly filters: StoreFilterMessages
  readonly pagination: StorePaginationMessages
}

export interface StoreColumnMessages {
  readonly store: string
  readonly status: string
  readonly sales: string
  readonly orders: string
  readonly claimRate: string
  readonly rating: string
  readonly products: string
  readonly followers: string
  readonly createdAt: string
  readonly history: string
}

/**
 * 두 축과 정렬 하나.
 *
 * 정렬이 필터와 같은 자리에 있는 이유는 이 화면에서 그것이 **같은 일**이기 때문이다 —
 * 「문제 판매자를 지표로 찾는다」는 요구는 좁히기가 아니라 줄 세우기로 답한다 (F2).
 */
export interface StoreFilterMessages {
  readonly legend: string
  readonly statusLabel: string
  readonly statusAll: string
  readonly demoLabel: string
  readonly demoAll: string
  readonly demoOnly: string
  readonly realOnly: string
  readonly sortLabel: string
  readonly sortNames: Readonly<Record<SellerSortKey, string>>
  readonly reset: string
}

/** `2 페이지 · 20곳`, 자리 표시자 없이 이어 붙인다. */
export interface StorePaginationMessages {
  readonly label: string
  readonly next: string
  readonly previous: string
  readonly pageUnit: string
  readonly countUnit: string
}

/**
 * 제재 이력 (F6).
 *
 * `kinds` 가 상태 두 칸을 사람의 말로 옮긴다. 「SUSPENDED → ACTIVE」를 그대로 그리면
 * 읽는 사람이 매번 머릿속에서 「해제」로 옮기게 되고, 표의 뜻이 읽는 사람의 번역에
 * 달려 있으면 그 번역은 언젠가 틀린다.
 *
 * `summary` 는 **이 표가 생긴 이유**를 한 줄로 말한다 — 몇 번 정지됐는가. `Seller` 는
 * 지금 상태와 사유만 들고 있어 정지와 해제를 반복하면 앞의 것이 덮이고, 그러면 반복
 * 위반과 한 번의 실수를 구별할 수 없다 (4.6).
 */
export interface StoreHistoryMessages {
  readonly title: string
  readonly closeLabel: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly listLabel: string
  readonly kinds: Readonly<Record<StoreEventKind, string>>
  readonly columns: StoreHistoryColumnMessages
  /** `{count}` — 정지된 횟수. */
  readonly summary: string
  readonly noSanction: string
  /** 사유가 적히지 않은 줄. 빈칸은 「못 읽었다」와 섞인다. */
  readonly noReason: string
  /** 사람이 아니라 시스템이 옮겼다 (`actorId` 가 `null`). */
  readonly systemActor: string
  readonly adminActor: string
}

export interface StoreHistoryColumnMessages {
  readonly movedAt: string
  readonly change: string
  readonly reason: string
  readonly actor: string
}

/* --------------------------------------------- 전체 상품 (TASK-0095) -- */

/**
 * `/products` — 모든 스토어의 상품, 그리고 강제로 내리기.
 *
 * `statusLabels` 가 여기 있는 이유는 이 콘솔에서 상품 상태를 그리는 화면이 여기
 * 하나뿐이기 때문이다. `hiddenNotice` 는 **내려진 상품이 어떤 상태로 남는가**를
 * 말한다 — 강제 숨김은 `SUSPENDED` 이고, 판매자가 스스로 내린 `INACTIVE` 와 다르다.
 */
export interface AdminProductMessages {
  readonly description: string
  readonly forbiddenTitle: string
  readonly statusLabels: Readonly<Record<ProductStatus, string>>
  readonly list: AdminProductListMessages
  readonly hide: ProductHideMessages
  readonly restore: ProductRestoreMessages
  readonly toast: AdminProductToastMessages
  /** 화면에 남은 거절을 사람이 치우는 버튼. 토스트와 달리 저절로 사라지지 않는다. */
  readonly dismissLabel: string
  /** 이 화면이 따로 할 말이 있는 거절. 카탈로그의 한 줄로는 못 하는 말들이다. */
  readonly refusals: Readonly<Record<ProductRefusal, string>>
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

export interface AdminProductListMessages {
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  /**
   * 이름으로 못 찾는다는 사실 (4.1).
   *
   * `GET /products` 의 계약에 검색어가 없다. 없는 칸을 그리지 않는 것만으로는
   * 부족하다 — 찾으러 온 사람은 칸이 없으면 **자기가 못 찾는 것**이라고 생각하고
   * 같은 화면을 몇 번이고 다시 연다.
   */
  readonly hiddenBadge: string
  readonly noPrice: string
  readonly unknownSeller: string
  readonly unknownCategory: string
  /** `{count}` */
  readonly stockValue: string
  readonly variantValue: string
  /** 내릴 수도 올릴 수도 없는 상태의 줄에 (4.2). */
  readonly notModeratable: string
  readonly hideLabel: string
  readonly restoreLabel: string
  readonly columns: AdminProductColumnMessages
  readonly filters: AdminProductFilterMessages
  readonly pagination: StorePaginationMessages
}

export interface AdminProductColumnMessages {
  readonly product: string
  readonly seller: string
  readonly category: string
  readonly status: string
  readonly price: string
  readonly stock: string
  readonly action: string
}

export interface AdminProductFilterMessages {
  /** 이름 검색 (TASK-0095 2장). 색인이 못 찾는 것을 찾으므로 목록이 직접 받는다. */
  readonly searchLabel: string
  readonly searchPlaceholder: string
  readonly searchHint: string
  readonly searchAction: string
  readonly legend: string
  readonly sellerLabel: string
  readonly sellerAll: string
  readonly sellerLoading: string
  /** 목록이 잘렸다는 사실 — 스토어가 상한을 넘으면 셀렉트에 없는 스토어가 생긴다. */
  readonly sellerNotice: string
  readonly categoryLabel: string
  readonly categoryAll: string
  readonly categoryLoading: string
  readonly statusLabel: string
  readonly statusAll: string
  readonly reset: string
}

/**
 * 내리기 전에 **사유를 묻는다** (F3).
 *
 * 미리 채워 두지 않는다. 「부적절」 같은 기본 문장이 들어 있으면 남는 것은 근거가
 * 아니라 근거의 모양이고, 그 상품의 판매자에게 설명할 것이 아무것도 없다 (4.2).
 */
export interface ProductHideMessages {
  readonly title: string
  readonly description: string
  readonly closeLabel: string
  readonly cancel: string
  readonly submit: string
  readonly submitting: string
  readonly targetLabel: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  /** 내리면 무슨 일이 일어나는가 — 검색 색인에서도 함께 빠진다 (4.2). */
  readonly notice: string
  readonly submitError: string
  readonly errors: ReasonFieldErrorMessages
}

/** 다시 올릴 때는 사유를 받지 않는다 — 되돌린다는 사실 자체가 근거다. */
export interface ProductRestoreMessages {
  readonly title: string
  readonly description: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
  readonly targetLabel: string
}

export interface AdminProductToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly hidden: string
  readonly restored: string
}

/* --------------------------------------------- 전체 주문 (TASK-0095) -- */

/**
 * `/orders` — 주문을 사람·스토어·기간으로 가로질러.
 *
 * `detail.statusNotice` 가 이 화면에서 가장 중요한 문장이다. 주문 상태를 바꾸는 문은
 * **일부러 없고**(F7 · 4.4), 없다는 사실과 그 이유와 대신 갈 곳을 화면이 말하지
 * 않으면 읽는 사람은 그것을 자기 권한 문제로 읽는다 — 그리고 다른 계정으로 다시
 * 들어와 같은 화면을 본다.
 */
export interface AdminOrderMessages {
  readonly description: string
  readonly forbiddenTitle: string
  readonly statusLabels: Readonly<Record<OrderStatus, string>>
  readonly list: AdminOrderListMessages
  readonly detail: AdminOrderDetailMessages
  readonly failures: Readonly<Record<ApiFailureReason, string>>
}

export interface AdminOrderListMessages {
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly filteredEmptyTitle: string
  readonly filteredEmptyDescription: string
  readonly listLabel: string
  /** 산 사람의 이름이 가려져 있다는 사실 (4.3). 없으면 별이 고장으로 읽힌다. */
  readonly maskedNotice: string
  /** `{count}` — 이 주문이 몇 개의 판매자 묶음으로 갈렸는가 (F5). */
  readonly bundleValue: string
  readonly openLabel: string
  readonly columns: AdminOrderColumnMessages
  readonly filters: AdminOrderFilterMessages
  readonly pagination: StorePaginationMessages
}

export interface AdminOrderColumnMessages {
  readonly orderNumber: string
  readonly buyer: string
  readonly bundles: string
  readonly paidAmount: string
  readonly createdAt: string
  readonly open: string
}

/**
 * CS 가 손에 쥐는 값들 (F4).
 *
 * 주문번호는 **정확히 일치**로 찾는다. 부분 일치로 두면 비슷한 번호가 섞여 나오고,
 * CS 는 그중 어느 것이 그 주문인지 알 방법이 없다 (4.3). `orderNumberHint` 가 그
 * 사실을 미리 말한다 — 모르면 앞 몇 글자만 치고 「없다」를 받는다.
 */
export interface AdminOrderFilterMessages {
  readonly legend: string
  readonly orderNumberLabel: string
  readonly orderNumberPlaceholder: string
  readonly orderNumberHint: string
  readonly buyerIdLabel: string
  readonly buyerIdPlaceholder: string
  readonly buyerIdHint: string
  readonly sellerLabel: string
  readonly sellerAll: string
  readonly sellerLoading: string
  readonly fromLabel: string
  readonly toLabel: string
  readonly submit: string
  readonly reset: string
  /** 보내기 전에 그 자리에서 돌려보내는 것들 (`orderIssuesOf`). */
  readonly issues: Readonly<Record<OrderFilterIssue, string>>
}

/**
 * 주문 하나 — **묶음 전부**와 결제 내역, 그리고 바꿀 수 없다는 말 (F5 · F6 · F7).
 *
 * 묶음은 목록의 줄이 이미 들고 있으므로 다시 묻지 않는다. 여기서 새로 읽는 것은
 * 결제뿐이다.
 */
export interface AdminOrderDetailMessages {
  readonly title: string
  readonly closeLabel: string
  readonly orderNumberLabel: string
  readonly buyerLabel: string
  readonly createdAtLabel: string
  readonly paidAmountLabel: string
  readonly bundlesTitle: string
  readonly bundlesLabel: string
  readonly bundleColumns: AdminOrderBundleColumnMessages
  readonly paymentsTitle: string
  readonly paymentsLabel: string
  readonly paymentColumns: AdminOrderPaymentColumnMessages
  readonly paymentsLoadingLabel: string
  readonly paymentsErrorTitle: string
  readonly paymentsRetryLabel: string
  readonly paymentsEmptyTitle: string
  readonly paymentsEmptyDescription: string
  readonly refundedLabel: string
  /** 아직 승인되지 않은 결제. 빈칸은 「못 읽었다」와 섞인다. */
  readonly notApproved: string
  /**
   * 상태를 여기서 바꿀 수 없다는 것과 **왜**, 그리고 대신 갈 곳 (F7 · 4.4).
   *
   * 「권한이 없어서」가 아니다. 손으로 옮기면 재고·정산·환불이 따라오지 않고, 그
   * 어긋남은 몇 단계 뒤에 「정산 금액이 이상하다」로 나타난다 — 원인과 증상이 멀어서
   * 아무도 그 둘을 잇지 못한다.
   */
  readonly statusNotice: string
  readonly claimsLinkLabel: string
}

export interface AdminOrderBundleColumnMessages {
  readonly brand: string
  readonly status: string
  readonly paidAmount: string
}

export interface AdminOrderPaymentColumnMessages {
  readonly provider: string
  readonly status: string
  readonly amount: string
  readonly canceledAmount: string
  readonly approvedAt: string
}
