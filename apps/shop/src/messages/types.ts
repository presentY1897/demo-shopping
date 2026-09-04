import type { DensityLevel } from '@shopping/ui'
import type {
  ApiFailureReason,
  DenialReason,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  UserFacingErrorCode,
} from '@shopping/shared'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

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
