import type { DensityLevel } from '@shopping/ui'
import type {
  ApiFailureReason,
  CartItemNotice,
  DenialReason,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  SearchSort,
  UserFacingErrorCode,
} from '@shopping/shared'
import type { ProductCardLabels, ProductListLabels } from '@shopping/ui/catalog'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { SessionRefusal } from '@/lib/auth/session-client'
import type { HealthFailureReason } from '@/lib/health'
import type { CardBlock } from '@/lib/payment/cards'
import type { PaymentRefusal, PaymentStep } from '@/lib/payment/use-payment'

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
  /** 홈 (TASK-0044) — 히어로, 신상품·인기 섹션, 카테고리 바로가기, 데모 유도. */
  readonly home: HomeMessages
  /** 브랜드관 (TASK-0044). */
  readonly brand: BrandMessages
  /**
   * 검색 결과 화면 (TASK-0041) — 검색어·필터·정렬·빈 상태.
   *
   * The filter *values* are not here and never will be: 「오버사이즈」 is a row
   * an operator typed into `AttributeDefinition`, and D-005 asks that adding one
   * take no code change. What this slice holds is the frame around them — the
   * word for 「필터」, the sentence shown when nothing matched — and the panel
   * draws whatever `GET /search/filters` names.
   */
  readonly search: SearchMessages
  /**
   * 카테고리 화면 (TASK-0042) — 브레드크럼·하위 바로가기·헤더 메뉴.
   *
   * The filters and the results say nothing here: they are `search`'s, and the
   * two screens share the component that draws them. What this slice holds is
   * the frame the category adds around it.
   */
  readonly category: CategoryMessages
  /**
   * 상품 상세 (TASK-0043) — 갤러리·옵션·구매 영역·정보.
   *
   * 밀도가 무엇을 보여 줄지 정하지만 **문구는 한 벌이다.** 단계마다 다른 낱말을
   * 쓰면 세 벌을 유지해야 하고, 실제로 다른 것은 「얼마나 보여 주는가」이지
   * 「뭐라고 부르는가」가 아니다.
   */
  readonly productDetail: ProductDetailMessages
  /**
   * 장바구니 (TASK-0046) — 판매자별 그룹, 선택, 합계, 빈 상태.
   *
   * 숫자가 들어가는 문장은 전부 자리표시자를 갖는다. 어순은 언어의 성질이라
   * 컴포넌트에서 조립하면 다른 언어를 넣을 수 없다.
   */
  readonly cart: CartMessages
  /**
   * 주문서 (TASK-0050) — 타이머, 배송지, 금액, 약관, 그리고 아직 안 온 것들의 자리.
   *
   * 「자리」의 문구가 여기 있는 이유는 4.5 다 — 빈 상자는 만들다 만 화면으로
   * 보이고, 이름이 붙은 빈 상자는 아직 안 온 기능으로 보인다.
   */
  readonly checkout: CheckoutMessages
  /**
   * Screens whose route exists so the header's links are not dead ends, and
   * whose content arrives with its own milestone (TASK-0018 4.5).
   */
  readonly placeholder: PlaceholderMessages
  /** Route-level loading, not-found and error states (P5). */
  readonly routeStates: RouteStateMessages
  /**
   * Signing in, and being told why something is not allowed (TASK-0023).
   *
   * **Every record below is keyed by a union `@shopping/shared` owns**, so a new
   * outcome, refusal or denial reason added there fails `pnpm typecheck` here
   * rather than rendering a blank line to whoever hit it. That is the same
   * device the console catalogs use for `UserFacingErrorCode`, applied to the
   * vocabulary the sign-in round trip actually speaks.
   */
  readonly auth: AuthMessages
  /** The demo account banner and the button that issues one (TASK-0024). */
  readonly demo: DemoMessages
  /**
   * The account screens — profile, display and notification settings,
   * withdrawal, the address book (TASK-0112).
   *
   * Its own slice rather than more keys under `auth`: `auth` is about *being*
   * signed in, and this is about what one does afterwards. The two are read by
   * different screens and only this one is behind `RequireSignIn`.
   */
  readonly mypage: MyPageMessages
}

