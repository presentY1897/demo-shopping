import type {
  ApiFailureReason,
  DemoCarrierCode,
  DenialReason,
  ErrorMessages,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  OrderActor,
  OrderStatus,
  ProductStatus,
  SellerOrderRequirement,
  SellerStatus,
  SellerStockAdjustType,
  SellerStockFilter,
  StockLedgerType,
  TrackingEventKind,
} from '@shopping/shared'
import type { ImageUploadListLabels, ShipmentTrackingLabels } from '@shopping/ui/components'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { SellerOrderTab } from '@/lib/orders/order-console'
import type { StoreFieldErrorMessages } from '@/lib/sellers/store-form'
import type { SessionRefusal } from '@/lib/auth/session-client'
import type { HealthFailureReason } from '@/lib/health'
import type { OptionIssueCode } from '@/lib/products/combinations'
import type {
  ProductAttributeErrorMessages,
  ProductFieldErrorMessages,
} from '@/lib/products/product-form'
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
  /** The demo account banner and the button that issues one (TASK-0024). */
  readonly demo: DemoMessages
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
  /** 상품 등록 · 수정 (TASK-0114). */
  readonly products: ProductEditorMessages
  /**
   * 상품 목록 · 재고 관리 (TASK-0116).
   *
   * A slice of its own rather than more of `products`. The editor's vocabulary
   * is about *one* listing being written; this is about *many* being surveyed,
   * and the two screens share not one sentence. Folding them together would
   * make the exhaustive editor catalog the place a reader looks for the word
   * 품절, which is on the other screen entirely.
   */
  readonly productList: ProductListMessages
  /** Variant 별 재고 조정과 그 이력 (TASK-0116). */
  readonly productStock: ProductStockMessages
  /**
   * 주문 관리 목록 (TASK-0060). 상태 탭 · 기간 · 검색 · 일괄 발송 · 내보내기.
   */
  readonly orderList: OrderListMessages
  /** 주문 하나 — 항목 · 수령인 · 금액 · 이력 · 배송, 그리고 액션 버튼. */
  readonly orderDetail: OrderDetailMessages
  /**
   * 상태와 주체의 이름.
   *
   * 화면의 어휘가 아니라 **주문의** 어휘라 두 화면이 나눠 쓴다 —
   * `products.statusLabels` 가 같은 이유로 목록과 편집기 밖에 있다. 두 벌을 두면
   * 목록에서는 「배송중」이고 상세에서는 「배송 중」인 날이 온다.
   */
  readonly orders: OrderVocabularyMessages
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

/**
 * The product editor — 상품 등록 · 수정 (TASK-0114).
 *
 * One slice for two routes because they are one screen: `/products/new` and
 * `/products/[id]/edit` differ in a heading, a verb and whether an axis may be
 * added, and splitting the copy would be the first step towards splitting the
 * screen (the same reasoning `StoreMessages` gives for 입점 신청 · 스토어 설정).
 *
 * The image widget's copy is **not** here — it is `imageUpload`, unchanged from
 * TASK-0033. The editor mounts that widget rather than a second one.
 */
export interface ProductEditorMessages {
  readonly newTitle: string
  readonly newDescription: string
  readonly editTitle: string
  readonly editDescription: string
  /** Announced from the first frame while `GET /products/:id` is in flight. */
  readonly loadingLabel: string
  /** The id in the URL names no listing. Not an error — a stale link. */
  readonly missing: ProductMissingMessages
  /** The read never answered. Not a refusal about the listing. */
  readonly failure: StoreFailureMessages
  readonly basics: ProductBasicsMessages
  readonly attributes: ProductAttributeSectionMessages
  readonly options: ProductOptionMessages
  readonly variants: ProductVariantMessages
  /** The images a stored listing already has, beside the upload widget. */
  readonly gallery: ProductGalleryMessages
  /** What saving would do to the combinations, shown before it is done (F7). */
  readonly diff: ProductDiffMessages
  readonly preview: ProductPreviewMessages
  readonly actions: ProductActionMessages
  readonly conflict: StoreConflictMessages
  /** One label per status, so `DRAFT` never reaches a person as a word. */
  readonly statusLabels: Readonly<Record<ProductStatus, string>>
  readonly toast: ProductToastMessages
}

export interface ProductMissingMessages {
  readonly title: string
  readonly body: string
  readonly listLabel: string
}

