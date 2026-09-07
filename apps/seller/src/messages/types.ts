import type {
  ApiFailureReason,
  ClaimFault,
  CouponDiscountType,
  CouponLifecycle,
  ClaimHandlingStage,
  ClaimStatus,
  ClaimType,
  DemoCarrierCode,
  DenialReason,
  ErrorMessages,
  HealthStatus,
  OauthFailureReason,
  OauthNotice,
  OrderActor,
  OrderStatus,
  ProductStatus,
  ReturnReason,
  SellerOrderRequirement,
  SellerStatus,
  SellerStockAdjustType,
  SellerStockFilter,
  SettlementItemType,
  SettlementStatus,
  StockLedgerType,
  TrackingEventKind,
} from '@shopping/shared'
import type { ImageUploadListLabels, ShipmentTrackingLabels } from '@shopping/ui/components'
import type { ConsoleMenu, ConsoleShellLabels } from '@shopping/ui/console'
import type { ComponentGalleryMessages } from '@shopping/ui/preview'

import type { SellerClaimTab } from '@/lib/claims/claim-console'
import type { CouponLiabilityUnbounded, SellerCouponScopeType } from '@/lib/coupons/coupon-console'
import type { CouponFieldErrorMessages } from '@/lib/coupons/coupon-form'
import type { SellerOrderTab } from '@/lib/orders/order-console'
import type { ReplyFieldErrorMessages, ReplyRefusal } from '@/lib/reviews/review-console'
import type { CalculationLineKey } from '@/lib/settlements/settlement-console'
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
  /**
   * 취소·반품 처리 목록 (TASK-0070). 단계 탭 · 유형·상태 필터 · 처리 기한.
   */
  readonly claimList: ClaimListMessages
  /** 클레임 하나 — 항목 · 사진 · 환불 예정액 · 귀책 · 기한 · 이력, 그리고 걸음들. */
  readonly claimDetail: ClaimDetailMessages
  /**
   * 상태 · 유형 · 귀책 · 반품 사유 · 단계의 이름.
   *
   * 화면의 어휘가 아니라 **클레임의** 어휘라 두 화면이 나눠 쓴다 — `orders` 가 같은
   * 이유로 목록과 상세 밖에 있다. 두 벌을 두면 목록에서는 「회수 중」이고 상세에서는
   * 「수거 중」인 날이 온다.
   */
  readonly claims: ClaimVocabularyMessages
  /**
   * 판매자 쿠폰 목록 (TASK-0074). 상태 필터 · 부담 누계 · 발행 중단 · 정산 연결.
   */
  readonly couponList: CouponListMessages
  /** 쿠폰 발행 폼 — 부담 경고와 예상 부담액이 그 안에 있다. */
  readonly couponForm: CouponFormMessages
  /**
   * 상태 · 할인 방식 · 범위의 이름.
   *
   * 화면의 어휘가 아니라 **쿠폰의** 어휘라 목록과 폼이 나눠 쓴다 — `claims` 가 같은
   * 이유로 목록과 상세 밖에 있다. 두 벌을 두면 목록에서는 「발행 중단」이고 폼에서는
   * 「중단됨」인 날이 온다.
   */
  readonly coupons: CouponVocabularyMessages
  /**
   * 매출 대시보드 (TASK-0082). 기간 필터 · 추이 차트 · 전 기간 대비 · 인기 상품.
   *
   * `/` 의 슬라이스다. 사이드바의 「대시보드」가 가리키는 곳이고, `pages.md` 2장이
   * 그 화면에 매출 추이를 배정해 두었다.
   */
  readonly revenue: RevenueDashboardMessages
  /**
   * 정산 내역 목록 (TASK-0082). 정산 예정 금액 · 회차 목록.
   */
  readonly settlementList: SettlementListMessages
  /** 정산서 한 장 — 계산 근거 다섯 줄과 항목들. */
  readonly settlementDetail: SettlementDetailMessages
  /**
   * 상태와 항목 종류의 이름.
   *
   * 화면의 어휘가 아니라 **정산의** 어휘라 목록과 상세가 나눠 쓴다 — `coupons` 가
   * 같은 이유로 목록과 폼 밖에 있다. 두 벌을 두면 목록에서는 「지급 완료」이고
   * 상세에서는 「지급됨」인 날이 온다.
   */
  readonly settlements: SettlementVocabularyMessages
  /**
   * 상품 리뷰 관리 (TASK-0085). 미답변 우선 목록 · 평점 필터 · 답변 쓰기.
   *
   * **`sellers` 의 「판매자 리뷰」와 다른 것이다.** 저쪽은 입점 심사 대기열이고
   * (`SELLER_REVIEW_LIST_*`), 이쪽은 판매자가 자기 상품에 달린 구매자 리뷰에
   * 답하는 화면이다. 이름을 길게 쓰는 이유가 그것이다 — 짧게 두면 두 화면이 같은
   * 낱말을 서로 다른 뜻으로 쓰게 된다.
   */
  readonly reviewList: ReviewListMessages
}

/* ------------------------------------------- 매출 대시보드 (TASK-0082) -- */

/**
 * `/` 가 그리는 모든 것.
 *
 * 차트(`chart`)가 자기 슬라이스인 것이 F5 의 답이다: 그림은 `aria-hidden` 이고
 * **같은 숫자의 표가 진짜 내용**이므로, 표의 머리글과 설명이 그림의 장식 문구와
 * 같은 무게로 여기 서 있어야 한다.
 */