export interface MyPageMessages {
  readonly title: string
  readonly description: string
  readonly nav: MyPageNavMessages
  readonly settings: SettingsMessages
  readonly addresses: AddressBookMessages
  /** A request that never got an answer. Keyed by the reason it did not. */
  readonly failures: Readonly<Record<ApiFailureReason, string>>
  /**
   * The refusals these screens **branch on**, keyed by `error.code`.
   *
   * A subset of `UserFacingErrorCode`, and the one place this catalog differs
   * in kind from the consoles' exhaustive `Record<UserFacingErrorCode, string>`.
   * TASK-0023 kept an exhaustive one out of `apps/shop` because a storefront
   * with one reachable sentence in fifteen is a catalog that drifts unnoticed;
   * the account screens raise that to five, not to fifteen. Anything unlisted
   * keeps the server's own sentence, which is what `serverFieldErrors` already
   * falls back to (TASK-0112 4장).
   *
   * `satisfies` on the list below is what keeps the subset honest: a code
   * renamed in `@shopping/shared` fails `pnpm typecheck` here, exactly as it
   * would in the consoles.
   */
  readonly errors: Readonly<Record<MyPageErrorCode, string>>
  readonly loadingLabel: string
  readonly loadErrorTitle: string
  readonly retryLabel: string
  /** Shown only for a failure the reader cannot act on — a 5xx with an id. */
  readonly requestIdLabel: string
  readonly requestIdHint: string
  readonly copyLabel: string
  readonly copiedLabel: string
}

export const myPageErrorCodes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const satisfies readonly UserFacingErrorCode[]

export type MyPageErrorCode = (typeof myPageErrorCodes)[number]

export interface MyPageNavMessages {
  readonly label: string
  readonly settings: string
  readonly addresses: string
}

export interface SettingsMessages {
  readonly title: string
  readonly description: string
  readonly profile: ProfileFormMessages
  readonly density: DensitySettingMessages
  readonly notifications: NotificationSettingMessages
  readonly withdrawal: WithdrawalMessages
}

export interface ProfileFormMessages {
  readonly legend: string
  readonly avatarAlt: string
  readonly nameLabel: string
  readonly nameHint: string
  readonly namePlaceholder: string
  readonly avatarLabel: string
  readonly avatarHint: string
  readonly avatarPlaceholder: string
  /** Google owns the identity, so the address is shown and never edited. */
  readonly emailLabel: string
  readonly emailHint: string
  readonly rolesLabel: string
  readonly save: string
  readonly saving: string
  readonly savedNotice: string
  readonly submitError: string
  /** One sentence per rule the shared schema owns. The rule itself stays there. */
  readonly nameError: string
  readonly avatarError: string
}

export interface DensitySettingMessages {
  readonly title: string
  readonly description: string
  readonly savedNotice: string
  readonly saveError: string
}

export interface NotificationSettingMessages {
  readonly legend: string
  readonly description: string
  /** One per switch, keyed by the `userPreferenceSchema` field it writes. */
  readonly switches: Readonly<Record<'notifyOrder' | 'notifyClaim' | 'notifyMarketing', ToggleCopy>>
  readonly savedNotice: string
  readonly saveError: string
}

export interface ToggleCopy {
  readonly label: string
  readonly description: string
}

export interface WithdrawalMessages {
  readonly title: string
  readonly description: string
  /** What is erased and what survives. Rendered as a list, not a sentence. */
  readonly erased: readonly string[]
  readonly kept: readonly string[]
  readonly trigger: string
  readonly confirmTitle: string
  readonly confirmDescription: string
  /**
   * The word a person types to confirm, and its label.
   *
   * A second step in front of an irreversible action, because a dialog whose
   * confirm button is one keypress away is a formality (TASK-0112 R4).
   */
  readonly phrase: string
  readonly phraseLabel: string
  readonly phraseHint: string
  readonly phraseMismatch: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly closeLabel: string
  readonly blockedReason: string
  readonly doneTitle: string
  readonly doneBody: string
  readonly doneAddresses: string
  readonly doneSessions: string
  readonly failed: string
}

