import type { DensityLevel } from '@shopping/ui'
import type {
  ApiFailureReason,
  CartItemNotice,
  ClaimFault,
  ClaimRefusal,
  ClaimType,
  CouponApplicabilityFault,
  CouponIssuerType,
  CouponScopeType,
  DenialReason,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  OrderStatus,
  PointTransactionType,
  ReturnReason,
  SearchSort,
  UserCouponStatus,
  UserFacingErrorCode,
} from '@shopping/shared'
import type { ProductCardLabels, ProductListLabels } from '@shopping/ui/catalog'
import type { ShipmentTrackingLabels } from '@shopping/ui/components'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { SessionRefusal } from '@/lib/auth/session-client'
import type { CardTransactionKind } from '@/lib/cards/cards-api'
import type { ClaimDraftIssue } from '@/lib/claims/claim-draft'
import type { ReturnPhotoRejection } from '@/lib/claims/return-photos'
import type { ReturnPhotoStatus } from '@/lib/claims/use-return-photos'
import type { HealthFailureReason } from '@/lib/health'
import type { OrderPeriod, OrderStatusFilter } from '@/lib/orders/order-filters'
import type { OrderStage, OrderStageState } from '@/lib/orders/order-stages'
import type { CardBlock } from '@/lib/payment/cards'
import type { CardStatus } from '@/lib/payment/payment-api'
import type { TossConfirmFailure, TossFailureKind } from '@/lib/payment/toss-return'
import type { OrderRefusal, PaymentRefusal, PaymentStep } from '@/lib/payment/use-payment'

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
  /** 가상 카드 관리 (TASK-0058). */
  readonly cards: CardWalletMessages
  /** 쿠폰함 — 탭 셋, 만료 임박, 코드 등록 (TASK-0077). */
  readonly coupons: CouponBoxMessages
  /** 적립금 내역 — 잔액과 원장 (TASK-0077). */
  readonly points: PointScreenMessages
  /** 마이페이지 머리의 두 숫자 — 잔액과 쿠폰 수 (TASK-0077). */
  readonly summary: AccountSummaryMessages
  /** 주문 내역 목록 (TASK-0063). */
  readonly orders: OrderHistoryMessages
  /** 주문 하나 — 판매자별 묶음 (TASK-0063). */
  readonly orderDetail: OrderDetailMessages
  /** 취소·반품 신청 (TASK-0066). */
  readonly claim: ClaimRequestMessages
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
  /**
   * 카드를 더 만들 수 없다 (TASK-0058). `params.max` 를 문장에 싣는다.
   *
   * 이 둘이 목록에 들어오는 이유는 **화면이 실제로 갈라지기** 때문이다 — 장수를
   * 채운 사람이 할 일은 카드를 지우는 것이고, 한도가 잘못된 사람이 할 일은 숫자를
   * 고치는 것이다. 서버 문장을 그대로 흘리면 그 갈림이 화면에서 사라진다.
   */
  'CARD_COUNT_REACHED',
  'CARD_AMOUNT_INVALID',
  /**
   * 반품 사진 거절 다섯 (TASK-0067).
   *
   * **목록이 늘어나는 것을 감수하는 이유가 둘이다.** 하나는 `CARD_COUNT_REACHED`
   * 와 같다 — `RETURN_PHOTO_TOO_MANY` 는 `params.max` 를 문장에 끼워 넣어야 하고,
   * 코드를 모르면 화면은 서버 문장을 그대로 흘려 **`{max}` 를 그대로 그린다.**
   *
   * 다른 하나는 이 다섯이 **사람이 할 일이 서로 다른** 거절이기 때문이다. 사진을
   * 찍어 와야 하는 사람과, 사유를 고쳐야 하는 사람과, 한 장을 빼야 하는 사람에게
   * 같은 문장을 보이면 서버가 코드를 다섯으로 나눈 일이 화면에서 다시 하나로
   * 뭉개진다.
   */
  'RETURN_PHOTO_REQUIRED',
  'RETURN_PHOTO_NOT_ALLOWED',
  'RETURN_PHOTO_TOO_MANY',
  'RETURN_PHOTO_DUPLICATE',
  'RETURN_PHOTO_FOREIGN',
  /**
   * 쿠폰 코드 등록의 거절 일곱 (TASK-0077 F3).
   *
   * **일곱이 전부 여기 있어야 하는 이유는 사람이 할 일이 일곱 가지로 다르기**
   * 때문이다. 아직 시작하지 않은 쿠폰을 든 사람은 **기다리면** 되고, 끝난 쿠폰을 든
   * 사람은 무엇을 해도 안 되며, 이미 받은 사람이 할 일은 쿠폰함을 보는 것이고, 소진된
   * 쿠폰을 든 사람은 다음 캠페인을 기다린다. 계약이 코드를 일곱으로 나눈 이유가 그
   * 차이이므로(`error-codes.ts`), 화면이 하나로 뭉치면 서버가 한 일이 화면에서 없던
   * 일이 된다.
   *
   * 서버 문장을 그대로 흘리는 길도 있었다. 그러나 그 문장은 **발행자에게 하는 말**로
   * 쓰여 있고(`coupon-rules.ts` 가 콘솔과 공유한다), 「체험용 쿠폰이라 체험 계정에만
   * 지급할 수 있어요」는 지급하는 사람의 문장이지 받으려던 사람의 문장이 아니다.
   */
  'COUPON_CODE_UNKNOWN',
  'COUPON_ALREADY_ISSUED',
  'COUPON_NOT_STARTED',
  'COUPON_ENDED',
  'COUPON_ISSUE_EXHAUSTED',
  'COUPON_SUSPENDED',
  'COUPON_DEMO_ONLY',
] as const satisfies readonly UserFacingErrorCode[]

export type MyPageErrorCode = (typeof myPageErrorCodes)[number]

export interface MyPageNavMessages {
  readonly label: string
  readonly settings: string
  readonly addresses: string
  readonly cards: string
  /** 주문 내역 (TASK-0063). 계정 화면 넷 중 사람이 가장 자주 찾는 것이라 맨 앞이다. */
  readonly orders: string
  /** 쿠폰함 (TASK-0077). */
  readonly coupons: string
  /** 적립금 내역 (TASK-0077). */
  readonly points: string
}

/**
 * 주문 상태의 이름, 아홉 개 전부 (TASK-0063).
 *
 * **`Record` 라 상태가 하나 늘면 `pnpm typecheck` 이 깨진다.** 계약이 열거형을 지금
 * 전부 적어 둔 이유가 이것이다(`api/orders.ts`) — 문장이 빠진 상태로 배지가 그려지면
 * 화면은 사람에게 「」를 보여 주고, 그것은 아무도 신고하지 않는 종류의 결함이다.
 */