export interface RevenueDashboardMessages {
  readonly description: string
  readonly loadingLabel: string
  readonly filters: RevenueFilterMessages
  readonly totals: RevenueTotalsMessages
  readonly comparison: RevenueComparisonMessages
  readonly chart: RevenueChartMessages
  readonly topProducts: RevenueTopProductMessages
  /**
   * `DataList` 가 요구하는 네 번째 상태.
   *
   * 계약이 **기간 안의 모든 날을 채워 보내므로** 실제로는 닿지 않는다 — 판매가 없던
   * 날도 0으로 온다. 그래도 값을 두는 것은 `DataList` 가 빈 상태를 **필수 prop 으로**
   * 강제하기 때문이고(그 컴포넌트의 판단이다), 「빠뜨린 빈 상태가 완성된 것처럼
   * 보이는 일」을 막는 장치가 그것이다. `claim-detail-workspace.tsx` 도 같은 이유로
   * 같은 자리를 채운다.
   */
  readonly empty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  /** 스토어가 없는 계정이 대시보드에 왔다. 매출을 **묻지도 않는다**. */
  readonly noStore: StoreAbsentMessages
}

export interface RevenueFilterMessages {
  readonly legend: string
  readonly fromLabel: string
  readonly toLabel: string
  readonly reset: string
  /** 끝이 시작보다 앞이다. 서버에 보내지 않고 이 자리에서 말한다. */
  readonly rangeReversed: string
  /** 계약의 상한을 넘겼다. 400 을 받아 「알 수 없는 오류」로 옮기지 않는다. */
  readonly rangeTooLong: string
}

/** 큰 숫자 셋. 「얼마 팔았나 · 몇 건인가 · 한 건에 얼마인가」. */
export interface RevenueTotalsMessages {
  readonly regionLabel: string
  readonly salesLabel: string
  readonly orderCountLabel: string
  readonly averageLabel: string
  /** `{count}` — 건수에는 통화 기호가 붙지 않는다. */
  readonly orderCountValue: string
}

/**
 * 전 기간 대비 (F6).
 *
 * **`none` 이 이 슬라이스의 핵심이다.** 지난 기간 매출이 0원이면 증감률은 큰 수가
 * 아니라 **없는 수**이고, 화면은 숫자 대신 그 사실을 말한다 — `+∞%` 도 `+100%` 도
 * 둘 다 거짓말이다.
 */
export interface RevenueComparisonMessages {
  readonly title: string
  /** `{amount}` — 비교의 분모가 된 지난 기간 매출. 숫자를 숨기지 않는다. */
  readonly previous: string
  /** `{percent}` — 늘었다. */
  readonly up: string
  /** `{percent}` — 줄었다. */
  readonly down: string
  readonly flat: string
  /** 지난 기간에 판 것이 없다. 비율 대신 이 문장이 선다. */
  readonly none: string
  /** 비교 대상이 **바로 앞의 같은 길이 기간**이라는 사실. 서버가 정한다. */
  readonly note: string
}

/**
 * 매출 추이 (F5).
 *
 * `caption` 과 `tableCaption` 이 둘 다 있는 이유가 F5 다. 그림은 장식이라 접근성
 * 트리에서 빠지고, **표가 그 자리를 대신한다** — 그래서 표에는 자기 이름이 필요하다.
 * `<svg>` 에 `aria-label` 하나를 붙여 때우지 않는다: 그것은 30일치 숫자를 「매출
 * 추이 차트」 한 마디로 요약해 버리는 일이고, 요약은 대체물이 아니다.
 */
export interface RevenueChartMessages {
  readonly title: string
  /** 그림 아래에 늘 보이는 한 줄. 표를 여는 버튼이 무엇인지 말한다. */
  readonly caption: string
  /** `{amount}` — 이 기간에 가장 많이 판 날의 금액. y축 꼭대기다. */
  readonly peak: string
  readonly showTable: string
  readonly hideTable: string
  readonly tableCaption: string
  readonly dateHeader: string
  readonly salesHeader: string
  readonly orderCountHeader: string
  /** 기간 안에 하루도 없다. 계약이 최소 개수를 걸지 않으므로 있을 수 있는 답이다. */
  readonly empty: string
}

/** 인기 상품 다섯 줄. */
export interface RevenueTopProductMessages {
  readonly title: string
  readonly caption: string
  readonly rankHeader: string
  readonly nameHeader: string
  readonly quantityHeader: string
  readonly salesHeader: string
  /** `{count}` — 수량. 금액이 아니므로 통화 기호가 없다. */
  readonly quantityValue: string
  readonly empty: string
  /** 몇 개까지 보여 주는지. 「전체」로 읽히지 않게 한다. */
  readonly note: string
}

/* --------------------------------------------- 정산 (TASK-0082) -- */

export interface SettlementVocabularyMessages {
  readonly statusLabels: Readonly<Record<SettlementStatus, string>>
  readonly itemTypeLabels: Readonly<Record<SettlementItemType, string>>
}

/**
 * `/settlements` 가 그리는 모든 것.
 *
 * 예정액(`outlook`)이 목록의 슬라이스인 것은 두 값이 한 화면의 위아래에 있기
 * 때문이다. 「언제 얼마가 들어오나」에 답하려면 **아직 정산서가 아닌 돈**과 **이미
 * 정산서가 된 돈**이 같은 화면에 있어야 한다.
 */