export interface AddressBookMessages {
  readonly title: string
  readonly description: string
  readonly listLabel: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly addLabel: string
  readonly defaultBadge: string
  readonly makeDefault: string
  readonly edit: string
  readonly remove: string
  readonly recipientLabel: string
  readonly phoneLabel: string
  readonly removeTitle: string
  readonly removeDescription: string
  readonly removeConfirm: string
  readonly removeCancel: string
  readonly removeCloseLabel: string
  readonly removedNotice: string
  /** Said only when the deletion moved the default to another address. */
  readonly promotedNotice: string
  readonly defaultChangedNotice: string
  readonly savedNotice: string
  readonly form: AddressFormMessages
}

export interface AddressFormMessages {
  readonly addTitle: string
  readonly editTitle: string
  readonly labelLabel: string
  readonly labelHint: string
  readonly labelPlaceholder: string
  readonly recipientLabel: string
  readonly recipientPlaceholder: string
  readonly phoneLabel: string
  readonly phoneHint: string
  readonly phonePlaceholder: string
  readonly postalCodeLabel: string
  readonly postalCodePlaceholder: string
  readonly addressLine1Label: string
  readonly addressLine1Placeholder: string
  readonly addressLine2Label: string
  readonly addressLine2Hint: string
  readonly addressLine2Placeholder: string
  readonly makeDefaultLabel: string
  readonly makeDefaultHint: string
  readonly firstIsDefaultHint: string
  readonly searchLabel: string
  readonly searchOpening: string
  readonly searchPanelLabel: string
  readonly searchClose: string
  /** Shown when the widget could not be used, above the three plain fields. */
  readonly manualTitle: string
  readonly manualBody: string
  readonly save: string
  readonly saving: string
  readonly cancel: string
  readonly submitError: string
  /** Field-level copy for the two rules the shared schema owns. */
  readonly errors: AddressFormErrorMessages
}

export interface AddressFormErrorMessages {
  readonly label: string
  readonly recipientName: string
  readonly phone: string
  readonly postalCode: string
  readonly addressLine1: string
  readonly addressLine2: string
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
  readonly requireSignIn: RequireSignInMessages
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
 * Kept apart from the failures above because these are *results of a round
 * trip*, not states of this screen — and because both unions are contracts the
 * API owns.
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
 * (`denialReasons`), so a disabled button and a 403 say the same thing. The
 * other two are states only a browser has.
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
  /** Links to `/mypage/settings`, which TASK-0112 built. */
  readonly profileLabel: string
}

export interface RequireSignInMessages {
  readonly title: string
  readonly body: string
  readonly action: string
  readonly checkingLabel: string
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
  /** Announced inside a link while its route is still loading. */
  readonly pendingLabel: string
}

export interface SearchSlotMessages {
  readonly label: string
  readonly placeholder: string
  readonly submit: string
  /** Names the candidate listbox. */
  readonly suggestionsLabel: string
  /**
   * Announced when candidates appear. `{count}`.
   *
   * A dropdown that opens silently is a dropdown a screen reader user never
   * learns is there — the arrow keys do something new and nothing said so.
   */
  readonly suggestionsHint: string
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
  readonly heroTitle: string
  readonly heroBody: string
  readonly heroSearchCta: string
  readonly newTitle: string
  readonly popularTitle: string
  readonly categoriesTitle: string
  readonly loadingLabel: string
  readonly sectionEmpty: string
  readonly moreLabel: string
  /** The first-visit nudge towards a demo account (F5). */
  readonly demo: HomeDemoMessages
  readonly card: ProductCardLabels
  readonly gridLabel: string
}

export interface HomeDemoMessages {
  readonly title: string
  readonly body: string
  readonly cta: string
  readonly dismiss: string
}

export interface BrandMessages {
  /** `{brand}` */
  readonly metaTitle: string
  /** `{brand}` */
  readonly metaDescription: string
  readonly logoAlt: string
  readonly noIntroduction: string
  readonly follow: string
  readonly followComingSoon: string
  readonly productsTitle: string
  /** `{count}` */
  readonly productCount: string
}

