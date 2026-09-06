import { z } from 'zod'

import { wonSchema } from '../pricing/types.js'
import { categoryIdSchema } from './categories.js'
import { productIdSchema } from './products.js'
import { sellerIdSchema } from './sellers.js'

/**
 * 쿠폰의 계약 (TASK-0072).
 *
 * **`issuerType` 이 정산의 근거다** (D-029 · `docs/design/pricing.md` 6장). 플랫폼
 * 쿠폰은 플랫폼이 물고 판매자 쿠폰만 정산에서 차감되므로, 부담 주체를 스키마에
 * 못박지 않으면 정산이 「판매액 × 수수료율」이라는 단순 곱셈이 되어 도메인으로서
 * 의미를 잃는다.
 *
 * **여기 있는 것은 선을 넘어가는 모양뿐이다.** 발행이 거절되는 이유와 발급 가능
 * 판정은 `apps/api/src/coupons/coupon-rules.ts` 의 순수 함수가 쥔다 — 그 판단들은
 * 「누가 부르는가」와 「지금이 언제인가」를 알아야 하고, 그것은 브라우저 번들이
 * 들고 다닐 개념이 아니다.
 */

/**
 * 누가 이 쿠폰을 부담하는가.
 *
 * **화면이 분기할 라벨이 아니라 돈의 방향이다.** `PLATFORM` 이면 할인액이 플랫폼
 * 몫에서 나가고 판매자는 정가 기준으로 정산받는다. `SELLER` 면 그 판매자의
 * 정산액에서 안분액이 빠진다.
 */
export const couponIssuerTypes = ['PLATFORM', 'SELLER'] as const

export type CouponIssuerType = (typeof couponIssuerTypes)[number]

export const couponIssuerTypeSchema = z.enum(couponIssuerTypes)

/**
 * 정액이냐 정률이냐.
 *
 * 값의 뜻이 다르다 — `FIXED` 의 `discountValue` 는 **원**이고 `PERCENT` 의 그것은
 * **퍼센트**다. 상한(`maxDiscountAmount`)이 정률에만 뜻이 있는 것도 여기서 나온다.
 */
export const couponDiscountTypes = ['FIXED', 'PERCENT'] as const

export type CouponDiscountType = (typeof couponDiscountTypes)[number]

export const couponDiscountTypeSchema = z.enum(couponDiscountTypes)

/**
 * 어디에 붙는 쿠폰인가.
 *
 * **판매자 쿠폰이 가질 수 있는 것은 `SELLER` 와 `PRODUCT` 뿐이다.** `ALL` 은 남의
 * 매출에까지 자기 부담을 넣는 일이고, `CATEGORY` 는 카테고리가 플랫폼 공용이라
 * 이름만 좁을 뿐 결과가 같다 — 「셔츠 10%」를 낸 판매자가 다른 가게의 셔츠까지
 * 물게 된다. 서버가 막고 DB 도 막는다 (`Coupon_seller_scope_check`).
 */
export const couponScopeTypes = ['ALL', 'CATEGORY', 'PRODUCT', 'SELLER'] as const

export type CouponScopeType = (typeof couponScopeTypes)[number]

export const couponScopeTypeSchema = z.enum(couponScopeTypes)

/**
 * 발급된 쿠폰 한 장의 상태.
 *
 * `EXPIRED` 로 옮기는 것은 사람이 아니라 배치다
 * (`apps/api/src/coupons/coupon-expiry.service.ts`). 「유효기간이 지났다」를 읽는
 * 쪽마다 계산하게 두면 쿠폰함·주문서·정산이 각자 다른 순간을 기준으로 답한다.
 */
export const userCouponStatuses = ['ISSUED', 'USED', 'EXPIRED'] as const

export type UserCouponStatus = (typeof userCouponStatuses)[number]

export const userCouponStatusSchema = z.enum(userCouponStatuses)

/** 쿠폰 이름. 화면이 쿠폰함에 그리는 한 줄이다. */
export const COUPON_NAME_MAX_LENGTH = 60

/**
 * 범위 대상의 개수 상한.
 *
 * 상품 지정 쿠폰이 현실적으로 가리키는 수보다 넉넉하고, 배열 하나가 응답을
 * 부풀리지 않을 만큼 좁다. 상한이 없으면 `scopeIds` 하나가 쿠폰 목록 응답을
 * 메가바이트로 만들 수 있다.
 */
export const COUPON_SCOPE_MAX_IDS = 50