export interface SettlementListMessages {
  readonly description: string
  readonly loadingLabel: string
  readonly outlook: SettlementOutlookMessages
  readonly filters: SettlementFilterMessages
  readonly table: SettlementTableMessages
  readonly totals: SettlementTotalsMessages
  readonly pagination: PaginationMessages
  readonly empty: EmptyStateMessages
  readonly filteredEmpty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  /** 스토어가 없는 계정. 목록을 **부르지도 않는다** — 부르면 403 이다. */
  readonly noStore: StoreAbsentMessages
}

/**
 * 정산 예정 금액 (F4).
 *
 * **두 단계가 각각 자기 이름과 자기 설명을 갖는다.** 합쳐서 한 숫자로 그리면
 * 「받기로 확정된 돈」과 「아직 반품될 수 있는 돈」이 같은 값에 섞이고, 판매자는 그
 * 합을 확정된 금액으로 읽는다. 계약이 두 덩이로 나눠 보내는 이유가 그것이고
 * (`settlementOutlookResponseSchema`), 화면이 그것을 되돌리지 않는다.
 */
export interface SettlementOutlookMessages {
  readonly regionLabel: string
  readonly awaitingConfirmationLabel: string
  readonly awaitingConfirmationHint: string
  readonly awaitingSettlementLabel: string
  readonly awaitingSettlementHint: string
  /** `{count}` — 그 단계에 걸려 있는 판매자 몫의 수. */
  readonly countValue: string
  /** 두 값을 왜 더해 두지 않았는지. 이 한 줄이 없으면 판매자가 스스로 더한다. */
  readonly note: string
  readonly errorTitle: string
}

export interface SettlementFilterMessages {
  readonly legend: string
  readonly statusLabel: string
  readonly statusAll: string
  readonly reset: string
}

export interface SettlementTableMessages {
  readonly caption: string
  readonly period: string
  readonly status: string
  readonly salesAmount: string
  readonly payoutAmount: string
  readonly actions: string
  /** `{from}` `{until}` — 끝은 **포함하는 날**로 옮겨서 그린다. */
  readonly periodRange: string
  readonly detailLabel: string
  /** `{reason}` — 보류 사유. 해소된 뒤에도 남는다. */
  readonly holdReason: string
}

/** 지금 필터가 고른 것들의 합. **페이지의 합이 아니다** — 계약이 그렇게 보낸다. */
export interface SettlementTotalsMessages {
  readonly regionLabel: string
  /** `{amount}` */
  readonly payout: string
  /** `{count}` */
  readonly count: string
}

/** `/settlements/[id]` 가 그리는 모든 것. */
export interface SettlementDetailMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly backLabel: string
  readonly summary: SettlementSummaryMessages
  readonly calculation: SettlementCalculationMessages
  readonly items: SettlementItemMessages
  readonly errorTitle: string
  readonly retry: string
}

export interface SettlementSummaryMessages {
  readonly regionLabel: string
  readonly periodLabel: string
  readonly statusLabel: string
  readonly createdLabel: string
  readonly paidLabel: string
  /** 아직 지급되지 않았다. 빈 칸을 두면 「0원 지급」으로 읽힌다. */
  readonly notPaid: string
  readonly holdTitle: string
}

/**
 * 계산 근거 다섯 줄 (F2 · 3장 요구사항 5).
 *
 * `lines` 가 `Record<CalculationLineKey, string>` 이라 줄이 하나 늘면 문구 없는
 * 자리를 `pnpm typecheck` 가 먼저 잡는다.
 */
export interface SettlementCalculationMessages {
  readonly title: string
  readonly caption: string
  readonly labelHeader: string
  readonly amountHeader: string
  readonly lines: Readonly<Record<CalculationLineKey, string>>
  /**
   * **플랫폼 쿠폰과 적립금은 차감되지 않는다** (`pricing.md` 6장).
   *
   * 이 한 줄이 TASK-0082 4장이 없애려는 문의의 절반이다. 판매자가 보는 판매액은
   * 구매자가 낸 돈보다 크고, 그 차이를 설명하지 않으면 「왜 더 많이 적혀 있죠」가
   * 오거나 — 더 나쁘게는 — 아무도 묻지 않은 채 잘못 계산된 것으로 기억된다.
   */
  readonly platformNote: string
}