export type OrderStatusMessages = Readonly<Record<OrderStatus, string>>

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
 * 가상 카드 관리 (TASK-0058).
 *
 * **레코드 셋의 키가 유니온이다** — 카드 상태, 원장의 종류, 발급 폼의 오류. 상태가
 * 하나 늘거나 원장에 새 종류가 생기면 여기가 비는 것이 아니라 `pnpm typecheck` 이
 * 깨진다. 이 화면에서 문장이 빠진다는 것은 사람이 「무슨 일이 일어났는지」를 못 듣는
 * 것이고, 잔액을 확인하러 온 화면에서 그것은 가장 나쁜 실패다.
 */
export interface CardWalletMessages {
  readonly title: string
  readonly description: string
  /**
   * 「이건 진짜 카드가 아니다」 (R1).
   *
   * 목록보다 **먼저** 읽히는 자리에 놓인다 — 어디에 놓는지와 그 이유는
   * `card-wallet.tsx` 에 적혀 있다.
   */
  readonly noticeTitle: string
  readonly noticeBody: string
  readonly listLabel: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyBody: string
  /** 카드 한 장의 이름. 버튼의 접근성 이름도 이것으로 만든다. `{brand}` · `{number}` */
  readonly cardLabel: string
  readonly limitLabel: string
  readonly usedLabel: string
  readonly availableLabel: string
  /** 유효기간. `{date}` */
  readonly expiresLabel: string
  /**
   * 상태 배지.
   *
   * `DELETED` 도 적는다. 목록에는 나오지 않지만 그것을 「없는 상태」로 두면 서버가
   * 언젠가 보내는 날 화면이 빈 배지를 그린다.
   */
  readonly statuses: Readonly<Record<CardStatus, string>>
  readonly suspend: string
  readonly activate: string
  readonly remove: string
  readonly openLedger: string
  readonly closeLedger: string
  readonly suspendedNotice: string
  readonly activatedNotice: string
  readonly removedNotice: string
  /** 발급이 끝났을 때. 어느 카드가 생겼는지까지 말한다. `{number}` */
  readonly issuedNotice: string
  readonly removeTitle: string
  readonly removeDescription: string
  readonly removeConfirm: string
  readonly removeCancel: string
  readonly removeCloseLabel: string
  readonly writeFailedTitle: string
  readonly issue: CardIssueMessages
  readonly ledger: CardLedgerMessages
}

/** 발급 폼 — 한도 하나를 받는다. */
export interface CardIssueMessages {
  readonly open: string
  readonly title: string
  readonly limitLabel: string
  /** 상·하한을 문장에 싣는다. `{min}` · `{max}` */
  readonly limitHint: string
  readonly limitPlaceholder: string
  /**
   * 지금 친 숫자를 금액으로 되읽어 준다. `{amount}`
   *
   * 0을 하나 더 친 것을 눈으로 잡는 장치다 — 「10000000」은 세기 어렵고
   * 「₩10,000,000」은 어렵지 않다.
   */
  readonly limitEcho: string
  /** 금액을 치는 자리에서 한 번 더 (R1). */
  readonly virtualHint: string
  readonly submit: string
  readonly submitting: string
  readonly cancel: string
  readonly submitError: string
  readonly errors: CardIssueErrorMessages
}

export interface CardIssueErrorMessages {
  readonly notANumber: string
  /** 두 경계를 자기 안에 싣는다 — 그것을 알아야 고칠 수 있다. `{min}` · `{max}` */
  readonly outOfRange: string
}

/**
 * 사용 내역 (F3 · F4).
 *
 * **이 표가 이 화면의 존재 이유다.** 승인과 환불이 시간순으로 놓이고 각 줄이 그
 * 직후의 잔액을 들고 있어야, 「환불이 정말 돌아왔나」에 눈으로 답할 수 있다.
 */
export interface CardLedgerMessages {
  /** `{brand}` */
  readonly title: string
  readonly caption: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly failedTitle: string
  readonly retryLabel: string
  readonly atColumn: string
  readonly kindColumn: string
  readonly amountColumn: string
  readonly usedColumn: string
  readonly availableColumn: string
  readonly orderColumn: string
  readonly kinds: Readonly<Record<CardTransactionKind, string>>
  /** 결제를 거치지 않은 줄. 링크가 없는 줄이지 잘못된 줄이 아니다 (4.2). */
  readonly noOrder: string
  /** 주문 링크의 접근성 이름. 표 안에 같은 이름의 링크가 여럿이라 필요하다. `{number}` */
  readonly orderLink: string
}

/**
 * 쿠폰함 (TASK-0077 F1 · F2 · F3).
 *
 * **빈 상태가 탭마다 다르다.** 쓸 수 있는 쿠폰이 없는 사람이 할 일은 코드를 넣거나
 * 기획전을 보러 가는 것이고, 쓴 쿠폰이 없는 사람에게는 할 일이 없으며, 만료된 쿠폰이
 * 없는 것은 **좋은 소식**이다. 한 문장으로 덮으면 그 셋 중 둘에게 틀린 말을 한다 —
 * 주문 내역이 빈 상태를 둘로 나눈 것과 같은 판단이다.
 *
 * **할인 표기가 두 벌인 것은 단위가 다르기 때문이다.** `FIXED` 의 `discountValue` 는
 * 원이고 `PERCENT` 의 그것은 퍼센트라(계약), 한 문장에 `{value}` 를 끼워 넣으면
 * 「10원 할인」과 「3000% 할인」 중 하나가 반드시 나온다.
 */