/** 정액 할인의 상한. 정률의 `discountValue` 는 이것과 무관하게 100 이하다. */
export const COUPON_MAX_DISCOUNT_VALUE = 10_000_000

/** 발급 수량의 상한. `null` 은 무제한이라는 뜻이고, 이것은 그 반대쪽 끝이다. */
export const COUPON_MAX_ISSUE_LIMIT = 1_000_000

/**
 * 쿠폰 코드의 길이. Crockford base32 로 열 글자 = 50비트.
 *
 * `order-number.ts` 의 여덟 자리(40비트)보다 긴 이유는 **읽는 사람이 다르기**
 * 때문이다. 주문번호는 이미 자기 주문인 사람이 불러 주는 번호라 맞히는 것이
 * 의미가 없지만, 쿠폰 코드는 **맞히면 이득이 되는 문자열**이다. 32^10 ≈ 1.1e15
 * 이면 초당 1,000번을 찍어도 살아 있는 코드 하나를 만나는 데 수만 년이 걸린다.
 */
export const COUPON_CODE_LENGTH = 10

/**
 * 코드가 쓰는 32글자 — Crockford base32.
 *
 * `I` · `L` · `O` · `U` 가 없다. 앞의 셋은 `1` · `0` 과 헷갈리는 글자이고
 * (`order-number.ts` 와 같은 이유), `U` 는 뜻하지 않은 낱말이 만들어지는 것을
 * 막는다. 쿠폰 코드는 **사람이 배너를 보고 손으로 옮겨 적는 문자열**이라 이
 * 성질이 주문번호보다 더 중요하다.
 */
export const COUPON_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 저장되고 응답에 실리는 코드의 모양. 입력은 이보다 너그럽다. */
export const COUPON_CODE_PATTERN = new RegExp(
  `^[${COUPON_CODE_ALPHABET}]{${String(COUPON_CODE_LENGTH)}}$`,
)

/**
 * 사람이 친 코드가 가질 수 있는 길이.
 *
 * 열 글자보다 넉넉한 이유는 **하이픈과 공백을 받아 주기** 때문이다
 * (`coupon-code.ts` 의 `normalizeCouponCode`). 「입력 형식이 틀렸습니다」로
 * 거절하는 화면은 코드를 복사해 붙여넣은 사람에게 아무 도움이 안 된다.
 */
export const COUPON_CODE_INPUT_MAX_LENGTH = 32

export const couponIdSchema = z.uuid()

/** 저장된 코드. 정규화가 끝난 canonical 형태다. */
export const couponCodeSchema = z.string().regex(COUPON_CODE_PATTERN)

/** 사람이 친 코드. 대소문자·하이픈·공백을 그대로 받는다. */
export const couponCodeInputSchema = z.string().trim().min(1).max(COUPON_CODE_INPUT_MAX_LENGTH)

/**
 * 범위 대상 하나.
 *
 * **문자열인 이유는 세 종류가 한 배열에 들어가기 때문이다** — 판매자와 상품은
 * uuid 이고 카테고리는 정수다. 타입별로 컬럼을 세 개 두면 셋 중 둘이 늘 비어
 * 있고, 「어느 칸이 채워졌나」와 `scopeType` 이 어긋날 수 있는 자리가 하나 더
 * 생긴다. 값의 해석은 `scopeType` 하나가 정하고, 실재하는 대상인지는 발행
 * 시점에 서버가 확인한다.
 */
export const couponScopeIdSchema = z.string().min(1).max(64)

/** 쿠폰 정책 한 건. 발급된 장(`UserCoupon`)이 아니라 그 원본이다. */
export const couponSchema = z.object({
  id: couponIdSchema,
  issuerType: couponIssuerTypeSchema,
  /** 판매자 쿠폰일 때만 채워진다. 둘의 관계는 `Coupon_issuer_check` 가 강제한다. */
  sellerId: sellerIdSchema.nullable(),
  name: z.string(),
  /** 코드 발급 쿠폰일 때만. 코드가 없는 쿠폰은 지급으로만 나간다. */
  code: couponCodeSchema.nullable(),
  discountType: couponDiscountTypeSchema,
  /** `FIXED` 면 원, `PERCENT` 면 퍼센트. 단위가 유형에 달렸다. */
  discountValue: z.int().min(1),
  /** 정률의 상한. 정액에서는 언제나 `null` 이다 — 뜻이 없는 값이다. */
  maxDiscountAmount: z.int().min(1).nullable(),
  minOrderAmount: wonSchema,
  scopeType: couponScopeTypeSchema,
  scopeIds: z.array(couponScopeIdSchema),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  /** `null` 은 무제한. 소진 판정은 이 값과 아래 `issuedCount` 로만 이뤄진다. */
  issueLimit: z.int().min(0).nullable(),
  /**
   * 지금까지 발급된 장수.
   *
   * 매번 `UserCoupon` 을 세지 않고 들고 있는 이유는 예약의 `reserved` 와 같다 —
   * **넘지 않았는지 판단하는 자리가 쓰는 자리와 같아야** 하고, 세어서 판단한 뒤
   * 따로 쓰면 그 사이에 다른 발급이 들어온다.
   */
  issuedCount: z.int().min(0),
})