export interface ProductBasicsMessages {
  readonly title: string
  readonly nameLabel: string
  readonly nameHint: string
  readonly descriptionLabel: string
  readonly descriptionHint: string
  readonly categoryLabel: string
  readonly categoryHint: string
  readonly categoryPlaceholder: string
  /** Between the names of a category's ancestors: `여성 › 아우터 › 코트`. */
  readonly categorySeparator: string
  readonly categoryLoadingLabel: string
  readonly categoryFailure: string
  readonly categoryRetryLabel: string
  readonly purchaseLimitLabel: string
  readonly purchaseLimitHint: string
  /** One sentence per way a base input can be wrong. Shape is the schema builder's. */
  readonly errors: ProductFieldErrorMessages
}

export interface ProductAttributeSectionMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly failureTitle: string
  readonly retryLabel: string
  /** `{label}` is filled with the definition's own label. */
  readonly errors: ProductAttributeErrorMessages
}

export interface ProductOptionMessages {
  readonly title: string
  readonly description: string
  readonly addLabel: string
  /** `옵션 {index}` — the legend that tells one axis's fieldset from the next. */
  readonly legend: string
  readonly nameLabel: string
  readonly namePlaceholder: string
  readonly removeLabel: string
  readonly valuesLabel: string
  readonly valueLabel: string
  readonly valuePlaceholder: string
  readonly addValueLabel: string
  readonly removeValueLabel: string
  readonly emptyTitle: string
  readonly emptyBody: string
  /** Why 수정 모드 offers no way to add or remove an axis (F7b). */
  readonly lockedNotice: string
  readonly issueTitle: string
  /**
   * One sentence per refusal the option editor can produce, keyed by the pure
   * module's own union — a code added there fails `pnpm typecheck` here rather
   * than rendering a blank line.
   */
  readonly issues: Readonly<Record<OptionIssueCode, string>>
  /** `{count}` combinations, `{max}` allowed. */
  readonly countLabel: string
}

export interface ProductVariantMessages {
  readonly title: string
  readonly description: string
  readonly caption: string
  readonly combinationHeader: string
  readonly skuHeader: string
  readonly priceHeader: string
  readonly listPriceHeader: string
  readonly stockHeader: string
  readonly purchaseLimitHeader: string
  readonly activeHeader: string
  /** `{combination}` and `{column}` name the cell for a screen reader. */
  readonly cellLabel: string
  readonly skuPlaceholder: string
  readonly bulkTitle: string
  readonly bulkDescription: string
  readonly bulkApplyLabel: string
  /** Announced after 모든 행에 적용, because the rows it changed may be off screen. */
  readonly bulkAppliedNotice: string
  readonly emptyTitle: string
  readonly emptyBody: string
  /** Heading of the notice above the table, where table-shaped refusals land. */
  readonly noticeTitle: string
}

export interface ProductGalleryMessages {
  readonly storedTitle: string
  /** Says why these sit apart from the widget's own rows. */
  readonly storedDescription: string
  /** `이미지 {index}` — names a thumbnail that has no alt text of its own. */
  readonly storedLabel: string
  readonly removeLabel: string
}

export interface ProductDiffMessages {
  readonly title: string
  readonly unchanged: string
  /** `{count}` combinations that would be created. */
  readonly added: string
  /** `{count}` combinations that would stop being sellable. */
  readonly deactivated: string
  /** Says the rows are switched off rather than deleted, and why. */
  readonly deactivatedHint: string
  /** `{count}` rows whose stock the save does not touch. */
  readonly kept: string
}

export interface ProductPreviewMessages {
  readonly title: string
  readonly openLabel: string
  readonly closeLabel: string
  /** Says this is a layout rehearsal, not the buyer's screen (R3). */
  readonly disclaimer: string
  readonly priceLabel: string
  readonly listPriceLabel: string
  readonly optionsLabel: string
  readonly attributesLabel: string
  readonly noImages: string
  readonly noPrice: string
  readonly soldOut: string
}

export interface ProductActionMessages {
  readonly saveDraftLabel: string
  readonly saveLabel: string
  readonly publishLabel: string
  readonly unpublishLabel: string
  readonly errorTitle: string
  readonly submitFailed: string
  /** Why 판매 시작 is available on a draft that is not finished yet. */
  readonly draftNotice: string
  readonly createdNotice: string
  readonly savedNotice: string
  readonly publishedNotice: string
  readonly unpublishedNotice: string
}

export interface ProductToastMessages {
  readonly regionLabel: string
  readonly closeLabel: string
  readonly failureTitle: string
}

/* ------------------------------------------- 상품 목록 · 재고 (TASK-0116) -- */