export interface CouponBoxMessages {
  readonly title: string
  readonly description: string
  readonly tabsLabel: string
  /**
   * 탭 셋의 이름. `Record` 라 상태가 하나 늘면 `pnpm typecheck` 이 깨진다 — 이름 없는
   * 탭은 사람에게 「」로 보이고, 그것은 아무도 신고하지 않는 종류의 결함이다.
   */
  readonly tabs: Readonly<Record<UserCouponStatus, string>>
  /** 탭에 붙는 수의 접근성 이름. `{count}` */
  readonly tabBadge: string
  readonly listLabel: string
  readonly loadingLabel: string
  /** 탭마다의 빈 상태. 셋이 서로 다른 말을 한다 — 위 문단 참조. */
  readonly empty: Readonly<Record<UserCouponStatus, EmptyStateCopy>>
  /** 쓸 수 있는 쿠폰이 없는 사람이 갈 곳. */
  readonly emptyAction: string
  /** `{count}` — 지금까지 불러온 장수. */
  readonly countLabel: string
  readonly loadMore: string
  readonly loadingMore: string
  readonly loadMoreFailedTitle: string
  /**
   * 만료 임박 배지 (F2). `{days}`
   *
   * 남은 날을 문장에 싣는 이유는 「곧」이 사람마다 다르기 때문이다. 「3일 남음」은
   * 오늘 쓸지 내일 쓸지를 정할 수 있게 하고, 「곧 만료」는 그렇지 않다.
   */
  readonly expiringBadge: string
  /** 정액 할인. `{amount}` */
  readonly discountFixed: string
  /** 정률 할인. `{percent}` */
  readonly discountPercent: string
  /** 정률의 상한. 정액에는 뜻이 없어 그리지 않는다. `{amount}` */
  readonly maxDiscount: string
  /** `{amount}` 이상 살 때만 쓸 수 있다. */
  readonly minOrder: string
  /** 최소 주문금액이 0원인 쿠폰. 「0원 이상」이라고 적으면 조건이 있는 것처럼 읽힌다. */
  readonly noMinOrder: string
  /** 누가 부담하는가 — 플랫폼 쿠폰인지 이 가게의 쿠폰인지. */
  readonly issuers: Readonly<Record<CouponIssuerType, string>>
  /** 어디에 쓸 수 있는가. */
  readonly scopes: Readonly<Record<CouponScopeType, string>>
  /** `{date}` 까지 쓸 수 있다. */
  readonly expiresAt: string
  /** `{date}` 에 썼다. */
  readonly usedAt: string
  /** `{date}` 에 만료됐다. */
  readonly expiredAt: string
  /**
   * 쓴 장이 가리키는 주문의 **접근성 이름**. `{name}`
   *
   * 목록의 링크가 전부 「주문 보기」면 링크 목록을 훑는 사람에게 같은 이름이 스무 개
   * 남는다 (WCAG 2.4.4). 보이는 글자는 아래 {@link orderLinkText} 이고, 그것이 이
   * 문장 안에 그대로 들어 있어야 음성 제어가 같은 말로 이 링크를 누를 수 있다 (2.5.3).
   */
  readonly usedOrderLink: string
  /** 그 링크에 보이는 글자. 짧아야 카드가 좁은 화면에서 접히지 않는다. */
  readonly orderLinkText: string
  readonly claim: CouponClaimMessages
}

/**
 * 쿠폰 코드 등록 (F3).
 *
 * **입력이 너그럽다는 사실을 힌트가 말한다.** 서버가 하이픈·공백·소문자를 받아 주는데
 * (`normalizeCouponCode`) 화면이 그것을 말하지 않으면, 배너의 `NEW9V-2K4TR` 을 보고
 * 하이픈을 지워야 하나 망설이는 사람이 생긴다.
 */
export interface CouponClaimMessages {
  readonly title: string
  readonly description: string
  readonly codeLabel: string
  readonly codeHint: string
  readonly codePlaceholder: string
  readonly submit: string
  readonly submitting: string
  readonly submitError: string
  /** 받은 쿠폰의 이름을 싣는다. 「받았습니다」만으로는 무엇이 들어왔는지 모른다. `{name}` */
  readonly claimedNotice: string
  readonly errors: CouponClaimErrorMessages
}

/** 빈 상태 하나 — 제목과 그 아래 한 줄. */
export interface EmptyStateCopy {
  readonly title: string
  readonly body: string
}

export interface CouponClaimErrorMessages {
  readonly required: string
  /** 계약의 상한(`COUPON_CODE_INPUT_MAX_LENGTH`)을 넘겼다. `{max}` */
  readonly tooLong: string
}

/**
 * 적립금 내역 (TASK-0077 F4 · F5 · F6).
 *
 * **원장을 그대로 보여 준다.** 잔액만 보여 주는 화면은 「왜 줄었지」에 답할 수 없고,
 * 그 답이 줄마다 붙은 `balanceAfter` 다 (4장).
 *
 * **적립 예정이 이 화면의 요점이다** (F6). 적립은 구매확정 시점에 일어나므로 배송완료된
 * 주문은 아직 아무것도 적립하지 않았고, 그 사실을 말해 주지 않으면 사는 사람은 「샀는데
 * 왜 적립이 안 됐지」로 읽는다.
 */
export interface PointScreenMessages {
  readonly title: string
  readonly description: string
  readonly balanceLabel: string
  /** 적립 예정 (F6). */
  readonly pendingTitle: string
  readonly pendingBody: string
  /** 배송완료 몫이 하나도 없을 때. 0원을 크게 그리는 대신 이 문장을 쓴다. */
  readonly pendingNone: string
  /** 만료 예정. 서버가 판정해서 보내는 값이라 화면은 그리기만 한다. */
  readonly expiringTitle: string
  /** `{amount}` 이 `{date}` 에 사라진다. */
  readonly expiringBody: string
  readonly ledgerTitle: string
  readonly caption: string
  readonly loadingLabel: string
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly failedTitle: string
  readonly retryLabel: string
  readonly atColumn: string
  readonly typeColumn: string
  readonly amountColumn: string
  readonly balanceColumn: string
  readonly refColumn: string
  /**
   * 유형 다섯의 이름 (R1).
   *
   * `Record` 라 유형이 하나 늘면 `pnpm typecheck` 이 깨진다. 빠진 유형은 그 유형이
   * 처음 생긴 사람의 화면에서만 빈 칸으로 나타나고, 그 사람은 그것을 신고하지 않는다.
   */
  readonly types: Readonly<Record<PointTransactionType, string>>
  /** 주문을 가리키지 않는 줄. 링크가 없는 줄이지 잘못된 줄이 아니다. */
  readonly noRef: string
  /** 주문 링크의 접근성 이름 (F5). 표 안에 같은 이름의 링크가 여럿이라 필요하다. `{at}` */
  readonly orderLink: string
  /** 그 링크에 보이는 글자. 위 문장 안에 그대로 들어 있어야 한다 (WCAG 2.5.3). */
  readonly orderLinkText: string
  /** `{count}` — 지금까지 불러온 줄 수. */
  readonly countLabel: string
  readonly loadMore: string
  readonly loadingMore: string
  readonly loadMoreFailedTitle: string
}

/**
 * 마이페이지 머리의 두 숫자 (TASK-0077).
 *
 * **둘이 따로 실패한다.** 적립금을 못 읽었다고 쿠폰 수까지 감추면 사람은 자기 쿠폰이
 * 없어졌다고 읽는다 — 그래서 「지금은 불러오지 못했습니다」가 숫자 하나를 대신하는
 * 문장이지 화면 전체의 문장이 아니다.
 */
export interface AccountSummaryMessages {
  readonly title: string
  readonly pointsLabel: string
  readonly pointsLink: string
  /** 구매확정을 기다리는 몫. `{amount}` */
  readonly pendingLabel: string
  readonly couponsLabel: string
  readonly couponsLink: string
  /** `{count}` — 쓸 수 있는 장수. 만료·사용한 장은 세지 않는다. */
  readonly couponCount: string
  readonly loadingLabel: string
  /** 숫자 하나를 못 읽었을 때. 0을 그리면 그것은 거짓말이다. */
  readonly unavailable: string
}