export interface SettlementItemMessages {
  readonly title: string
  readonly caption: string
  readonly orderNumberHeader: string
  readonly typeHeader: string
  readonly salesHeader: string
  readonly commissionHeader: string
  readonly sellerCouponHeader: string
  readonly payoutHeader: string
  readonly empty: string
  /** 차감 줄의 숫자가 왜 전부 음수인지. */
  readonly note: string
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

/* ---------------------------------------------- 취소·반품 처리 (TASK-0070) -- */

/**
 * 클레임의 어휘 — 상태 · 유형 · 귀책 · 반품 사유 · 단계 · 걸음의 이름.
 *
 * **전수 `Record` 인 것이 요점이다.** 상태나 사유가 하나 늘면 타입 검사가 빠진 문장을
 * 잡고, 화면은 「알 수 없음」을 그릴 일이 없다 (`OrderVocabularyMessages` 와 같은 장치).
 */
export interface ClaimVocabularyMessages {
  readonly statusLabels: Readonly<Record<ClaimStatus, string>>
  readonly typeLabels: Readonly<Record<ClaimType, string>>
  /** 누구 탓인가. **값이 아니라 돈이다** — 반품비를 누가 무는지가 여기서 갈린다. */
  readonly faultLabels: Readonly<Record<ClaimFault, string>>
  /** 왜 돌려보내는가. 셋이 입력이고 귀책 둘은 여기서 파생된다. */
  readonly returnReasonLabels: Readonly<Record<ReturnReason, string>>
  /** 탭의 축 — 「내가 지금 뭘 해야 하나」. */
  readonly stageLabels: Readonly<Record<ClaimHandlingStage, string>>
  /** 걸음의 이름 — 「어느 상태로」가 아니라 **무엇을 하는지**로 읽힌다. */
  readonly actionLabels: Readonly<Record<ClaimStatus, string>>
  /**
   * 검수의 두 답.
   *
   * `actionLabels` 로 덮을 수 없는 자리다. `RETURN_REJECTED` 는 **두 곳에서** 나온다 —
   * 신청을 거절하는 것(전이 라우트)과 검수에서 떨어뜨리는 것(검수 라우트)이고, 둘은
   * 같은 상태로 가지만 다른 일이다. 상태 하나에 문장 하나인 표로는 그 둘을 가를 수
   * 없고, 가르는 것은 `route` 다.
   */
  readonly inspectionLabels: {
    readonly passed: string
    readonly failed: string
  }
}

/** 단계 탭. 상태 탭이 아닌 이유는 `claim-console.ts` 가 적어 두었다. */
export interface ClaimTabMessages {
  readonly label: string
  readonly names: Readonly<Record<SellerClaimTab, string>>
  /** `{name}` `{count}` — 탭 이름 뒤에 붙는 건수의 접근성 문장. */
  readonly countLabel: string
}

/**
 * 유형과 상태의 축.
 *
 * 단계는 위의 탭이 맡으므로 여기 없다 — 한 조건을 두 자리에서 고를 수 있게 만들면 어느
 * 쪽이 이기는지를 정해야 하고, 그 규칙은 아무도 기억하지 못한다.
 */
export interface ClaimFilterMessages {
  readonly legend: string
  readonly typeLabel: string
  readonly typeAll: string
  readonly statusLabel: string
  readonly statusAll: string
  readonly reset: string
}

/** 목록 표의 열. */
export interface ClaimTableMessages {
  readonly caption: string
  readonly orderNumber: string
  readonly type: string
  readonly status: string
  readonly stage: string
  readonly items: string
  readonly requestedAt: string
  readonly dueAt: string
  readonly open: string
  /** `{headline}` `{rest}` — 「울 코트 외 2건」. 개수는 서버가 세고 문장은 여기서 만든다. */
  readonly headlineWithRest: string
  /** `{count}` */
  readonly quantity: string
}

/**
 * 처리 기한과 지연 — 목록과 상세가 **같은 문장**을 쓴다.
 *
 * `rule` 이 이 슬라이스의 존재 이유다. 서버는 기한을 「신청 후 2영업일」로 세되
 * **주말만 빼고 공휴일은 보지 않는다**(`apps/api/src/claims/claim-deadline.ts`).
 * 그 사실을 숨기면 판매자는 설 연휴에 뜨는 「기한 초과」를 버그로 신고하고, 그때
 * 대답할 수 있는 사람은 그 파일을 읽은 사람뿐이다.
 */
export interface ClaimDeadlineMessages {
  /** 지연된 건에 붙는 배지. **색만으로 말하지 않는다** — 이 문장이 그 이유다. */
  readonly overdue: string
  readonly rule: string
}

/**
 * 상세가 더 갖는 것.
 *
 * 목록의 것을 **넓히는** 모양인 이유는 두 화면이 같은 두 문장을 써야 하기 때문이다 —
 * 따로 두면 목록에서는 「기한 초과」이고 상세에서는 「기한 지남」인 날이 온다.
 */
export interface ClaimDetailDeadlineMessages extends ClaimDeadlineMessages {
  readonly label: string
  readonly onTime: string
  /** `{due}` — 상세의 경고 한 줄. */
  readonly overdueNotice: string
}

/** 처리 대기 뱃지. */
export interface ClaimBadgeMessages {
  /** `{count}` */
  readonly waiting: string
  readonly none: string
}

export interface ClaimListMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly tabs: ClaimTabMessages
  readonly filters: ClaimFilterMessages
  readonly table: ClaimTableMessages
  readonly badges: ClaimBadgeMessages
  readonly deadline: ClaimDeadlineMessages
  readonly pagination: PaginationMessages
  readonly empty: EmptyStateMessages
  readonly filteredEmpty: EmptyStateMessages
  /**
   * 목록에 실패 패널도 토스트도 없다.
   *
   * **이 화면은 아무것도 쓰지 않기 때문이다.** 승인·거절·수거·검수는 전부 상세에서
   * 일어나고, 여기서 실패할 수 있는 것은 목록을 읽는 일 하나다 — 그것은 `DataList` 의
   * 네 상태 중 오류가 이미 답한다. 쓰지 않는 문장을 카탈로그에 두면 번역할 사람이
   * 그것을 번역한다.
   */
  readonly errorTitle: string
  readonly retry: string
}

/**
 * 환불 예정액.
 *
 * **배송비 조정은 부호를 살려 그린다.** 「반품비 3,000원 차감」과 「원 배송비 3,000원
 * 환불」을 하나로 접으면 0원이 되어 아무 일도 없었던 것처럼 보인다
 * (`claimRefundQuoteSchema` 가 적어 둔 그대로다).
 */