export type Coupon = z.infer<typeof couponSchema>

export const couponResponseSchema = z.object({ coupon: couponSchema })

export type CouponResponse = z.infer<typeof couponResponseSchema>

/**
 * `POST /api/v1/coupons` — 쿠폰을 발행한다.
 *
 * **`issuerType` 이 요청에 없다.** `sellerId` 가 있으면 판매자 쿠폰이고 없으면
 * 플랫폼 쿠폰이다 — 둘을 따로 받으면 「`issuerType: PLATFORM` 인데 `sellerId` 가
 * 있는」 요청이 표현 가능해지고, 그 조합을 거절하는 코드를 또 써야 한다. 부담
 * 주체는 파생되는 값이지 고르는 값이 아니다.
 *
 * 누가 무엇을 발행할 수 있는지는 퍼미션이 정한다: 플랫폼 쿠폰은
 * `platformOwnership` 에 대한 `coupon.write` 라 `any` 스코프를 가진 관리자만
 * 지나가고, 판매자 쿠폰은 그 가게의 소유권에 대한 검사라 주인과 관리자가 지난다.
 */
export const createCouponRequestSchema = z.object({
  /** `null` 이면 플랫폼 쿠폰. 그 자체가 `issuerType` 이다. */
  sellerId: sellerIdSchema.nullable().default(null),
  name: z.string().trim().min(1).max(COUPON_NAME_MAX_LENGTH),
  discountType: couponDiscountTypeSchema,
  discountValue: z.int().min(1).max(COUPON_MAX_DISCOUNT_VALUE),
  maxDiscountAmount: z.int().min(1).max(COUPON_MAX_DISCOUNT_VALUE).nullable().default(null),
  minOrderAmount: wonSchema.default(0),
  scopeType: couponScopeTypeSchema,
  scopeIds: z.array(couponScopeIdSchema).max(COUPON_SCOPE_MAX_IDS).default([]),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  issueLimit: z.int().min(1).max(COUPON_MAX_ISSUE_LIMIT).nullable().default(null),
  /**
   * 코드를 붙일 것인가.
   *
   * **코드는 서버가 만든다.** 발행자가 `WELCOME10` 같은 문자열을 고르게 두면
   * 정규화(`I`→`1`, `O`→`0`)가 사람이 의도한 낱말을 망가뜨리고, 그러면 정규화를
   * 포기하게 되며, 그때부터 배너를 보고 옮겨 적은 사람의 절반이 실패한다.
   */
  withCode: z.boolean().default(false),
})

export type CreateCouponRequest = z.infer<typeof createCouponRequestSchema>

/** 사용자 한 명이 가진 쿠폰 한 장. */
export const userCouponSchema = z.object({
  id: z.uuid(),
  couponId: couponIdSchema,
  userId: z.uuid(),
  status: userCouponStatusSchema,
  /**
   * 이 장의 만료 시각. 발급 시점의 `Coupon.validUntil` 을 **베껴 둔 값**이다.
   *
   * 정책을 보고 판단하지 않는 이유가 둘이다. 하나는 스냅샷 — 발행자가 나중에
   * 기간을 줄이면 이미 받은 사람의 쿠폰이 소급해서 짧아진다. 다른 하나는 배치 —
   * 만료 전환이 조인 없이 한 표만 훑으면 되고, 그 표에 인덱스를 걸 수 있다.
   */
  expiresAt: z.iso.datetime(),
  issuedAt: z.iso.datetime(),
  usedAt: z.iso.datetime().nullable(),
  /** 어느 주문에 썼나. 상태·시각과 함께 움직인다 (`UserCoupon_used_check`). */
  orderId: z.uuid().nullable(),
  /** 정책. 쿠폰함이 「얼마 할인」을 그리려면 이것 없이는 한 번 더 물어야 한다. */
  coupon: couponSchema,
})