/**
 * 주문 내역 목록 (TASK-0063).
 *
 * **필터 문구가 두 벌인 것이 중요하다.** 아무것도 안 산 사람에게 「조건에 맞는
 * 주문이 없습니다」라고 하면 그 사람은 조건을 찾아 헤매고, 조건을 걸어 둔 사람에게
 * 「주문한 적이 없습니다」라고 하면 화면이 거짓말을 한다. 그래서 빈 상태가 둘이다.
 *
 * 서버가 조건으로 거르게 된 뒤(TASK-0063 2장) **「더 있을 수 있습니다」는 사라졌다.**
 * 그 문장은 화면이 불러온 것 위에서만 거를 때 참이었다.
 */
export interface OrderHistoryMessages {
  readonly title: string
  readonly description: string
  readonly listLabel: string
  readonly loadingLabel: string
  /** 정말로 주문이 없다. */
  readonly emptyTitle: string
  readonly emptyBody: string
  readonly emptyAction: string
  /** 불러온 것 중에 조건에 맞는 것이 없다. 위와 다른 사실이다. */
  readonly filteredEmptyTitle: string
  readonly filteredEmptyBody: string
  readonly resetFilter: string
  readonly filterLegend: string
  readonly periodLabel: string
  readonly periods: Readonly<Record<OrderPeriod, string>>
  readonly statusLabel: string
  readonly statusFilters: Readonly<Record<OrderStatusFilter, string>>
  readonly statuses: OrderStatusMessages
  /**
   * `{count}` — 「12건」.
   *
   * **숫자가 하나다.** 서버가 조건으로 거른 뒤 페이지를 주므로 「조건에 든 것」과
   * 「불러온 것」이 같은 집합이고, 둘을 나란히 적으면 언제나 같은 값이 두 번 나온다.
   *
   * 여기 있던 「조건에 맞는 주문이 더 있을 수 있습니다」도 같은 이유로 사라졌다 —
   * 서버가 걸렀으므로 남은 장이 있으면 조건에 맞는 것이 **있는** 것이고, 그 말을
   * 하는 것은 「더 보기」다.
   */
  readonly countLabel: string
  readonly loadMore: string
  readonly loadingMore: string
  readonly loadMoreFailedTitle: string
  /** `{count}` */
  readonly itemCountLabel: string
  readonly orderNumberLabel: string
  readonly paidAmountLabel: string
  /** 카드 전체가 링크다. 이름은 주문번호를 싣는다. `{number}` */
  readonly detailLabel: string
}

/**
 * 주문 하나 (TASK-0063).
 *
 * **묶음이 이 화면의 주어다.** 라벨이 「판매자별 배송」인 것은 R1 의 대응이다 —
 * 주문번호는 하나이고 배송이 여럿이라는 사실을, 배지나 색이 아니라 **이름**으로
 * 말한다.
 */
export interface OrderDetailMessages {
  /** `{number}` */
  readonly title: string
  readonly backToList: string
  readonly loadingLabel: string
  readonly loadErrorTitle: string
  readonly orderedAtLabel: string
  readonly orderNumberLabel: string
  /** 묶음 목록의 이름. 「판매자별 배송」 */
  readonly bundlesLabel: string
  /**
   * 묶음이 둘 이상일 때 목록 위에 붙는 한 줄 (R1). `{count}`
   *
   * 하나뿐인 주문에는 나오지 않는다 — 나뉘지 않은 것을 두고 「나뉘어 배송됩니다」라고
   * 하면 그 문장이 소음이 되고, 진짜로 나뉜 주문에서 읽히지 않게 된다.
   */
  readonly splitNotice: string
  /** 묶음 하나의 이름. 버튼의 접근성 이름도 이것으로 만든다. `{brand}` */
  readonly bundleLabel: string
  readonly statuses: OrderStatusMessages
  readonly itemsLabel: string
  /** `{count}` */
  readonly quantityLabel: string
  /** 옵션이 없는 줄에 쓰는 말. 빈 문자열을 그대로 그리면 자리만 남는다. */
  readonly noOption: string
  readonly unitPriceLabel: string
  readonly tracking: OrderTrackingMessages
  readonly timeline: OrderTimelineMessages
  readonly confirm: OrderConfirmMessages
  readonly autoConfirm: OrderAutoConfirmMessages
  readonly afterConfirm: OrderAfterConfirmMessages
  readonly payment: OrderPaymentMessages
  readonly recipient: OrderRecipientMessages
  readonly repurchase: OrderRepurchaseMessages
  readonly upcoming: OrderUpcomingMessages
  /** 취소·반품으로 가는 자리 (TASK-0066). */
  readonly claim: OrderClaimEntryMessages
  /** 가능 액션을 못 읽었다. 「할 수 있는 것이 없다」와 다른 말이다. */
  readonly actionsFailed: string
  readonly actionsLoading: string
}

/**
 * 묶음 하나에서 취소·반품으로 가는 자리 (TASK-0066).
 *
 * **버튼이거나 문장이다.** 「지금 신청할 수 있는가」는 서버가 답하고
 * (`GET /seller-orders/:id/claimable`), 답이 `null` 이면 그 자리는 **왜 안 되는지**
 * 를 말한다 — 감추면 사람은 취소 버튼을 찾다가 포기하고, 「취소할 수 없습니다」로
 * 끝나면 기다리면 되는 사람과 고객센터를 찾아야 하는 사람이 구분되지 않는다.
 */
export interface OrderClaimEntryMessages {
  /** `{brand}` — 같은 이름의 링크가 묶음마다 있어서 브랜드로 가른다. */
  readonly cancel: string
  readonly returns: string
  readonly title: string
  /** 여섯 거절. `exceeds_remaining` 만 `{remaining}` 을 쓴다. */
  readonly refusals: Readonly<Record<ClaimRefusal, string>>
  readonly loading: string
  /** 물어보지 못했다. 「신청할 수 없다」와 다른 말이다. */
  readonly failed: string
}

/**
 * 취소·반품 신청 화면 (TASK-0066).
 *
 * **한 벌로 취소와 반품을 모두 말한다.** 요청의 모양이 같고(항목·수량·사유),
 * 다른 것은 부르는 이름과 승인 뒤에 무엇이 일어나는가뿐이다 — 유형별로 문구를
 * 통째로 나누면 같은 문장이 두 벌이 되고, 그 둘이 언젠가 다른 말을 한다.
 * 유형이 가르는 것만 {@link ClaimTypeMessages} 로 묶어 둔다.
 */
