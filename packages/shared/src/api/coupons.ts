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

/**
 * 정률 할인의 상한. **100 은 전액이고 그것을 넘는 수는 존재하지 않는다.**
 *
 * 스키마의 `refine` 이 아니라 상수인 것이 이 자리의 판단이다. 「이 값이 허용되는가」는
 * 발행 규칙이고 그것은 서버가 쥔다(`coupon-rules.ts` 의 `percent_out_of_range`) —
 * 계약이 같은 판단을 한 번 더 하면 규칙이 두 곳에 살고, 둘이 갈리는 날 어느 쪽이
 * 맞는지 아무도 모른다.
 *
 * 그래도 **숫자는 하나여야 한다.** 화면이 입력을 미리 막는 것은 친절이고, 그
 * 친절이 서버와 다른 수를 쓰면 사람은 화면이 받아 준 값으로 거절당한다.
 */
export const COUPON_PERCENT_MAX_VALUE = 100

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

/**
 * 쿠폰이 닿을 수 있는 그룹 (D-224).
 *
 * `DEMO` 는 방문자의 관리자·판매자가 낸 쿠폰이다. 발행 시점에 정해지고 바뀌지
 * 않으며, **체험 계정에게만 발급된다** — 그 반대는 막지 않는다.
 */
export const couponAudiences = ['ALL', 'DEMO'] as const

export type CouponAudience = (typeof couponAudiences)[number]

export const couponAudienceSchema = z.enum(couponAudiences)

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
   * 어느 그룹의 것인가 (TASK-0073 · D-224).
   *
   * `DEMO` 는 **체험 계정에게만 발급되는 쿠폰**이다. 방문자의 관리자가 낸 것이고,
   * 그것이 실계정 주문에 붙지 않게 하는 값이다. 화면이 이것을 그리는 이유는 진짜
   * 관리자의 목록에는 둘이 섞여 보이기 때문이다 — 자기가 낸 것과 방문자가 낸 것을
   * 가르지 못하면 통계도 「예상 비용」도 뜻이 흐려진다.
   */
  audience: couponAudienceSchema,
  /**
   * 발행이 중단된 시각. `null` 이면 발행 중이다.
   *
   * **이미 발급된 장에는 아무 일도 일어나지 않는다.** 중단은 「더 나가지 않게」이지
   * 「나간 것을 무르게」가 아니다 — 무르는 것은 사람이 받은 것을 빼앗는 일이라
   * 다른 결정이고, 이 화면에는 그 문이 없다.
   */
  suspendedAt: z.iso.datetime().nullable(),
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

// ---------------------------------------------------------------------------
// 발행자 콘솔 (TASK-0073 · TASK-0074)
//
// 관리자와 판매자가 같은 계약을 쓴다. 화면이 다른 것은 **누가 부담하는가**를 어떻게
// 말하느냐이고(플랫폼은 「플랫폼 부담」, 판매자는 「정산에서 차감됩니다」), 서버가
// 답하는 모양은 같다 — 두 벌로 만들면 통계의 정의가 두 곳에서 갈린다.
// ---------------------------------------------------------------------------

/**
 * 쿠폰이 지금 어떤 상태인가 — **저장되지 않고 매번 계산된다.**
 *
 * 칸으로 두지 않는 이유는 그중 셋이 시간의 함수이기 때문이다. 기간이 지나면 아무도
 * 아무것도 하지 않아도 끝난 쿠폰이 되고, 그것을 칸에 적어 두면 그 칸을 옮기는 배치가
 * 하나 더 필요해진다 — 그리고 그 배치가 멈춘 동안 화면은 거짓을 말한다.
 *
 * 순서가 있다. 위엣것이 아래를 가린다: 끝난 쿠폰은 중단됐든 소진됐든 **끝난** 것이고,
 * 중단된 쿠폰에 「아직 시작 전」이라고 말하면 발행자는 기다리면 되는 줄 안다.
 */