/** The filter bar over the listing table. */
export interface ProductListFilterMessages {
  readonly legend: string
  readonly statusLabel: string
  readonly statusAll: string
  readonly categoryLabel: string
  readonly categoryAll: string
  readonly stockLabel: string
  readonly stockAll: string
  /** `sellerStockFilters` — the two the API accepts, no more. */
  readonly stockOptions: Readonly<Record<SellerStockFilter, string>>
  readonly searchLabel: string
  readonly searchPlaceholder: string
  readonly reset: string
}

/** Column headers and the per-row controls. */
export interface ProductListTableMessages {
  readonly caption: string
  readonly name: string
  readonly status: string
  readonly totalStock: string
  readonly minPrice: string
  readonly actions: string
  /** `{name}` — an accessible name for a checkbox that has no visible label. */
  readonly selectRow: string
  readonly selectAll: string
  readonly manageStock: string
  readonly edit: string
  readonly duplicate: string
  readonly noPrice: string
}

/**
 * The two stock badges.
 *
 * `low` carries no number. Writing "5개 이하" here would be the second place
 * `LOW_STOCK_THRESHOLD` lives, and the one that would not be updated (R4).
 */
export interface ProductStockBadgeMessages {
  readonly out: string
  readonly low: string
}

/** Selecting rows and changing all of them at once. */
export interface ProductBulkMessages {
  /** `{count}` — always shown, so a selection that scrolled off is not a surprise. */
  readonly selected: string
  readonly clear: string
  readonly activate: string
  readonly deactivate: string
  readonly confirmTitle: string
  /** `{count}` */
  readonly confirmBody: string
  readonly confirm: string
  readonly cancel: string
  /** `{count}` */
  readonly done: string
}

/** Copying a listing, and saying what the copy is before the click. */
export interface ProductDuplicateMessages {
  readonly confirmTitle: string
  /** `{name}` */
  readonly confirmBody: string
  /** Why the copy is a draft — the sentence that stops a surprise publication. */
  readonly draftNotice: string
  readonly confirm: string
  readonly cancel: string
  /** `{name}` */
  readonly done: string
  readonly goToEdit: string
}

export interface ProductListMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly newProduct: string
  readonly filters: ProductListFilterMessages
  readonly table: ProductListTableMessages
  readonly badges: ProductStockBadgeMessages
  readonly bulk: ProductBulkMessages
  readonly duplicate: ProductDuplicateMessages
  readonly pagination: PaginationMessages
  readonly empty: EmptyStateMessages
  readonly filteredEmpty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  /** The refusal panel — the same six labels every screen in this app shows. */
  readonly failure: StoreFailureMessages
  readonly toast: ProductToastMessages
  readonly closeLabel: string
}

/*
 * **상태 라벨은 여기 없다.** `products.statusLabels` 가 이미 `ProductStatus`
 * 전체를 담고, 그것은 화면의 어휘가 아니라 **상품의** 어휘다. 두 벌을 두면
 * 편집기에서는 「판매 중지」이고 목록에서는 「중지됨」인 날이 온다.
 */

/** Previous · next, for the cursor pager. */
export interface PaginationMessages {
  readonly label: string
  readonly previous: string
  readonly next: string
  /** `{page}` — a keyset list knows its position but not its length. */
  readonly page: string
}

export interface EmptyStateMessages {
  readonly title: string
  readonly description: string
}

/** The adjustment control — the one that has no absolute field (F2b). */
export interface StockAdjustMessages {
  readonly deltaLabel: string
  readonly deltaPlaceholder: string
  readonly typeLabel: string
  readonly typeOptions: Readonly<Record<SellerStockAdjustType, string>>
  readonly reasonLabel: string
  readonly reasonPlaceholder: string
  readonly apply: string
  /** `{from}` → `{to}` — shown before the click, which is what R1 answers with. */
  readonly preview: string
  readonly deltaRequired: string
  readonly deltaZero: string
  /** `{max}` */
  readonly deltaRange: string
  readonly reasonTooLong: string
}

/** The history under the table. */
export interface StockLedgerMessages {
  readonly title: string
  readonly caption: string
  readonly seq: string
  readonly type: string
  readonly quantity: string
  readonly balanceAfter: string
  readonly reason: string
  readonly at: string
  readonly empty: string
  readonly noReason: string
  readonly typeLabels: Readonly<Record<StockLedgerType, string>>
  readonly close: string
  /** `{option}` — names which combination's history is open. */
  readonly openLabel: string
}