export interface ClaimRequestMessages {
  readonly types: Readonly<Record<ClaimType, ClaimTypeMessages>>
  /**
   * 신청할 수 없는 주문의 제목.
   *
   * 유형이 정해지지 않은 화면이라 「취소 신청」도 「반품 신청」도 거짓이다 —
   * 배송 중인 주문에 「반품 신청」이라고 써 두면, 거절 문장을 읽기 전에 이미
   * 틀린 것을 하나 배운 셈이 된다.
   */
  readonly refusedTitle: string
  readonly backToOrder: string
  readonly loadingLabel: string
  readonly loadErrorTitle: string
  /**
   * 어느 묶음인지 주소가 말하지 않을 때.
   *
   * 주소를 손으로 친 사람만 닿는 자리다 — 화면에서 오는 길은 언제나 묶음을
   * 들고 온다. 「잘못된 접근입니다」 대신 **돌아갈 곳**을 준다.
   */
  readonly missingBundleTitle: string
  readonly missingBundleBody: string
  readonly itemsLabel: string
  readonly quantityLabel: string
  /** `{count}` — 서버가 답한 잔여. 화면이 빼서 계산하지 않는다. */
  readonly remainingLabel: string
  /** 잔여가 0인 줄. 고를 수 없는 이유를 말한다. */
  readonly alreadyClaimed: string
  readonly selectLabel: string
  readonly reasonLabel: string
  readonly reasonHint: string
  readonly reasonPlaceholder: string
  /** 취소 경로에서만 그려진다. 반품의 귀책은 사람이 고르지 않는다. */
  readonly faultLegend: string
  readonly faults: Readonly<Record<ClaimFault, ToggleCopy>>
  /**
   * 반품 경로에서만 그려진다 (TASK-0067).
   *
   * **귀책 둘이 아니라 사유 셋을 묻는다.** 하자와 오배송은 돈에서만 같고(둘 다
   * 판매자 부담) 사람이 겪은 일은 다르다 — 그 차이가 분쟁에서 다투는 것이라
   * `SELLER` 한 값으로 접으면 자유 서술에만 남는다 (`returnReasons`).
   */
  readonly returnReasonLegend: string
  readonly returnReasons: Readonly<Record<ReturnReason, ToggleCopy>>
  readonly photos: ClaimPhotoMessages
  readonly submit: string
  readonly submitting: string
  readonly submitErrorTitle: string
  /** 보내기 전에 걸리는 것들. 서버 규칙이 아니라 **요청이 되기 전의** 것이다. */
  readonly issues: Readonly<Record<ClaimDraftIssue, string>>
  /** 여섯 거절, 신청을 보낸 뒤에 받았을 때. 자리가 다를 뿐 같은 문장이다. */
  readonly refusals: Readonly<Record<ClaimRefusal, string>>
  readonly outcome: ClaimOutcomeMessages
}

/**
 * 하자 반품의 증거 사진 (TASK-0067 F2).
 *
 * **하자·오배송 사유에서만 그려진다.** 단순 변심에는 뒤집을 것이 없어 증거를 받을
 * 이유가 없고, 받아 두면 아무도 보지 않는 이미지와 지우지 못하는 개인정보만 쌓인다.
 */
export interface ClaimPhotoMessages {
  readonly legend: string
  /** 파일을 고르는 자리의 이름. 끌어다 놓는 것도 같은 자리다. */
  readonly dropLabel: string
  readonly droppingLabel: string
  /** `{max}` — 계약이 정한 장수의 상한. */
  readonly hint: string
  readonly listLabel: string
  readonly remove: string
  /**
   * `{name}` — 같은 글자의 버튼이 다섯 개 있는 목록에서 **위치는 눈에만 보인다.**
   * 그래서 보이는 글자는 짧게 두고 접근 가능한 이름에 파일 이름을 넣는다 (P4).
   */
  readonly removeNamed: string
  readonly statuses: Readonly<Record<ReturnPhotoStatus, string>>
  /**
   * 왜 못 올렸는가.
   *
   * 넷을 나누는 기준은 **사람이 할 일이 다른가**다 — 형식과 크기는 다른 파일을
   * 고르는 일이고, 장수는 하나를 빼는 일이며, 마지막 둘은 다시 시도하는 일이다.
   *
   * `too_many` 만 `{max}` 를 갖는다. 계약의 상한을 화면이 숫자로 적어 두면 그 값이
   * 바뀌는 날 둘이 갈리고, 갈린 쪽은 **화면**이라 아무 검사도 실패하지 않는다.
   */
  readonly failures: Readonly<Record<ClaimPhotoFailureKey, string>>
}

export type ClaimPhotoFailureKey =
  | ReturnPhotoRejection
  /** presign 이 거절했다. 서버 문장이 이유를 말한다 */
  | 'api'
  /** 버킷이 거절했다. 봉투가 없으므로 우리가 할 말을 정한다 */
  | 'storage'

/** 유형이 가르는 것 — 부르는 이름과, 신청 전에 알려야 할 한 문장. */
export interface ClaimTypeMessages {
  readonly title: string
  readonly description: string
  /** 반품에만 값이 있다. `{date}` — 서버가 계산해 보낸 기간의 끝이다. */
  readonly windowNotice: string | null
}

/**
 * 신청이 접수된 뒤 (F1 · F4).
 *
 * **자동 승인과 승인 대기를 다르게 말한다.** 둘 다 「접수됐습니다」로 끝내면
 * 자동 승인된 사람은 오지 않을 연락을 기다리고, 승인 대기인 사람은 이미 끝난
 * 줄 안다.
 */
export interface ClaimOutcomeMessages {
  readonly title: string
  readonly approvedTitle: string
  readonly approvedBody: string
  readonly waitingTitle: string
  readonly waitingBody: string
  /** 환불과 재고는 아직 이 TASK 가 하지 않는다 (TASK-0068 · 0069). */
  readonly refundPending: string
  readonly backToOrder: string
}

/**
 * 배송 추적 (TASK-0061 의 컴포넌트가 읽는다).
 *
 * `ShipmentTrackingLabels` 를 그대로 넓힌다 — 그 컴포넌트가 요구하는 문구는 하나도
 * 빠질 수 없고(빠지면 컴파일이 멈춘다), 이 화면이 더하는 것은 열고 닫는 버튼의
 * 글자뿐이다. `copyTrackingNumber` 도 계약상 필수라 값을 채우되, 구매자 화면은
 * `onCopyTrackingNumber` 를 넘기지 않으므로 버튼이 그려지지 않는다.
 */
export interface OrderTrackingMessages extends ShipmentTrackingLabels {
  /** `{brand}` — 같은 이름의 버튼이 묶음마다 있어서 브랜드로 가른다. */
  readonly open: string
  readonly close: string
}