export const couponLifecycles = [
  /** 기간이 끝났다. 무엇을 해도 되돌릴 수 없다. */
  'ENDED',
  /** 발행자가 멈췄다. 이미 나간 장은 그대로 유효하다. */
  'SUSPENDED',
  /** 아직 시작 전. 기다리면 된다. */
  'SCHEDULED',
  /** 준비된 수량이 다 나갔다. */
  'EXHAUSTED',
  /** 지금 발급되고 있다. */
  'ACTIVE',
] as const

export type CouponLifecycle = (typeof couponLifecycles)[number]

export const couponLifecycleSchema = z.enum(couponLifecycles)

/**
 * 한 쿠폰이 실제로 만든 것.
 *
 * `issuedCount` 가 여기 없는 이유는 **쿠폰 자신이 들고 있기** 때문이다
 * (`couponSchema.issuedCount`). 같은 수를 두 곳에 실으면 어느 쪽이 맞는지 묻게 된다.
 */
export const couponStatsSchema = z.object({
  /** 실제로 주문에 쓰인 장수. 발급된 장수와의 차이가 사용률의 분자와 분모다. */
  usedCount: z.int().min(0),
  /**
   * 이 쿠폰이 지금까지 깎은 금액의 합.
   *
   * **판매자에게는 이것이 부담 누계다** (TASK-0074 F5). 정책으로 되계산할 수 없는
   * 값이라 사용 시점에 장마다 적어 두었고(`UserCoupon.discountAmount`), 이것은 그
   * 합이다.
   */
  discountTotal: wonSchema,
})

export type CouponStats = z.infer<typeof couponStatsSchema>

/** 목록의 한 줄 — 정책과, 지금 상태와, 그 쿠폰이 만든 것. */
export const couponListEntrySchema = z.object({
  coupon: couponSchema,
  lifecycle: couponLifecycleSchema,
  stats: couponStatsSchema,
})

export type CouponListEntry = z.infer<typeof couponListEntrySchema>

/** 한 번에 받아 가는 줄 수. 목록은 커서로 넘긴다. */
export const COUPON_LIST_DEFAULT_LIMIT = 20

export const COUPON_LIST_MAX_LIMIT = 100

/**
 * `GET /api/v1/coupons` — 발행한 쿠폰 목록.
 *
 * **`sellerId` 가 어느 목록인지를 정한다.** 없으면 플랫폼 쿠폰이고, 있으면 그
 * 스토어의 쿠폰이다. 권한은 그 구분을 따라간다 — 판매자는 자기 스토어만 지나가고,
 * 플랫폼 목록은 `coupon.platform` 을 가진 등급만 본다.
 *
 * 목록마다 다른 문법을 쓰지 않으려고 필터는 쉼표 하나다
 * (`orderListQueryParamsSchema` 와 같은 규약).
 */
export const couponListQueryParamsSchema = z.object({
  sellerId: sellerIdSchema.optional(),
  lifecycle: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(couponLifecycleSchema).min(1))
    .optional(),
  /**
   * 유효기간이 이 범위와 **겹치는** 쿠폰만.
   *
   * 「시작일이 이 사이」가 아니다. 발행자가 「9월에 돌던 쿠폰」을 찾을 때 8월에 시작해
   * 9월까지 가는 것은 찾는 그 쿠폰이고, 시작일로 거르면 그것이 목록에서 사라진다.
   * 경계는 양쪽 다 포함이다 — 주문 목록의 `from`·`to` 와 같은 규약이라, 두 화면이
   * 같은 날짜를 골랐을 때 같은 경계를 얻는다.
   */
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(COUPON_LIST_MAX_LIMIT).optional(),
})

export type CouponListQueryParams = z.infer<typeof couponListQueryParamsSchema>