export interface PlaceholderMessages {
  readonly comingSoon: string
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

/**
 * 검색 화면의 문구 (TASK-0041).
 *
 * `list` 와 `card` 는 `@shopping/ui/catalog` 가 요구하는 모양 그대로다.
 * `packages/ui` 는 한국어를 담지 않기로 했으므로(TASK-0015), 카드가 그리는 모든
 * 낱말은 이 카탈로그를 거쳐 들어간다.
 */
export interface SearchMessages {
  /** `<h1>` before anything has been searched for. */
  readonly title: string
  /** `{term}` — the `<h1>` once there is a term. */
  readonly titleFor: string
  /** `{count}` */
  readonly totalLabel: string
  /** Names the results region. */
  readonly resultsLabel: string
  readonly promptTitle: string
  readonly promptBody: string
  /** F6 — the results are approximate, and these are the words that were bent. */
  readonly approximateTitle: string
  /** `{terms}` */
  readonly approximateBody: string
  readonly sort: SearchSortMessages
  readonly filters: SearchFilterMessages
  readonly list: ProductListLabels
  readonly card: ProductCardLabels
}

export interface SearchSortMessages {
  readonly label: string
  readonly names: Readonly<Record<SearchSort, string>>
}

export interface SearchFilterMessages {
  readonly title: string
  /** Opens the bottom sheet on a phone (F9). */
  readonly openLabel: string
  readonly closeLabel: string
  readonly applyLabel: string
  /** Names the region holding the applied-filter chips. */
  readonly appliedLabel: string
  readonly clearAll: string
  /** `{name}` — accessible name of one chip's × button. */
  readonly removeLabel: string
  /** `{count}` — how many results a facet value would leave. */
  readonly facetCount: string
  /** Said in place of a panel when the category declares no filters. */
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly loadingLabel: string
  readonly inStock: string
  readonly inStockChip: string
  /** `{min}` · `{max}` — the applied-price chip. `{max}` is empty when open-ended. */
  readonly priceChip: string
  readonly price: SearchPriceMessages
}

export interface SearchPriceMessages {
  readonly legend: string
  readonly minLabel: string
  readonly maxLabel: string
  readonly placeholderMin: string
  readonly placeholderMax: string
  readonly applyLabel: string
  /** Shown when the upper bound is below the lower one. */
  readonly invalid: string
}

export interface CategoryMessages {
  /** `{name}` — the document title. */
  readonly metaTitle: string
  /** `{name}` — the meta description, and what a search result quotes. */
  readonly metaDescription: string
  /** Names the breadcrumb landmark. */
  readonly breadcrumbLabel: string
  readonly homeLabel: string
  /** Heading over the child-category shortcuts. */
  readonly subcategoriesLabel: string
  /** Names the header's category navigation. */
  readonly menuLabel: string
  /** `{name}` — the link that goes to the parent's own full list. */
  readonly allOfLabel: string
  readonly loadingLabel: string
}

export interface ProductDetailMessages {
  /** `{name}` */
  readonly metaTitle: string
  /** `{brand}` · `{name}` */
  readonly metaDescription: string
  readonly loadingLabel: string
  readonly errorTitle: string
  readonly retryLabel: string
  readonly sellerLabel: string
  /** `{brand}` — the link to the brand's own page. */
  readonly brandLink: string
  readonly gallery: ProductGalleryMessages
  readonly options: ProductOptionMessages
  readonly purchase: ProductPurchaseMessages
  readonly info: ProductInfoMessages
}

export interface ProductGalleryMessages {
  readonly label: string
  readonly thumbnailsLabel: string
  /** `{index}` — accessible name of one thumbnail. */
  readonly thumbnailLabel: string
  readonly previous: string
  readonly next: string
  readonly zoomIn: string
  readonly zoomOut: string
  /** `{name}` · `{index}` — used when an image carries no alt text of its own. */
  readonly imageAlt: string
  readonly empty: string
  /** `{index}` · `{total}` — announced as the gallery moves. */
  readonly position: string
}

export interface ProductOptionMessages {
  readonly soldOut: string
  /** A combination the seller never made. **Not** the same word as 품절. */
  readonly missing: string
  readonly skuLabel: string
  /** `{count}` */
  readonly stockLabel: string
  readonly chooseNotice: string
  /** `{option}` · `{value}` — announced when a choice clears another axis. */
  readonly clearedNotice: string
}

export interface ProductPurchaseMessages {
  readonly legend: string
  readonly addToCart: string
  readonly buyNow: string
  readonly wishlist: string
  /** Said under the two buttons: they are placeholders until M07. */
  readonly comingSoon: string
  readonly quantityLabel: string
  readonly decrease: string
  readonly increase: string
  /** `{count}` */
  readonly limitNotice: string
  readonly soldOutNotice: string
  readonly totalLabel: string
}

export interface ProductInfoMessages {
  readonly descriptionLabel: string
  readonly noDescription: string
  readonly attributesLabel: string
  /** The minimal step keeps the table folded; this opens it. */
  readonly attributesToggle: string
  readonly shippingLabel: string
  /** One line at minimal, a summary at standard, the full block at maximal. */
  readonly shippingMinimal: string
  readonly shippingSummary: string
  readonly shippingDetailed: string
  /** `{date}` — maximal only. */
  readonly estimatedArrival: string
  readonly reviewsLabel: string
  /** `{score}` · `{count}` */
  readonly reviewsSummary: string
  readonly reviewsLink: string
  readonly reviewsComingSoon: string
  readonly inquiriesLabel: string
  readonly inquiriesComingSoon: string
  readonly recommendationsLabel: string
  readonly recommendationsComingSoon: string
  readonly badges: ProductBadgeMessages
}

export interface ProductBadgeMessages {
  /** `{count}` */
  readonly salesCount: string
  /** `{score}` */
  readonly rating: string
  /** `{count}` */
  readonly lowStock: string
}

/**
 * 장바구니 화면 (TASK-0046).
 *
 * 「품절」과 「판매 중단」이 다른 낱말인 것이 이 슬라이스의 요점이다 — 둘 다 고를
 * 수 없지만 **사람이 다음에 할 일이 다르다.** 하나는 기다리면 오고 하나는 오지
 * 않는다.
 */
export interface CartMessages {
  readonly title: string
  /** 맨 위 체크박스. `{count}` — 고를 수 있는 줄의 수. */
  readonly selectAll: string
  /** 한 그룹의 체크박스. `{brand}` */
  readonly selectGroup: string
  /** 한 줄의 체크박스. `{name}` */
  readonly selectItem: string
  readonly removeSelected: string
  /** 한 줄을 지우는 버튼. `{name}` */
  readonly removeItem: string
  readonly increase: string
  readonly decrease: string
  readonly quantityLabel: string
  /** 그룹 헤더의 배송비. `{amount}` */
  readonly shippingFee: string
  readonly freeShipping: string
  /** 무료배송까지 남은 금액. `{amount}` */
  readonly freeShippingRemaining: string
  readonly productAmountLabel: string
  readonly shippingLabel: string
  readonly totalLabel: string
  /** 주문 버튼. `{count}` — 고른 줄의 수. */
  readonly checkout: string
  /** 아무것도 고르지 않았을 때 주문 버튼 아래에 나오는 이유. */
  readonly nothingSelected: string
  /** 주문서를 열지 못했다 — 대부분 그 사이에 품절된 것이다. */
  readonly checkoutFailed: string
  /** 줄에 붙는 알림. `notices` 의 각 값에 하나씩 — 빠지면 타입 검사가 잡는다. */
  readonly notices: Readonly<Record<CartItemNotice, string>>
  /** 담을 때 가격과 지금 가격을 나란히 보여 준다. `{amount}` */
  readonly priceAtAdded: string
  /** 담기의 결과. 「담김」과 「아직」이 같은 화면이 되지 않게 문장이 셋이다. */
  readonly addPending: string
  readonly added: string
  readonly addFailed: string
  /** 담긴 뒤 장바구니로 가는 링크. */
  readonly viewCart: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly emptyAction: string
  readonly loading: string
  readonly failedTitle: string
  readonly failedBody: string
  readonly retry: string
  /** 쓰기가 실패했을 때. 화면은 그대로 두고 이 문장만 보여 준다. */
  readonly changeFailed: string
}

/** 주문서 화면 (TASK-0050). */
export interface CheckoutMessages {
  readonly title: string
  /** 남은 시간. `{time}` — `12:05`. */
  readonly remaining: string
  /** 마지막 3분. 같은 자리에 다른 문장이 들어간다 (R1: 과하게 강조하지 않는다). */
  readonly remainingUrgent: string
  readonly itemsTitle: string
  readonly recipientTitle: string
  readonly recipientChoose: string
  readonly recipientAdd: string
  readonly recipientNone: string
  readonly noteLabel: string
  readonly notePlaceholder: string
  readonly summaryTitle: string
  readonly productAmountLabel: string
  readonly discountLabel: string
  readonly shippingLabel: string
  readonly totalLabel: string
  /** 아직 안 온 것의 자리 (4.5). 「준비 중」이 아니라 무엇이 올지를 적는다. */
  readonly couponTitle: string
  readonly couponBody: string
  /**
   * 결제수단 (TASK-0054). 4.5 가 자리만 두라고 한 그 자리에 실제 결제가 들어왔다.
   *
   * 주문서 안의 한 영역이므로 여기 아래 산다 — 결제 화면이 따로 생기는 것이 아니라
   * 주문서가 결제까지 한다.
   */
  readonly payment: PaymentMessages
  readonly termsLabel: string
  readonly placeOrder: string
  readonly placing: string
  readonly placeFailed: string
  /** 배송지를 안 골랐을 때 주문 버튼 아래에 나오는 이유. */
  readonly recipientRequired: string
  readonly termsRequired: string
  readonly expiredTitle: string
  readonly expiredBody: string
  readonly backToCart: string
  readonly loading: string
  readonly failedTitle: string
  readonly failedBody: string
  /**
   * 주문만 만들어지고 결제로 가지 않은 끝 (TASK-0050 4.6).
   *
   * M08 이 그 자리에 결제를 붙였으므로 주문서는 더 이상 여기서 멈추지 않는다. 문구가
   * 남아 있는 것은 `useCheckout` 이 아직 그 상태를 낼 수 있기 때문이고, 낼 수 있는
   * 상태를 그리지 않는 화면은 빈 화면을 그린다.
   */
  /** 주문번호. 결제가 끝난 화면도 이 문장을 쓴다. `{number}` */
  readonly placedOrderNumber: string
}

/**
 * 결제수단 (TASK-0054).
 *
 * **레코드 둘의 키가 유니온이다.** 걸음이 하나 늘거나 거절 사유가 하나 늘면 여기가
 * 비는 것이 아니라 `pnpm typecheck` 이 깨진다 — 사람이 결제 도중에 만나는 문장이
 * 빠지는 것은 그때 아무 말도 못 듣는다는 뜻이고, 그것이 가장 나쁜 실패다.
 */
export interface PaymentMessages {
  readonly title: string
  readonly loading: string
  /** 라디오 그룹의 이름. 화면에는 없고 접근성 트리에만 있다. */
  readonly chooseCard: string
  /** 카드 한 장의 이름. `{brand}` · `{number}` */
  readonly cardLabel: string
  /** 남은 한도. `{amount}` */
  readonly available: string
  /**
   * 고를 수 없는 카드 옆에 적는 이유. 상태마다 하나씩.
   *
   * 숨기지 않고 이유를 붙이는 것이 이 저장소의 규칙이다 (TASK-0023 4장) — 없는
   * 것처럼 감추면 카드를 정지시킨 사람은 자기 카드가 사라졌다고 믿는다.
   */
  readonly blocked: Readonly<Record<CardBlock, string>>
  /** 카드가 한 장도 없을 때. 만들러 갈 곳까지 말한다. */
  readonly noneTitle: string
  readonly noneBody: string
  readonly noneAction: string
  /** 카드를 안 골랐을 때 주문 버튼 아래에 나오는 이유. */
  readonly cardRequired: string
  /** 지금 무엇을 하는 중인가. 걸음마다 하나씩. */
  readonly progress: Readonly<Record<PaymentStep, string>>
  /** 끝나지 못한 이유. `exceeds_credit` 은 모자란 금액 `{amount}` 를 받는다. */
  readonly refusals: Readonly<Record<PaymentRefusal, string>>
  /** 실패해도 예약은 유지된다 (4.3). 어느 실패에나 같이 붙는 한 문장이다. */
  readonly holdKept: string
  readonly retry: string
  readonly paidTitle: string
  readonly paidBody: string
}