/**
 * 주문 상태 타임라인 (TASK-0063).
 *
 * **칸은 사다리이고 시각은 이력이다** (`order-stages.ts`). 그래서 칸 이름은 「어디까지
 * 왔다」로 쓰고, 아직 오지 않은 칸도 이름을 갖는다 — 이력만 늘어놓는 화면이었다면
 * 준비중인 주문에는 배송이 남았다는 사실이 어디에도 없다.
 */
export interface OrderTimelineMessages {
  readonly label: string
  readonly stages: Readonly<Record<OrderStage, string>>
  /** 칸의 자리를 말로. 색 대신 정보를 나르는 쪽이다 (WCAG 1.4.1). */
  readonly stageState: Readonly<Record<OrderStageState, string>>
  /**
   * 사다리를 벗어난 상태의 한 문장. `{status}`
   *
   * 취소된 주문에 회색 사다리를 남겨 두면 화면이 아직 그리로 갈 것처럼 말한다.
   */
  readonly offLadder: string
  /**
   * 시각을 모르는 칸에 붙는 말.
   *
   * **비워 두지 않는다.** 빈칸은 「없었다」로도 「모른다」로도 읽히고, 이 화면이
   * 말해야 하는 것은 뒤쪽이다.
   *
   * 묶음이 이력을 함께 싣게 된 뒤로 이 문구가 붙는 칸은 줄었지만 없어지지는
   * 않았다 — 이력에 그 줄이 없으면 여전히 모르는 것이고(상태 이력이 쌓이기 전의
   * 주문이 그렇다), 모르는 것을 지어내지 않는 자리가 여기다.
   */
  readonly unknownAt: string
}

/**
 * 구매확정 (TASK-0063 · `state-machines.md` 1장).
 *
 * **이 화면에서 가장 무거운 버튼이다.** 정산과 적립금 지급의 방아쇠이고 되돌릴 수
 * 없다. 그래서 문구가 셋으로 나뉜다 — 무엇인지(`description`), 무엇이 일어나는지
 * (`consequences`), 되돌릴 수 없다는 것(`irreversible`). 한 문단으로 뭉치면 사람은
 * 그것을 안 읽는다.
 */
export interface OrderConfirmMessages {
  /** 버튼의 글자. `{brand}` 가 붙은 접근성 이름은 화면이 만든다. */
  readonly action: string
  readonly busy: string
  readonly title: string
  readonly description: string
  readonly consequences: string
  readonly irreversible: string
  /**
   * 자동 확정이 있다는 사실 (TASK-0064). 서두를 이유가 없음을 말한다. `{date}`
   *
   * 시각이지 기간이 아니다. 「배송완료 7일 뒤」는 압축된 배포에서 거짓이 되고,
   * 그 배포가 곧 이 데모다.
   */
  readonly automatic: string
  /** 예정 시각을 모를 때 대신 말하는 한 줄. 날짜를 지어내지 않는다. */
  readonly automaticUnknown: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly closeLabel: string
  /** `{brand}` */
  readonly done: string
  /** 이미 확정돼 있었다 — 서버가 `changed: false` 로 답한 경우. `{brand}` */
  readonly alreadyDone: string
  readonly failedTitle: string
}

/**
 * 자동 구매확정 예정 안내 (TASK-0064 F8).
 *
 * **문장이 셋인 것이 이 안내의 전부다.** 날짜 하나만 적으면 데모에서 그 날짜가
 * 틀리고(시간이 압축돼 그보다 빨리 확정된다), 규칙만 적으면 「그래서 내 주문은
 * 언제인가」에 답하지 못한다. 그래서 **예정일 · 규칙 · 데모라는 사실**을 나눠
 * 적는다 — 어느 것도 다른 것의 자리를 대신하지 못한다.
 *
 * 화면이 이 날짜를 어떻게 얻는지, 그리고 왜 서버가 보내 주지 않는지는
 * `lib/orders/auto-confirm.ts` 에 적혀 있다.
 */
export interface OrderAutoConfirmMessages {
  readonly title: string
  /** `{date}` — 실제 서비스 기준의 예정 시각. */
  readonly dueAt: string
  /**
   * `{days}` — 실제 서비스의 규칙.
   *
   * **위의 날짜와 나란히 있는 것이 이 문장의 일이다.** 화면은
   * `FULFILLMENT_PACE` 를 읽을 수 없어 「지금은 압축된 시간입니다」라고 단언할 수
   * 없고, 단언하면 압축하지 않는 배포에서 거짓이 된다. 대신 실제 시각과 규칙을
   * 함께 두면 둘의 차이가 그 사실을 말한다.
   */
  readonly rule: string
  /** 배송완료 시각을 모르는 묶음에 붙는 말. 날짜를 지어내지 않는다. */
  readonly unknownAt: string
}

/**
 * 확정된 뒤의 안내 (TASK-0064 F5).
 *
 * **버튼이 사라진 자리에 문장이 선다.** 확정은 종착 상태라
 * (`seller-order-transitions.ts` 의 `CONFIRMED: []`) 서버가 답하는 액션 목록이 비고,
 * 화면은 아무것도 그리지 않는다 — 그것만으로는 「왜 반품 신청이 없나」에 답하지
 * 못한다. 규칙을 새로 만드는 것이 아니라 **이미 닫혀 있는 것을 말하는** 자리다.
 */
export interface OrderAfterConfirmMessages {
  readonly title: string
  readonly noReturn: string
}

/**
 * 결제 정보 (TASK-0063 2장).
 *
 * **수단이 없다.** `GET /orders/:id` 의 응답에 결제수단도 결제 id 도 없고, 주문에서
 * 결제로 가는 길이 계약에 아예 없다 (TASK-0063 — 보고된 빈자리). 그래서 이 화면은
 * 금액과 할인만 말하고, 「어떤 카드로 냈나」는 그 답을 실제로 갖고 있는 화면으로
 * 보낸다 — 없는 것을 지어내는 대신 있는 곳을 가리킨다.
 */
export interface OrderPaymentMessages {
  readonly title: string
  readonly productAmount: string
  readonly couponDiscount: string
  readonly pointDiscount: string
  readonly shippingFee: string
  /** 배송비를 낸 적립금. 항목에 안분되지 않는 몫이라 줄이 따로 있다 (TASK-0047). */
  readonly shippingPoint: string
  readonly paidAmount: string
  /** 결제수단이 응답에 없다는 사실과, 그것을 확인할 수 있는 곳. */
  readonly methodHint: string
  readonly methodLink: string
}

export interface OrderRecipientMessages {
  readonly title: string
  readonly name: string
  readonly phone: string
  readonly address: string
}