/**
 * 목록의 답.
 *
 * **정렬은 최신순이다** — 방금 낸 쿠폰이 맨 위에 있어야 발행 화면에서 돌아온 사람이
 * 자기가 만든 것을 찾는다. 커서는 그 축 위의 자리이고, 정렬 축이 `id` 인 것은 그것이
 * UUIDv7 이라 시간순이기 때문이다: `createdAt` 으로 정렬하면 같은 밀리초에 만들어진
 * 두 쿠폰에서 커서가 한 건을 건너뛰거나 두 번 보여 준다.
 *
 * 계약이 이것을 말하지 않던 동안 대역은 **오름차순**을 골랐고(그것이 대역이 지킬 수
 * 있는 유일하게 결정적인 축이었다), 서버는 내림차순이었다. 두 검사 모두 초록인 채로
 * 갈려 있었다 — 계약이 말하지 않은 것은 대역이 정하게 된다.
 */
export const couponListResponseSchema = z.object({
  coupons: z.array(couponListEntrySchema),
  /**
   * 이 발행자의 쿠폰이 **지금까지** 만든 것 — 판매자에게는 부담 누계다
   * (TASK-0074 F5).
   *
   * **필터와 페이지에 무관하다.** 화면에 보이는 줄들의 합이 아니라 이 스토어(또는
   * 플랫폼)가 낸 모든 쿠폰의 합이다 — 「지금까지의 부담액 누계」는 서 있는 수이지
   * 지금 보고 있는 페이지의 성질이 아니고, 페이지 합으로 답하면 다음 장을 넘길
   * 때마다 누계가 달라진다.
   */
  totals: couponStatsSchema,
  nextCursor: z.string().nullable(),
})

export type CouponListResponse = z.infer<typeof couponListResponseSchema>

/**
 * `PATCH /api/v1/coupons/:id` — 발행을 멈추거나 다시 연다.
 *
 * **바꿀 수 있는 것이 이것 하나뿐이다.** 할인율·범위·기간을 고치는 문은 없다: 이미
 * 발급된 장은 발급 시점의 조건으로 쓰이고(`UserCoupon.expiresAt` 이 그 스냅샷이다),
 * 정책만 고치면 같은 쿠폰이 사람마다 다른 뜻을 갖게 된다. 조건이 틀렸으면 멈추고
 * 새로 낸다.
 */
export const updateCouponRequestSchema = z.object({ suspended: z.boolean() })

export type UpdateCouponRequest = z.infer<typeof updateCouponRequestSchema>

/**
 * 누구에게 한꺼번에 지급하나 (TASK-0073 F4).
 *
 * 셋뿐이고, 셋 다 발행자가 실제로 하려는 일이다 — 전원에게, 다시 오게 하려고, 처음
 * 사게 하려고. 조건을 더 늘리지 않는 이유는 화면이 묻지 않는 조건은 **죽은 API**가
 * 되기 때문이다.
 */
export const bulkIssueTargets = ['ALL', 'HAS_ORDERED', 'NEVER_ORDERED'] as const

export type BulkIssueTarget = (typeof bulkIssueTargets)[number]

export const bulkIssueTargetSchema = z.enum(bulkIssueTargets)

/**
 * 한 번의 일괄 발급이 건드리는 계정의 상한.
 *
 * 상한이 없으면 버튼 하나가 회원 수만큼의 행을 한 트랜잭션에 넣는다. 넘치면 남은
 * 수를 응답에 실어 **다시 누르면 이어서 나가게** 한다 — 이미 받은 사람은 건너뛰므로
 * 두 번 눌러도 두 장이 되지 않는다.
 */
export const BULK_ISSUE_MAX_RECIPIENTS = 500

/** `POST /api/v1/coupons/:id/issues/bulk` — 조건에 맞는 회원에게 한꺼번에 지급한다. */
export const bulkIssueRequestSchema = z.object({ target: bulkIssueTargetSchema })

export type BulkIssueRequest = z.infer<typeof bulkIssueRequestSchema>