export interface ProductStockMessages {
  readonly title: string
  /** `{name}` — the listing whose combinations these are. */
  readonly subtitle: string
  readonly description: string
  readonly loadingLabel: string
  readonly backToList: string
  readonly caption: string
  readonly option: string
  readonly sku: string
  readonly stock: string
  readonly adjustColumn: string
  readonly historyColumn: string
  readonly badges: ProductStockBadgeMessages
  readonly adjust: StockAdjustMessages
  readonly ledger: StockLedgerMessages
  readonly empty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  /** `{stock}` */
  readonly adjusted: string
  readonly failure: StoreFailureMessages
  readonly toast: ProductToastMessages
}

/* ------------------------------------------------ 주문 관리 (TASK-0060) -- */

/**
 * 주문의 어휘 — 상태 · 주체 · 배송 단계.
 *
 * `Record<OrderStatus, string>` 인 것이 요점이다. 상태가 하나 늘면 **타입 검사가**
 * 빠진 문장을 잡고, 화면은 「알 수 없음」을 그릴 일이 없다.
 */
export interface OrderVocabularyMessages {
  readonly statusLabels: Readonly<Record<OrderStatus, string>>
  /** 이력의 「누가」. `SYSTEM` 이 사람이 아니라는 사실이 여기서 문장이 된다. */
  readonly actorLabels: Readonly<Record<OrderActor, string>>
  /** 액션 버튼의 이름 — 「어느 상태로」가 아니라 **무엇을 하는지**로 읽힌다. */
  readonly actionLabels: Readonly<Record<OrderStatus, string>>
  /** 조건이 모자란 버튼 옆의 사유. `blockedBy` 가 고른다. */
  readonly requirementLabels: Readonly<Record<SellerOrderRequirement, string>>
  readonly carrierLabels: Readonly<Record<DemoCarrierCode, string>>
  readonly trackingEventLabels: Readonly<Record<TrackingEventKind, string>>
}

/** 상태 탭. 이름은 설계서 4장이 정한 여섯이다. */
export interface OrderTabMessages {
  readonly label: string
  readonly names: Readonly<Record<SellerOrderTab, string>>
  /** `{name}` `{count}` — 탭 이름 뒤에 붙는 건수의 접근성 문장. */
  readonly countLabel: string
}

export interface OrderFilterMessages {
  readonly legend: string
  readonly fromLabel: string
  readonly toLabel: string
  readonly searchLabel: string
  readonly searchPlaceholder: string
  readonly reset: string
  /** 기간이 거꾸로일 때. 서버에 보내기 전에 화면이 말한다 (U2). */
  readonly rangeReversed: string
}

/** 목록 표의 열과 줄마다의 조작. */
export interface OrderTableMessages {
  readonly caption: string
  readonly orderNumber: string
  readonly orderedAt: string
  readonly status: string
  readonly recipient: string
  readonly items: string
  readonly paidAmount: string
  readonly tracking: string
  readonly actions: string
  /** `{orderNumber}` — 보이는 라벨이 없는 체크박스의 이름. */
  readonly selectRow: string
  readonly selectAll: string
  readonly open: string
  readonly noTracking: string
  /** `{headline}` `{rest}` — 「울 코트 외 2건」. 개수는 서버가 세고 문장은 여기서 만든다. */
  readonly headlineWithRest: string
  /** `{count}` */
  readonly quantity: string
}

/** 처리 대기 · 신규 주문 뱃지. */
export interface OrderBadgeMessages {
  /** `{count}` */
  readonly actionRequired: string
  /** `{count}` */
  readonly newOrders: string
  readonly none: string
}

/** 발송 처리 — 한 건이든 여러 건이든 같은 대화상자다. */
export interface OrderShipMessages {
  readonly title: string
  /** `{count}` */
  readonly bulkTitle: string
  readonly carrierLabel: string
  readonly carrierAuto: string
  readonly notice: string
  readonly confirm: string
  readonly cancel: string
  /** `{count}` */
  readonly done: string
  /** `{done}` `{failed}` — 일부만 성공했을 때. 전체를 되돌리지 않는다 (R1). */
  readonly partial: string
  readonly failedHeading: string
  readonly nothingShippable: string
}

/**
 * 내보내기 파일의 열 이름.
 *
 * 화면의 열 이름을 그대로 쓰지 않는다. 표에서는 「상품」한 칸이 대표 상품명과 개수를
 * 함께 말하지만 파일에서는 두 칸이고, 두 칸에 같은 이름을 적으면 그 파일을 여는
 * 사람이 어느 쪽이 무엇인지 알 수 없다.
 */
export interface OrderExportColumnMessages {
  readonly orderNumber: string
  readonly orderedAt: string
  readonly status: string
  readonly recipient: string
  readonly headline: string
  readonly itemCount: string
  readonly totalQuantity: string
  readonly paidAmount: string
  readonly trackingNumber: string
}