export interface ClaimQuoteMessages {
  /**
   * 아직 안 나간 돈의 이름.
   *
   * **`refunded` 하나가 이 라벨을 가른다** (`sellerClaimDetailSchema`). 금액은 같은
   * 함수를 지난 같은 값이고 바뀌는 것은 시제뿐이라, 화면이 상태로 다시 판정하면 끝난
   * 클레임이 「환불 예정액」을 보여 준다.
   */
  readonly pendingTitle: string
  /** 이미 나간 돈의 이름. */
  readonly refundedTitle: string
  readonly itemsAmount: string
  readonly shippingAmount: string
  readonly total: string
  /** 승인 버튼을 누르기 전에 읽는 한 줄. */
  readonly pendingNotice: string
  /** 이미 나간 뒤에 읽는 한 줄. */
  readonly refundedNotice: string
}

/** 첨부 사진. */
export interface ClaimPhotoMessages {
  readonly empty: string
  /** `{index}` — 사진에는 그 자체로 이름이 없다. 순번이 유일하게 참인 이름이다. */
  readonly alt: string
  /** 저장소가 설정되지 않은 배포에서 `url` 이 `null` 이다 (TASK-0011 4.5). */
  readonly unavailable: string
}

/**
 * 귀책과 그 근거 — **읽기 전용이다.**
 *
 * 판매자가 귀책을 직접 바꾸는 서버 계약이 **없다.** 반품의 귀책은 신청 사유에서
 * 파생돼 `ReturnDetail` 에 굳어 있고 다시 계산하지 않는다. 그러니 입력 컨트롤을 내지
 * 않고 **왜 여기서 바꿀 수 없는지**를 적는다 (TASK-0114 의 「옵션 축은 수정에서 바꾸지
 * 않는다」와 같은 방식). 판매자의 판단은 **검수 합격·불합격**으로 표현된다.
 */
export interface ClaimFaultMessages {
  readonly returnReason: string
  readonly fault: string
  readonly returnShippingDeduction: string
  readonly originalShippingRefund: string
  readonly readOnlyNotice: string
}

/** 회수·반송 운송장. 방향이 반대라는 사실이 이 도메인에서 유일하게 새로운 것이다. */
export interface ClaimShipmentMessages {
  readonly pickup: string
  readonly sendBack: string
  readonly none: string
}

/**
 * 상태 이력 표.
 *
 * `OrderHistoryMessages` 와 모양이 같고 **다른 슬라이스**인 이유는 문장이 다르기
 * 때문이다 — 여기서 `created` 는 「주문 접수」가 아니라 「신청 접수」이고, `step` 이
 * 잇는 것은 주문 상태가 아니라 클레임 상태다. 한 벌로 접으면 클레임 이력에 「주문
 * 접수」가 찍힌다.
 */
export interface ClaimHistoryMessages {
  readonly caption: string
  readonly at: string
  readonly change: string
  readonly actor: string
  readonly reason: string
  readonly noReason: string
  /** `{from}` `{to}` — 「반품 신청 → 반품 승인」. 최초 신청에는 앞이 없다. */
  readonly step: string
  readonly created: string
  readonly empty: string
}

/**
 * 걸음과 그 확인 대화상자.
 *
 * **사유 칸이 둘이다.** 전이의 사유는 `reason` 이고 검수 불합격의 사유는 `note` 로,
 * 같은 「거절 사유」이지만 다른 문에 실린다 (`reasonFieldOf`). 오류는 언제나 **그
 * 칸에** 붙는다 — 대화상자 위의 문장 하나로는 어느 칸이 문제인지 말하지 못한다 (U2).
 */
export interface ClaimActionMessages {
  readonly legend: string
  /** 밟을 걸음이 없을 때. 종착이거나 시스템을 기다리는 자리다. */
  readonly empty: string
  readonly confirmTitle: string
  /** `{action}` */
  readonly confirmBody: string
  readonly confirm: string
  readonly cancel: string
  readonly reasonLabel: string
  readonly reasonPlaceholder: string
  readonly reasonRequired: string
  readonly noteLabel: string
  readonly notePlaceholder: string
  readonly noteRequired: string
  /** `{status}` */
  readonly done: string
  /** 멱등한 전이가 아무것도 옮기지 않았을 때. */
  readonly unchanged: string
}

export interface ClaimDetailMessages {
  readonly title: string
  readonly description: string
  readonly loadingLabel: string
  readonly backToList: string
  /** `{orderNumber}` */
  readonly subtitle: string
  readonly sections: {
    readonly items: string
    readonly request: string
    readonly photos: string
    readonly fault: string
    readonly deadline: string
    readonly shipments: string
    readonly history: string
  }
  readonly items: {
    readonly caption: string
    readonly product: string
    readonly option: string
    readonly quantity: string
    /** 이 줄의 환불 금액. **`ClaimItem.refundAmount` 가 아니라 견적의 줄**에서 온다. */
    readonly refund: string
    readonly noOption: string
  }
  readonly request: {
    readonly reason: string
    readonly requestedAt: string
  }
  readonly quote: ClaimQuoteMessages
  readonly photos: ClaimPhotoMessages
  readonly fault: ClaimFaultMessages
  readonly shipments: ClaimShipmentMessages
  readonly deadline: ClaimDetailDeadlineMessages
  readonly history: ClaimHistoryMessages
  readonly actions: ClaimActionMessages
  readonly errorTitle: string
  readonly retry: string
  readonly notFound: EmptyStateMessages
  readonly failure: StoreFailureMessages
  readonly toast: ProductToastMessages
  readonly closeLabel: string
}

/* ------------------------------------------------- 판매자 쿠폰 (TASK-0074) -- */