export type UserCoupon = z.infer<typeof userCouponSchema>

export const userCouponResponseSchema = z.object({ userCoupon: userCouponSchema })

export type UserCouponResponse = z.infer<typeof userCouponResponseSchema>

/**
 * `POST /api/v1/coupons/:id/issues` — 발행자가 한 사람에게 지급한다.
 *
 * 코드 발급(`/coupons/claims`)과 **다른 문**인 이유는 부르는 사람이 다르기
 * 때문이다. 이쪽은 발행자가 남에게 주는 것이라 `userId` 를 받고, 저쪽은 본인이
 * 받는 것이라 받지 않는다 — 저쪽이 `userId` 를 받으면 코드를 아는 사람이 남의
 * 쿠폰함에 넣을 수 있게 된다.
 */
export const issueCouponRequestSchema = z.object({ userId: z.uuid() })

export type IssueCouponRequest = z.infer<typeof issueCouponRequestSchema>

/** `POST /api/v1/coupons/claims` — 코드를 넣어 **본인이** 받는다. */
export const claimCouponRequestSchema = z.object({ code: couponCodeInputSchema })

export type ClaimCouponRequest = z.infer<typeof claimCouponRequestSchema>

/**
 * 카테고리 범위의 대상 하나를 정수 id 로 읽는다.
 *
 * `scopeIds` 가 문자열 배열이라 한 겹이 필요하다. 서버가 발행 시점에 이것으로
 * 걸러 두지 않으면 「`CATEGORY` 인데 대상이 uuid 인」 행이 저장되고, 그 쿠폰은
 * 적용(TASK-0075)에서 아무 카테고리와도 맞지 않는 채 조용히 아무 일도 하지 않는다.
 */
export const couponCategoryScopeIdSchema = z.coerce.number().pipe(categoryIdSchema)

/** 상품 범위의 대상 하나. */
export const couponProductScopeIdSchema = productIdSchema

/** 판매자 범위의 대상 하나. */
export const couponSellerScopeIdSchema = sellerIdSchema

// ---------------------------------------------------------------------------
// 적용 (TASK-0075)
//
// 위쪽이 「쿠폰이 존재하는 모양」이라면 여기부터는 **「이 주문서에 이 쿠폰이 닿는가」**
// 다. 판단 자체는 `apps/api/src/coupons/coupon-apply.ts` 의 순수 함수가 쥔다 —
// 여기 있는 것은 그 답이 선을 넘어오는 모양뿐이다.
// ---------------------------------------------------------------------------

/**
 * 이 쿠폰을 지금 이 주문서에 쓸 수 없는 이유.
 *
 * **하나로 뭉치지 않는 이유는 사람이 할 일이 다르기 때문이다.** 기간이 남았는데
 * 금액이 모자란 사람은 더 담으면 되고, 끝난 쿠폰을 든 사람은 무엇을 해도 안 된다.
 * 「사용할 수 없는 쿠폰입니다」 하나로 답하는 화면은 그 둘 모두에게 틀린 말을 한다.
 *
 * 순서가 있다 — {@link couponApplicabilityFaults} 를 읽는 쪽이 이 순서로 본다.
 * 앞엣것이 뒤엣것을 가린다: 만료된 쿠폰에 「최소 주문금액이 모자라요」를 말하면
 * 사람은 장바구니를 채우러 갔다가 다시 거절당한다.
 *
 * **목록에서는 `fault` 로, 거절에서는 `details[0].params.reason` 으로 온다.**
 * 고르기 전에는 판정의 결과이고 고른 뒤에는 400(`COUPON_NOT_APPLICABLE`)의 사유라,
 * 같은 이름이 두 자리에 실린다 — 화면이 사유마다 그릴 문장은 한 벌이면 된다.
 */
export const couponApplicabilityFaults = [
  /** 이미 다른 주문에 썼다. */
  'already_used',
  /** 유효기간이 지났다. 배치가 아직 안 돌았어도 여기서는 만료다. */
  'expired',
  /** 아직 시작 전인 정책이다. **기다리면 되는** 거절이다. */
  'not_started',
  /** 이 주문서에 이 쿠폰이 닿는 항목이 하나도 없다. */
  'out_of_scope',
  /** 닿는 항목의 상품금액이 최소 주문금액에 못 미친다. */
  'below_minimum',
  /**
   * 닿기는 하는데 깎이는 금액이 0원이다.
   *
   * 정률 쿠폰이 아주 싼 항목 하나에만 닿을 때 생긴다 — 1% 쿠폰이 50원짜리에 닿으면
   * `floor(0.5)` 는 0이다. 목록에 「0원 할인」으로 남겨 두면 사람이 그것을 골라
   * **한 장을 태운다.**
   */
  'no_discount',
] as const