export const bulkIssueResponseSchema = z.object({
  /** 이번에 실제로 나간 장수. */
  issued: z.int().min(0),
  /**
   * 조건에는 맞지만 **이미 갖고 있어** 나가지 않은 사람 수.
   *
   * 두 번 눌렀을 때 전부 여기로 온다. 「0장 나갔습니다」만으로는 아무도 대상이 아닌
   * 것과 모두가 이미 가진 것을 가를 수 없고, 그 둘에 발행자가 할 일이 다르다.
   */
  skipped: z.int().min(0),
  /**
   * 아직 남은 대상이 있는가 — **개수가 아니라 그 이상 있다는 뜻이다.**
   *
   * 서버는 상한보다 한 명만 더 읽으므로(`BULK_ISSUE_MAX_RECIPIENTS + 1`) 정확한
   * 수를 알지 못한다. 세려면 회원 전체를 세어야 하고, 그 수는 버튼을 한 번 더 누르는
   * 판단에 아무것도 보태지 않는다. `0` 이 아니면 다시 누르면 이어서 나간다.
   *
   * 발급 수량 상한(`issueLimit`)에 걸려 멈춘 경우도 여기 남는다 — 그때는 다시
   * 눌러도 나가지 않으며, 화면은 소진을 함께 그린다.
   */
  remaining: z.int().min(0),
})

export type BulkIssueResponse = z.infer<typeof bulkIssueResponseSchema>

// ---------------------------------------------------------------------------
// 쿠폰함 (TASK-0077)
//
// 발행자의 목록(`GET /coupons`)과 **다른 것**이다. 저기는 정책 한 건이 한 줄이고
// 여기는 **발급된 장**이 한 줄이다 — 같은 쿠폰이 만 명에게 나갔으면 저기서는 한 줄,
// 여기서는 그 사람의 한 장이다.
// ---------------------------------------------------------------------------

/**
 * 「곧 만료된다」의 경계 — 7일 (TASK-0077 F2).
 *
 * 적립금의 30일(`POINT_EXPIRING_SOON_DAYS`)보다 짧은 이유는 **쿠폰이 짧게 살기**
 * 때문이다. 캠페인 쿠폰의 수명이 보통 2~4주라 30일로 잡으면 받자마자 전부 「곧
 * 만료」로 켜지고, 그러면 그 표시가 아무것도 구분하지 못한다.
 */
export const COUPON_EXPIRING_SOON_DAYS = 7

/** 쿠폰함 한 쪽에 담기는 장수. */
export const USER_COUPON_LIST_DEFAULT_LIMIT = 20

export const USER_COUPON_LIST_MAX_LIMIT = 100

/**
 * `GET /api/v1/me/coupons` — 내 쿠폰함.
 *
 * `status` 가 곧 화면의 탭이다. 없으면 전부 — 마이페이지 요약이 「쿠폰 3장」을
 * 그리려면 상태별로 세 번 묻는 대신 한 번 묻고 아래 `counts` 를 읽는다.
 */
export const userCouponListQueryParamsSchema = z.object({
  status: userCouponStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(USER_COUPON_LIST_MAX_LIMIT).optional(),
})

export type UserCouponListQueryParams = z.infer<typeof userCouponListQueryParamsSchema>

export const userCouponListResponseSchema = z.object({
  /** 최신순 — 방금 받은 장이 맨 위다. */
  coupons: z.array(userCouponSchema),
  /**
   * 상태별 장수 — **탭에 붙는 수**이고, `status` 로 좁혀도 달라지지 않는다.
   *
   * 목록과 함께 나가는 이유는 탭이 셋이기 때문이다. 각 탭이 자기 수를 따로 물으면
   * 화면 하나가 네 번 묻고, 그 넷은 서로 다른 순간의 답이라 합이 맞지 않을 수 있다.
   */
  counts: z.record(userCouponStatusSchema, z.int().min(0)),
  nextCursor: z.string().nullable(),
})

export type UserCouponListResponse = z.infer<typeof userCouponListResponseSchema>