/**
 * 쿠폰의 어휘.
 *
 * 상태와 방식은 `Record<계약의 유니온, string>` 이라, 계약에 값이 하나 늘면 문장이
 * 없는 자리를 `pnpm typecheck` 가 먼저 잡는다 — 빈 배지를 그린 화면이 통과하는 것을
 * 막는 유일한 장치가 그것이다.
 *
 * 범위만 계약의 유니온이 아니라 **판매자가 고를 수 있는 둘**로 좁혀져 있다
 * (`SellerCouponScopeType`). 전체·카테고리에 이름을 붙여 두면 그 이름이 어딘가에
 * 그려질 수 있게 되고, 이 화면은 그 둘이 **존재하지 않는 것처럼** 보여야 한다 (F1).
 */
export interface CouponVocabularyMessages {
  readonly lifecycleLabels: Readonly<Record<CouponLifecycle, string>>
  readonly discountTypeLabels: Readonly<Record<CouponDiscountType, string>>
  readonly scopeTypeLabels: Readonly<Record<SellerCouponScopeType, string>>
  /** `{amount}` — 정액. 금액은 통화 형식을 지난 값이 들어온다. */
  readonly discountFixed: string
  /** `{percent}` — 상한이 없는 정률. **경계가 없다는 사실이 여기서도 드러난다.** */
  readonly discountPercent: string
  /** `{percent}` `{cap}` — 상한이 있는 정률. */
  readonly discountPercentCapped: string
  /** 발급 수량에 상한이 없다. 목록과 폼이 같은 낱말을 쓴다. */
  readonly unlimited: string
  /** 값이 없는 칸. 「—」 한 글자라도 두 곳에 적으면 갈린다. */
  readonly none: string
}

/**
 * `/coupons` 목록이 그리는 모든 것.
 *
 * 정산 안내(`settlement`)와 부담 누계(`liability`)가 **목록의 슬라이스**인 것이
 * TASK-0074 R1 의 답이다: 부담 구조는 발행 폼에서 한 번 말하고 끝나는 것이 아니라
 * 목록에도 같은 낱말로 서 있어야 한다.
 */
export interface CouponListMessages {
  readonly description: string
  readonly loadingLabel: string
  readonly settlement: CouponSettlementMessages
  readonly liability: CouponLiabilitySummaryMessages
  readonly filters: CouponFilterMessages
  readonly table: CouponTableMessages
  readonly issuing: CouponIssuingMessages
  readonly pagination: PaginationMessages
  readonly empty: EmptyStateMessages
  readonly filteredEmpty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  /**
   * 스토어가 없는 계정이 이 화면에 왔다.
   *
   * 오류가 아니다 — `sellerId` 가 없으면 목록을 **부르지도 않는다**. 불렀다면 서버는
   * 그것을 플랫폼 쿠폰 목록으로 읽고 403 을 돌려주고, 화면은 「권한이 없어요」라고
   * 말하게 된다. 신청하지 않았을 뿐인 사람에게 그것은 틀린 문장이다.
   */
  readonly noStore: StoreAbsentMessages
  readonly toast: ProductToastMessages
}

/**
 * 정산 화면으로 가는 자리 (M12).
 *
 * **링크 하나와 문장 하나뿐이다.** 차감이 언제 어떻게 일어나는지는 정산이 소유하는
 * 사실이고, 그것을 여기서 설명하면 M12 가 규칙을 정하는 날 두 화면이 다른 말을
 * 하게 된다. 여기서 하는 말은 「여기서 빠진다」와 「거기서 볼 수 있다」까지다.
 */
export interface CouponSettlementMessages {
  readonly title: string
  readonly body: string
  readonly linkLabel: string
}

/** 부담 누계 (F5). */
export interface CouponLiabilitySummaryMessages {
  readonly title: string
  /** `{amount}` — 이 줄들이 지금까지 깎은 금액의 합. */
  readonly total: string
  /** `{count}` — 그 금액이 나온 장수. */
  readonly used: string
  /**
   * **이 페이지의 합계**라고 말하는 한 줄.
   *
   * 계약에 발행자별 누계를 답하는 자리가 없다. 없는 것을 「전체」라고 부르면 두 번째
   * 페이지를 넘긴 사람이 줄어든 숫자를 보고 무엇이 사라졌는지 찾게 된다.
   */
  readonly note: string
}

export interface CouponFilterMessages {
  readonly legend: string
  readonly lifecycleLabel: string
  readonly lifecycleAll: string
  readonly reset: string
}

export interface CouponTableMessages {
  readonly caption: string
  readonly name: string
  readonly lifecycle: string
  readonly discount: string
  readonly scope: string
  readonly period: string
  readonly issued: string
  /** 이 쿠폰이 지금까지 깎은 금액. 판매자에게는 그것이 **부담 누계**다. */
  readonly liability: string
  readonly actions: string
  /** `{code}` — 코드로 나가는 쿠폰만. */
  readonly code: string
  /** `{issued}` `{limit}` */
  readonly issuedOfLimit: string
  /** `{issued}` — 수량 상한이 없는 쿠폰. */
  readonly issuedUnlimited: string
  /** `{count}` */
  readonly usedCount: string
  /** `{count}` — 상품 지정 범위. */
  readonly scopeProducts: string
  /** `{from}` `{until}` */
  readonly periodRange: string
  /** `{amount}` — 최소 주문금액이 걸린 쿠폰. */
  readonly minOrder: string
}