export type CouponApplicabilityFault = (typeof couponApplicabilityFaults)[number]

export const couponApplicabilityFaultSchema = z.enum(couponApplicabilityFaults)

/**
 * 고른 조합이 거절되는 이유.
 *
 * 위쪽과 **다른 종류의 판단**이라 목록을 나눴다. 저것은 한 장에 대한 사실이고
 * 이것은 **여러 장 사이의 관계**다 — 두 장 모두 그 자체로는 멀쩡한데 함께 쓸 수
 * 없는 경우가 여기 있고, 화면이 어느 장에 문장을 붙여야 할지도 다르다.
 *
 * **오는 자리는 위와 같다** — 400 `COUPON_NOT_APPLICABLE` 의
 * `details[0].params.reason`. 코드를 따로 두지 않은 것은 화면이 하는 일이 같기
 * 때문이다: 그 선택을 풀고 사유를 적는다. 목록(`applicableCouponSchema.fault`)에는
 * 실리지 않는다 — 한 장을 판정한 결과가 아니기 때문이다.
 */
export const couponSelectionFaults = [
  /** 플랫폼 쿠폰을 두 장 골랐다. 주문 하나에 한 장이다. */
  'duplicate_platform',
  /** 같은 판매자의 쿠폰을 두 장 골랐다. 판매자당 한 장이다. */
  'duplicate_seller',
] as const

export type CouponSelectionFault = (typeof couponSelectionFaults)[number]

export const couponSelectionFaultSchema = z.enum(couponSelectionFaults)

/**
 * 한 번에 고를 수 있는 쿠폰의 수.
 *
 * 실제 상한은 **중복 규칙**이 정한다 — 플랫폼 한 장 + 판매자당 한 장이므로 이
 * 숫자에 닿으려면 판매자 마흔아홉을 한 주문서에 담아야 한다. 그래도 배열에 상한을
 * 두는 이유는 `COUPON_SCOPE_MAX_IDS` 와 같다: 상한이 없으면 요청 하나가 서버에
 * 수천 번의 조회를 시킬 수 있다.
 */
export const MAX_SELECTED_COUPONS = 50

/**
 * 주문서에 적용할 쿠폰들 — **발급된 장의 id** 다.
 *
 * 정책(`Coupon.id`)이 아니라 장(`UserCoupon.id`)인 이유는 쓰는 것이 장이기
 * 때문이다. 정책 id 로 받으면 서버가 「이 사람의 그 정책 장」을 찾아 줘야 하고, 그
 * 조회는 한 사람이 같은 정책의 장을 두 개 가질 수 없다는 오늘의 성질에 기대게 된다.
 */
export const selectedUserCouponIdsSchema = z.array(z.uuid()).max(MAX_SELECTED_COUPONS)

/**
 * 쿼리스트링으로 온 선택 — 쉼표 하나로 잇는다.
 *
 * 쿼리스트링에는 배열이 없고 반복 키(`?a=1&a=2`)는 프레임워크마다 다르게 파싱된다.
 * 이 저장소의 목록 필터가 전부 쉼표를 쓰므로(`orderListQueryParamsSchema`) 여기도
 * 같은 문법이다 — 목록마다 다른 문법을 쓰면 그 차이를 아무도 기억하지 못한다.
 */
export const selectedUserCouponIdsQuerySchema = z
  .string()
  // 빈 문자열은 **아무것도 고르지 않은 것**이다. `''.split(',')` 은 `['']` 이라
  // 그대로 두면 `?userCouponIds=` 하나가 「uuid 가 아닌 쿠폰을 골랐다」는 400 이
  // 된다 — 쿼리를 조립하는 쪽이 빈 배열을 그렇게 잇는 것은 흔한 일이고, 그 요청의
  // 뜻은 명백히 「없음」이다.
  .transform((value) => (value === '' ? [] : value.split(',')))
  .pipe(selectedUserCouponIdsSchema)

/**
 * 이 주문서에 쓸 수 있는지까지 판정된 쿠폰 한 장.
 *
 * **못 쓰는 것도 실린다** (F2). 목록에서 빼 버리면 「분명히 쿠폰이 있었는데
 * 없어졌다」가 되고, 그 사람이 다음에 할 일을 화면이 말해 줄 수 없다.
 */