/** 일괄 선택 막대. */
export interface OrderBulkMessages {
  /** `{count}` */
  readonly selected: string
  readonly clear: string
  readonly ship: string
  readonly print: string
  readonly export: string
  readonly exporting: string
  /** `{count}` */
  readonly exported: string
  readonly exportEmpty: string
  readonly exportColumns: OrderExportColumnMessages
}

export interface OrderListMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly tabs: OrderTabMessages
  readonly filters: OrderFilterMessages
  readonly table: OrderTableMessages
  readonly badges: OrderBadgeMessages
  readonly bulk: OrderBulkMessages
  readonly ship: OrderShipMessages
  readonly pagination: PaginationMessages
  readonly empty: EmptyStateMessages
  readonly filteredEmpty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  readonly failure: StoreFailureMessages
  readonly toast: ProductToastMessages
  readonly closeLabel: string
}

/** 상태 이력 표. */
export interface OrderHistoryMessages {
  readonly title: string
  readonly caption: string
  readonly at: string
  readonly change: string
  readonly actor: string
  readonly reason: string
  readonly noReason: string
  /** `{from}` `{to}` — 「상품준비중 → 배송중」. 최초 생성에는 앞이 없다. */
  readonly step: string
  readonly created: string
  readonly empty: string
}

/** 인쇄용 주문서. 화면이 아니라 **종이**의 문구다. */
export interface OrderPrintMessages {
  readonly action: string
  readonly documentTitle: string
  readonly orderNumber: string
  readonly orderedAt: string
  readonly recipient: string
  readonly address: string
  readonly phone: string
  readonly items: string
  readonly option: string
  readonly quantity: string
  readonly unitPrice: string
  readonly amount: string
  readonly total: string
  readonly shippingFee: string
  readonly paidAmount: string
  readonly tracking: string
  readonly notice: string
}

export interface OrderDetailMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly backToList: string
  /** `{orderNumber}` */
  readonly subtitle: string
  readonly sections: {
    readonly items: string
    readonly recipient: string
    readonly amounts: string
    readonly shipment: string
  }
  readonly recipient: {
    readonly name: string
    readonly phone: string
    readonly address: string
  }
  readonly items: {
    readonly caption: string
    readonly product: string
    readonly option: string
    readonly quantity: string
    readonly unitPrice: string
    readonly amount: string
    readonly noOption: string
  }
  readonly amounts: {
    readonly productAmount: string
    readonly couponDiscountAmount: string
    readonly pointDiscountAmount: string
    readonly shippingFee: string
    readonly paidAmount: string
  }
  readonly actions: {
    readonly legend: string
    /** `{requirement}` — 왜 지금 누를 수 없는지. */
    readonly blocked: string
    /**
     * 서버가 막았는데 이유를 말하지 않은 경우.
     *
     * 지금 그런 답은 없다(`blockedBy` 는 `enabled: false` 와 짝이다). 그래도 문장이
     * 필요한 이유는 `GuardedButton` 이 **사유 없는 비활성을 컴파일로 막기** 때문이고,
     * 그 자리를 「이대로 처리할까요?」 같은 아무 문장으로 메우면 판매자는 읽고도
     * 아무것도 알지 못한다.
     */
    readonly blockedUnknown: string
    readonly reasonLabel: string
    readonly reasonPlaceholder: string
    readonly reasonRequired: string
    readonly confirmTitle: string
    /** `{action}` */
    readonly confirmBody: string
    readonly confirm: string
    readonly cancel: string
    /** `{status}` */
    readonly done: string
    readonly unchanged: string
  }
  /**
   * 배송 추적 컴포넌트가 받는 문구 전부 (`packages/ui`).
   *
   * `ShipmentTrackingLabels` 를 그대로 받는 이유는 그 컴포넌트가 **한국어를 하나도
   * 모르기** 때문이다. 앱이 문구를 넘기고, 빠뜨리면 컴파일이 멈춘다 — 「가상 배송
   * 정보입니다」가 필수 prop 인 것이 그 장치의 요점이다 (TASK-0061 R1).
   */
  readonly tracking: ShipmentTrackingLabels
  readonly copiedTrackingNumber: string
  readonly history: OrderHistoryMessages
  readonly print: OrderPrintMessages
  readonly ship: OrderShipMessages
  readonly errorTitle: string
  readonly retry: string
  readonly notFound: EmptyStateMessages
  readonly failure: StoreFailureMessages
  readonly toast: ProductToastMessages
  readonly closeLabel: string
}