/**
 * 발행 중단과 재개.
 *
 * **「삭제」가 아니라는 것을 문장이 말한다.** 중단은 더 나가지 않게 하는 일이고 이미
 * 받은 사람의 쿠폰은 그대로 유효하다 — 그 사실을 적지 않으면 판매자는 중단을
 * 「회수」로 이해하고, 그 오해는 고객 문의가 되어서야 드러난다.
 */
export interface CouponIssuingMessages {
  readonly suspendLabel: string
  readonly resumeLabel: string
  readonly hint: string
  /** `{name}` */
  readonly suspendedNotice: string
  /** `{name}` */
  readonly resumedNotice: string
  /** 기간이 끝나 손댈 것이 없는 줄. */
  readonly ended: string
}

/**
 * 발행 폼 (TASK-0074 4장 · 5장).
 *
 * 목록과 다른 슬라이스인 것은 문장이 다르기 때문이다. 목록의 어휘는 「이 쿠폰이
 * 무엇을 했나」이고 폼의 어휘는 「이 쿠폰이 무엇을 하게 되나」다 — 한 벌로 접으면
 * 「부담 누계」와 「예상 부담」이 같은 낱말을 쓰게 되고, 그 순간 이미 나간 돈과
 * 아직 나가지 않은 돈이 화면에서 구분되지 않는다.
 */
export interface CouponFormMessages {
  readonly title: string
  readonly description: string
  /** 폼을 여는 버튼. 닫혀 있는 것이 기본이다 — 목록이 이 화면의 본문이다. */
  readonly openLabel: string
  readonly closeLabel: string
  readonly legend: string
  readonly warning: CouponWarningMessages
  readonly fields: CouponFormFieldMessages
  readonly errors: CouponFieldErrorMessages
  readonly errorTitle: string
  readonly submitLabel: string
  readonly submitFailed: string
  /** `{name}` */
  readonly issuedNotice: string
  /** `{name}` `{code}` — 코드까지 함께 난 경우. */
  readonly issuedWithCode: string
}

/**
 * 발행 폼 맨 위의 경고 (F2 · F3).
 *
 * **이 화면이 존재하는 이유가 이 네 줄이다.** 판매자가 부담 구조를 모르고 쿠폰을
 * 뿌리는 일이 실제로 흔하고, 그래서 「정산에서 차감됩니다」라는 문장과 **지금 입력한
 * 값으로 계산한 숫자**가 발행 버튼보다 위에 있다.
 */
export interface CouponWarningMessages {
  readonly title: string
  readonly body: string
  /** `{count}` `{perVoucher}` `{total}` — 「100장 × 5,000원 = 500,000원」 */
  readonly estimate: string
  readonly estimateLabel: string
  /**
   * 최대 부담에 **경계가 없을 때**의 두 문장.
   *
   * 0원이나 「—」 로 접지 않는다. 상한 없는 정률 쿠폰의 최대 부담은 큰 수가 아니라
   * 없는 수이고, 숫자를 적으면 그 숫자가 곧 「이만큼만 나가겠구나」가 된다.
   * 키가 `CouponLiabilityUnbounded` 라 이유가 하나 늘면 문장도 함께 늘어야 한다.
   */
  readonly unbounded: Readonly<Record<CouponLiabilityUnbounded, string>>
  /** 아직 할인액을 입력하지 않았다. 채우면 숫자가 나타난다. */
  readonly unknown: string
}

export interface CouponFormFieldMessages {
  readonly nameLabel: string
  readonly nameHint: string
  readonly discountTypeLabel: string
  /** 방식에 따라 뜻이 달라지는 칸이라 라벨도 갈린다 — 원이냐 퍼센트냐. */
  readonly discountValueLabel: Readonly<Record<CouponDiscountType, string>>
  readonly discountValueHint: Readonly<Record<CouponDiscountType, string>>
  readonly maxDiscountAmountLabel: string
  readonly maxDiscountAmountHint: string
  readonly minOrderAmountLabel: string
  readonly minOrderAmountHint: string
  readonly scopeTypeLabel: string
  readonly scopeTypeHint: string
  readonly scopeIdsLabel: string
  readonly scopeIdsHint: string
  readonly scopeIdsLoading: string
  readonly scopeIdsFailed: string
  readonly scopeIdsEmpty: string
  /** 상한에 걸려 목록이 잘렸다. `{count}` */
  readonly scopeIdsTruncated: string
  /** `{count}` */
  readonly scopeIdsSelected: string
  readonly validFromLabel: string
  readonly validUntilLabel: string
  readonly periodHint: string
  readonly issueLimitLabel: string
  readonly issueLimitHint: string
  readonly withCodeLabel: string
  readonly withCodeHint: string
}

/* ------------------------------------------ 상품 리뷰 관리 (TASK-0085) -- */

/**
 * `/reviews` 가 그리는 모든 것.
 *
 * 미답변 뱃지(`unanswered`)가 목록의 슬라이스인 것은 두 값이 한 화면의 위아래에 있기
 * 때문이다. 이 화면이 답하는 물음은 「무엇에 답해야 하는가」 하나이고, 뱃지는 그
 * 물음의 요약이며 목록은 그 답이다.
 */
export interface ReviewListMessages {
  readonly description: string
  readonly loadingLabel: string
  readonly unanswered: ReviewUnansweredMessages
  readonly filters: ReviewFilterMessages
  readonly card: ReviewCardMessages
  readonly reply: ReviewReplyMessages
  readonly pagination: PaginationMessages
  readonly empty: EmptyStateMessages
  readonly filteredEmpty: EmptyStateMessages
  readonly errorTitle: string
  readonly retry: string
  /** 스토어가 없는 계정. 목록을 **부르지도 않는다** — 부르면 거절된다. */
  readonly noStore: StoreAbsentMessages
}