export const applicableCouponSchema = z.object({
  userCoupon: userCouponSchema,
  /**
   * **이 장 하나만 썼을 때** 깎이는 금액. 못 쓰면 0이다.
   *
   * 「하나만」인 것이 중요하다. 두 장이 같은 항목을 겹쳐 덮으면 뒤엣것은 남은
   * 금액까지만 깎이므로, 실제로 적용된 금액은 이것보다 작을 수 있다. 그 값은
   * 주문서의 `appliedCoupons` 에 있다 — 목록은 **고르기 전에** 읽는 값이라 고른
   * 뒤의 사정을 알 수 없다.
   */
  discountAmount: wonSchema,
  /** 못 쓰는 이유. `null` 이면 지금 쓸 수 있다. */
  fault: couponApplicabilityFaultSchema.nullable(),
})

export type ApplicableCoupon = z.infer<typeof applicableCouponSchema>

/**
 * 최대 할인 조합 (F7).
 *
 * 서버가 고른 이유는 **화면이 고르면 두 번째 계산기가 생기기** 때문이다. 조합의
 * 값은 계산 엔진을 돌려야 알 수 있고, 그 엔진을 브라우저에서 조합마다 돌리면
 * 「추천이 실제 적용과 다르다」가 되는 날이 온다.
 */
export const couponRecommendationSchema = z.object({
  /** 이대로 고르면 된다. 비어 있으면 쓸 수 있는 쿠폰이 없다는 뜻이다. */
  userCouponIds: z.array(z.uuid()),
  /** 그때 깎이는 금액. 조합 전체를 실제 계산 엔진에 넣어 낸 값이다. */
  discountAmount: wonSchema,
  /**
   * 전수 탐색으로 고른 답인가.
   *
   * `false` 면 조합의 수가 상한을 넘어 **판매자별 최선을 이어 붙인** 답이다 —
   * 대개 같은 답이지만 쿠폰끼리 겹쳐 잘리는 경우에는 최적이 아닐 수 있다. 화면이
   * 이 값을 그릴 일은 없고, 「추천이 왜 저것인가」를 나중에 묻는 사람을 위한 값이다.
   */
  exhaustive: z.boolean(),
})

export type CouponRecommendation = z.infer<typeof couponRecommendationSchema>

/** `GET /api/v1/checkouts/:id/coupons` — 이 주문서에 쓸 수 있는 쿠폰과 추천 조합. */
export const checkoutCouponsResponseSchema = z.object({
  coupons: z.array(applicableCouponSchema),
  recommendation: couponRecommendationSchema,
})

export type CheckoutCouponsResponse = z.infer<typeof checkoutCouponsResponseSchema>

/**
 * 주문서·주문에 **실제로 적용된** 쿠폰 한 장.
 *
 * 목록의 {@link applicableCouponSchema} 와 이름이 비슷하고 뜻이 다르다. 저것은
 * 「고르면 얼마」이고 이것은 「골라서 얼마가 됐다」이다 — 겹쳐 덮여 잘린 금액이
 * 드러나는 유일한 자리이므로 화면은 합계 옆에 이것을 적는다.
 */
export const appliedCouponSchema = z.object({
  userCouponId: z.uuid(),
  couponId: couponIdSchema,
  /** 쿠폰 이름. 화면이 「가을 맞이 10%」를 그리려면 이것 없이는 한 번 더 물어야 한다. */
  name: z.string(),
  /**
   * 누가 부담하나 (D-029).
   *
   * 사는 사람이 내는 돈은 부담 주체와 무관하지만, **주문에 남는 기록에는 반드시
   * 있어야 한다** — 정산(M12)이 판매자 부담 쿠폰만 차감하기 때문이다.
   */
  issuerType: couponIssuerTypeSchema,
  /**
   * 이 장이 실제로 깎은 금액. 전부 더하면 주문의 쿠폰 할인액이다.
   *
   * **0원일 수 있고, 그래도 목록에 남는다.** 앞의 쿠폰이 상품금액을 다 덮으면 뒤엣
   * 것은 한 푼도 깎지 못하는데, 그때도 **그 장은 쓰인 것**이다 — 빼 버리면 고른
   * 장수와 적용된 장수가 소리 없이 갈리고, 화면은 사라진 한 장을 설명할 수 없다.
   */
  discountAmount: wonSchema,
})

export type AppliedCoupon = z.infer<typeof appliedCouponSchema>