/** 재구매 (F7). 담긴 것과 못 담은 것을 **둘 다** 말한다. */
export interface OrderRepurchaseMessages {
  /** `{brand}` 가 붙은 접근성 이름은 화면이 만든다. */
  readonly action: string
  readonly busy: string
  /** `{count}` */
  readonly added: string
  /** `{count}` · `{names}` — 일부만 담겼다. */
  readonly partial: string
  /** `{names}` — 하나도 못 담았다. */
  readonly none: string
  readonly cartLink: string
}

/**
 * 아직 없는 화면으로 가는 자리 (M10 · M13).
 *
 * **링크도 비활성 버튼도 아니다.** 이 저장소는 껍데기 라우트를 없애면서
 * (`pages.md`) 「죽은 링크나 비활성 컨트롤 대신 무엇이 언제 열리는지 말한다」로
 * 갔다. 그래서 여기 있는 것은 목적지가 아니라 **문장**이고, 그 화면을 만드는
 * TASK 번호가 컴포넌트의 주석에 적혀 있어 그 TASK 가 닫힐 때 `grep` 으로 찾힌다.
 */
export interface OrderUpcomingMessages {
  readonly reviewTitle: string
  readonly reviewBody: string
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
  /**
   * 적용된 쿠폰 한 줄 (TASK-0075). `{amount}` — 그 장이 **실제로** 깎은 금액.
   *
   * 합계의 「할인」과 따로 그리는 이유는 계약이 `appliedCoupons` 를 장별로 싣는
   * 이유와 같다: 두 장이 같은 항목을 겹쳐 덮으면 뒤엣것은 남은 금액까지만 깎이고,
   * 그 사정이 드러나는 자리가 여기뿐이다.
   */
  readonly appliedCouponAmount: string
  /** 쿠폰 영역 (TASK-0075). 4.5 가 자리만 두라던 그 자리에 실제 쿠폰이 들어왔다. */
  readonly coupon: CheckoutCouponMessages
  /**
   * 결제수단 (TASK-0054). 4.5 가 자리만 두라고 한 그 자리에 실제 결제가 들어왔다.
   *
   * 주문서 안의 한 영역이므로 여기 아래 산다 — 결제 화면이 따로 생기는 것이 아니라
   * 주문서가 결제까지 한다.
   */
  readonly payment: PaymentMessages
  /**
   * 토스 결제창이 돌아오는 두 화면 (TASK-0055).
   *
   * `payment` 아래가 아니라 옆인 이유는 **다른 라우트이기 때문**이다. 위의 것은
   * 주문서 안의 한 영역이 읽고, 이 둘은 `checkout/toss/*` 가 읽는다 — 주문서를
   * 떠났다가 돌아온 사람이 보는 화면이라 주문서의 문장을 다시 쓸 수 없다.
   */
  readonly tossSuccess: TossSuccessMessages
  readonly tossFailure: TossFailureMessages
  readonly termsLabel: string
  readonly placeOrder: string
  readonly placing: string
  /**
   * 주문을 만들지 못했다 — 이유마다 한 문장 (TASK-0075).
   *
   * `Record<OrderRefusal, …>` 이라 이유가 하나 늘면 **컴파일이 막는다.** 쿠폰이
   * 태워진 사람과 주문서가 만료된 사람에게 같은 문장을 보이면, 앞의 사람은 한 장만
   * 빼면 될 일을 장바구니부터 다시 한다.
   */
  readonly placeFailures: Readonly<Record<OrderRefusal, string>>
  /** 배송지를 안 골랐을 때 주문 버튼 아래에 나오는 이유. */
  readonly recipientRequired: string
  readonly termsRequired: string
  /**
   * 쿠폰을 반영한 금액을 기다리는 중이라 아직 주문할 수 없다 (TASK-0075).
   *
   * 이 잠금이 계약을 지킨다 — 주문에 실리는 선택은 **화면이 보여 준 금액을 만든
   * 그 선택**이어야 하고, 다시 읽는 중에는 그 둘이 같다고 말할 수 없다.
   */
  readonly couponRepricing: string
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
 * 쿠폰 적용 (TASK-0075).
 *
 * **`faults` 의 키가 계약의 유니온이다.** 거절 사유가 하나 늘면 여기가 비는 것이
 * 아니라 `pnpm typecheck` 이 깨진다 — 계약이 여섯으로 나눈 이유가 사람이 할 일이
 * 여섯 가지로 다르기 때문인데, 문장이 하나 빠지면 그중 한 사람은 자기 쿠폰이 왜
 * 회색인지 듣지 못한 채 화면을 떠난다.
 *
 * **거절(`refusals`)은 그것과 다른 종류다.** 위의 것은 목록을 읽는 순간 이미
 * 알려진 사실이고, 이것은 **고른 뒤에 서버가 알려 준 사실**이다 — 화면에서
 * 나타나는 자리도 다르다.
 */
export interface CheckoutCouponMessages {
  readonly title: string
  readonly loading: string
  /** 쿠폰함을 못 읽었다. 주문서는 그대로이므로 문장 하나로 끝난다. */
  readonly failed: string
  /** 한 장도 없는 사람. 「불러오지 못했다」와 다른 말이어야 한다. */
  readonly none: string
  /** 체크박스 묶음의 이름. 화면에는 없고 접근성 트리에만 있다. */
  readonly choose: string
  /** 이 장 하나만 썼을 때 깎이는 금액. `{amount}` */
  readonly discount: string
  /** 언제까지 쓸 수 있나. `{date}` */
  readonly expiresAt: string
  /** 못 쓰는 쿠폰들 앞에 붙는 줄. 숨기지 않는다는 것이 계약이다 (F2). */
  readonly unusableTitle: string
  /** 못 쓰는 이유, 여섯 가지 전부. 빠지면 타입 검사가 잡는다. */
  readonly faults: Readonly<Record<CouponApplicabilityFault, string>>
  /** 최대 할인 조합을 그대로 고르는 버튼 (F7). */
  readonly recommend: string
  /** 그 조합이 얼마를 깎는지. `{amount}` */
  readonly recommendAmount: string
  /** 지금 적용된 쿠폰의 수와 합계. `{count}` · `{amount}` */
  readonly applied: string
  /** 고른 것으로 금액을 다시 매기는 중. 화면은 그대로 있고 이 줄만 바뀐다. */
  readonly repricing: string
  /**
   * 서버가 고른 조합을 받아 주지 않아 선택을 되돌렸을 때 (400).
   *
   * 같은 사건의 다른 쪽 끝 — 주문하는 순간의 409 — 은 주문 버튼 아래
   * (`placeFailures.coupon_already_used`)에서 말한다. 문장을 두 곳에 두는 것은
   * **읽는 사람이 보고 있는 것이 다르기** 때문이다: 여기서는 쿠폰 목록을 보고
   * 있고, 저기서는 방금 누른 주문 버튼을 보고 있다.
   */
  readonly rejected: string
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
  /**
   * 라디오 그룹의 이름. 화면에는 없고 접근성 트리에만 있다.
   *
   * 「카드 선택」이 아니라 「결제수단 선택」이다 (TASK-0055 4.6 과 같은 이유) —
   * 두 번째 프로바이더가 목록에 들어온 순간 앞의 이름은 거짓이 된다.
   */
  readonly chooseMethod: string
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
  /** 결제수단을 안 골랐을 때 주문 버튼 아래에 나오는 이유. */
  readonly methodRequired: string
  /** 지금 무엇을 하는 중인가. 걸음마다 하나씩. */
  readonly progress: Readonly<Record<PaymentStep, string>>
  /** 끝나지 못한 이유. `exceeds_credit` 은 모자란 금액 `{amount}` 를 받는다. */
  readonly refusals: Readonly<Record<PaymentRefusal, string>>
  /** 실패해도 예약은 유지된다 (4.3). **다시 결제할 수 있는** 실패에 붙는다. */
  readonly holdKept: string
  /**
   * 「확인 중」에 붙는 한 문장 (TASK-0057 F5 · D-220).
   *
   * **{@link holdKept} 와 나눈 것은 뒤 절반이 정반대이기 때문이다.** 저쪽은 「카드를
   * 바꿔 다시 결제할 수 있어요」로 끝나는데, 결과를 확인하는 중인 주문에서 다시
   * 결제하는 것은 정확히 하지 말아야 할 일이다 — 문장 하나로 붙여 두면 화면은 재고가
   * 남아 있다는 참말과 다시 결제하라는 거짓말을 함께 하게 된다.
   *
   * 그래서 이 문장이 답할 것은 셋이다: **얼마나 기다리는가**(대사가 1분마다 돈다),
   * **그동안 재고는 어떻게 되는가**(그대로다), **그다음 무엇을 하는가**(새로고침).
   * 버튼을 주지 않는 화면일수록 다음 행동을 문장이 말해야 한다.
   */
  readonly awaitingHoldKept: string
  readonly retry: string
  readonly paidTitle: string
  readonly paidBody: string
  /** 토스 선택지와 그 아래 안내 (TASK-0055 4.5 · F7). */
  readonly toss: TossOptionMessages
}

/**
 * 결제수단 목록의 토스 한 줄 (TASK-0055).
 *
 * **키가 없으면 이 문장들은 한 번도 그려지지 않는다** (4.1). 그래도 카탈로그에
 * 있는 이유는 문구가 설정에 따라 있다 없다 하면 안 되기 때문이다 — 키를 넣는
 * 사람이 문구까지 쓰게 되는 순간, 그 문구는 아무도 검토하지 않은 것이 된다.
 */
export interface TossOptionMessages {
  /** 결제수단 목록에 뜨는 이름. */
  readonly label: string
  /**
   * 고른 사람에게만 보이는 안내 (F7 · 4.7).
   *
   * **카드번호가 없다.** 토스페이먼츠는 테스트용 국내 카드번호를 주지 않고, 대신
   * 테스트 환경에서는 실제 카드 정보를 넣어도 가상으로만 승인된다 — 적을 수 있는
   * 번호가 애초에 없으므로 안내는 그 사실과 문서 링크다.
   */
  readonly noticeTitle: string
  readonly noticeBody: string
  readonly noticeAction: string
  /** 결제창으로 넘어가는 중. **완료가 아니라 넘어감이다** (4.2). */
  readonly leaving: string
  /** 결제창에 뜨는 주문 이름. `{name}` */
  readonly orderNameSingle: string
  /** 여러 건일 때. `{name}` · `{count}` */
  readonly orderNameMore: string
}

/**
 * 결제창이 성공으로 돌아온 화면 (TASK-0055 4.2).
 *
 * **`failures` 의 키가 유니온이다.** 승인이 끝나지 못하는 경우가 하나 늘면 여기가
 * 비는 것이 아니라 `pnpm typecheck` 이 깨진다 — 결제 도중에 아무 말도 못 듣는 것이
 * 가장 나쁜 실패이고, 하필 그 자리가 돈이 오간 뒤다.
 *
 * **`awaiting_result` 의 문장은 주문서의 것과 같은 사실을 말하되 끝이 다르다**
 * (TASK-0057 F5). 다시 결제하지 말 것 · 1분마다 자동 확인 · 늦어도 2분 · 재고는
 * 그대로 — 여기까지는 같다. 다른 것은 **사람이 서 있는 자리**다: 주문서에 있는
 * 사람에게는 「잠시 뒤 새로고침」이 다음 행동이지만, 이 화면을 새로고침하면 승인이
 * 다시 걸려 409 로 끝난다. 그래서 이쪽의 다음 행동은 주문 내역이다.
 */
export interface TossSuccessMessages {
  readonly title: string
  /** 승인을 기다리는 중. 결제창의 성공은 아직 승인이 아니다. */
  readonly confirming: string
  readonly capturing: string
  readonly doneTitle: string
  readonly doneBody: string
  readonly failedTitle: string
  /**
   * 「확인 중」의 제목 (TASK-0057 F5 · D-220).
   *
   * **{@link failedTitle} 을 쓰지 않는다.** 「결제를 마치지 못했어요」는 끝난 일을
   * 가리키는데 이 결제는 끝나지 않았고, 실패로 읽은 사람이 다음에 하는 일이 정확히
   * 우리가 막으려는 것(다시 결제)이다. 실패 주소가 「창을 닫은 것」에 다른 제목을
   * 주는 것과 같은 판단이다 ({@link TossFailureMessages.titles}).
   */
  readonly awaitingTitle: string
  readonly failures: Readonly<Record<TossConfirmFailure, string>>
  /** 다시 결제하러 주문서로. 그럴 수 있는 실패에만 나온다 (`offersRetry`). */
  readonly backToCheckout: string
  readonly backHome: string
}

/**
 * 결제창이 실패로 돌아온 화면 (TASK-0055 F3).
 *
 * 두 갈래의 키가 유니온인 이유는 위와 같다. **창을 닫은 것은 사고가 아니므로**
 * 같은 문장을 쓰지 않는다 — 마음이 바뀐 사람에게 「실패했어요」라고 말하면 우리
 * 쪽이 고장 난 것처럼 들린다.
 */
export interface TossFailureMessages {
  readonly title: string
  readonly titles: Readonly<Record<TossFailureKind, string>>
  readonly bodies: Readonly<Record<TossFailureKind, string>>
  /** 주문도 예약도 그대로다 (F3). 어느 갈래에나 같이 붙는 한 문장이다. */
  readonly holdKept: string
  readonly backToCheckout: string
  /** 주문서 id 를 모를 때. 장바구니에서 다시 시작할 수 있다. */
  readonly backToCart: string
}