/**
 * 미답변 건수 뱃지 (F7).
 *
 * **`note` 가 이 슬라이스의 핵심이다.** 이 수는 필터를 걸어도 줄지 않는다 — 계약이
 * 그렇게 보내고(`sellerProductReviewsResponseSchema`), 그 사실을 적지 않으면
 * 「미답변만」을 켠 판매자는 목록의 줄 수와 뱃지가 다른 것을 버그로 읽는다.
 */
export interface ReviewUnansweredMessages {
  readonly regionLabel: string
  /** `{count}` — 답해야 할 리뷰의 수. 지금 화면에 몇 개인지가 아니다. */
  readonly value: string
  readonly note: string
  /** 하나도 없다. 0을 큰 글씨로 쓰는 대신 문장으로 말한다. */
  readonly none: string
}

/**
 * 두 축 — 미답변만, 그리고 **이 별점 이하**.
 *
 * 4장이 정한 사용 패턴이 그대로 필터가 된다: 대응이 필요한 리뷰를 먼저 찾는 것.
 * 「높은 평점만」이 없는 이유가 그것이고, 그 축은 이 화면에서 아무 일도 시키지 않는다.
 */
export interface ReviewFilterMessages {
  readonly legend: string
  readonly unansweredOnlyLabel: string
  readonly maxRatingLabel: string
  readonly maxRatingAll: string
  /** `{rating}` — 「2점 이하」. 5점은 목록에 없다: 전체와 같은 뜻이기 때문이다. */
  readonly maxRatingOption: string
  readonly reset: string
}

/** 리뷰 한 장이 말하는 것. */
export interface ReviewCardMessages {
  readonly listLabel: string
  /** `{rating}` — 별 다섯 개는 보조 기술에게 숫자가 아니다. 이 문장이 숫자다. */
  readonly ratingValue: string
  /** `{name}` — 어느 상품의 리뷰인가. 목록이 상품을 가로지르므로 줄마다 필요하다. */
  readonly productLabel: string
  /** `{option}` — 산 조합(「블랙 / M」). 주문 항목의 스냅샷에서 온다. */
  readonly optionLabel: string
  /** `{name}` — 가려진 이름(`홍*동`). 가리는 일은 서버가 이미 했다. */
  readonly authorLabel: string
  /** `{date}` */
  readonly writtenAt: string
  /**
   * `{count}` — 사진이 **몇 장 붙어 있는지**.
   *
   * 그림을 그리지 않는 이유는 **판매자가 여기서 하는 일이 답을 쓰는 것**이기
   * 때문이다. 계약은 주소를 함께 보내 주지만(`images[].url`), 사진은 그 판단에 거의
   * 쓰이지 않으면서 목록의 높이를 몇 배로 만든다 — 사진을 봐야 하는 리뷰는 상품
   * 상세에서 본다.
   */
  readonly photoCount: string
  readonly unansweredBadge: string
  readonly answeredBadge: string
}

/**
 * 답변을 쓰고 · 고치고 · 지우는 자리 (F1 · F3).
 *
 * **「작성」과 「수정」이 같은 버튼이 아니다** — 문구만 갈리고 가는 곳은 하나다.
 * 리뷰당 답변이 하나이고 그것을 기본키가 만들므로(`ReviewReply`), 두 번째 답변이
 * 저장될 자리가 없다. 화면에 문을 둘 두면 하나는 언젠가 400 을 받는다.
 */
export interface ReviewReplyMessages {
  readonly heading: string
  /** `{brand}` — 구매자에게 이 답변이 누구의 것으로 보이는가. */
  readonly authorLine: string
  /** `{date}` */
  readonly updatedAt: string
  readonly writeLabel: string
  readonly editLabel: string
  readonly deleteLabel: string
  readonly cancelLabel: string
  readonly saveLabel: string
  readonly contentLabel: string
  /** `{max}` — 상한은 계약의 상수에서 온다. 문장에 숫자를 적지 않는다. */
  readonly contentHint: string
  readonly contentPlaceholder: string
  readonly errors: ReplyFieldErrorMessages
  readonly errorTitle: string
  readonly submitFailed: string
  readonly savedNotice: string
  readonly deletedNotice: string
  readonly failureTitle: string
  readonly refusals: ReviewReplyRefusalMessages
  readonly confirm: ReviewReplyConfirmMessages
}

/**
 * 두 거절만 자기 문장을 갖는다 (F2).
 *
 * `other` 가 빠져 있는 것이 설계다 — 그 밖의 실패는 `errors` 카탈로그가 코드로
 * 답하고, 여기에 문장을 하나 더 두면 이미 답한 것을 두 번째로 답하게 된다. 그 둘은
 * 언젠가 갈리고, 그때 같은 500 이 화면마다 다른 말을 한다.
 *
 * `Exclude` 로 키를 잡아 두었으므로 거절이 하나 늘면 여기가 typecheck 에서 걸린다.
 */
export type ReviewReplyRefusalMessages = Readonly<Record<Exclude<ReplyRefusal, 'other'>, string>>

/** 답변 삭제 확인. **되돌릴 수 없는 걸음**이라 묻는다. */
export interface ReviewReplyConfirmMessages {
  readonly title: string
  readonly description: string
  readonly confirm: string
  readonly cancel: string
  readonly closeLabel: string
}
