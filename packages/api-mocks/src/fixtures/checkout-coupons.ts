import type { ApplicableCoupon } from '@shopping/shared'
import { checkoutCouponsResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * 이 주문서에 쓸 수 있는 쿠폰과 추천 조합 (TASK-0075 의 화면이 읽는다).
 *
 * **못 쓰는 것까지 들어 있다.** 계약이 그렇게 정한 이유(F2)가 곧 이 픽스처가 열
 * 장이나 되는 이유다 — 목록에서 빼 버리면 「분명히 쿠폰이 있었는데 없어졌다」가
 * 되고, 그 사람이 다음에 할 일을 화면이 말해 줄 수 없다. 여섯 가지 거절 사유를
 * **하나씩** 넣어 둔 것은 화면이 그 여섯에 서로 다른 문장을 붙이는지를 검사가
 * 확인할 수 있게 하려는 것이다. 다섯 개만 있으면 빠진 하나는 아무 데서도 그려지지
 * 않은 채 통과한다.
 *
 * **쓸 수 있는 넉 장은 중복 규칙을 재현하려고 그렇게 짜였다** — 플랫폼 두 장과
 * 판매자 두 곳이다. 플랫폼이 한 장뿐이면 「두 번째 플랫폼 쿠폰이 첫 번째를
 * 밀어낸다」를 화면에서 만들어 낼 방법이 아예 없고, 판매자가 한 곳뿐이면 「다른
 * 판매자 쿠폰은 함께 쓴다」와 「같은 판매자 쿠폰은 밀어낸다」가 구분되지 않는다.
 *
 * **금액은 `shopperCheckout` 에서 나온 값이다.** 루미에르 425,000원 · 노드스텝
 * 49,000원 · 합계 474,000원 — 정률 쿠폰의 상한이 실제로 걸리는지가 그 숫자에
 * 달려 있다. 두 픽스처가 갈리면 「10% 쿠폰인데 3만원만 깎였다」가 확인할 수 없는
 * 사실이 된다.
 *
 * **`discountAmount` 는 「이 장 하나만 썼을 때」다** (계약). 여러 장이 같은 항목을
 * 겹쳐 덮어 잘리는 일은 여기서 재현하지 않는다 — 그것은 계산 엔진의 답이고,
 * 목이 흉내 내면 QUALITY-GATES 6장 이 금지하는 「더 약한 두 번째 구현」이 된다.
 */

/** `fixtures/checkout.ts` 의 두 판매자. 같은 주문서를 가리켜야 범위가 맞는다. */
const SELLER_A = '019596d0-1f1c-7c2e-9a0e-5a0000000001'
const SELLER_B = '019596d0-1f1c-7c2e-9a0e-5a0000000002'
/** 이 주문서에 없는 가게. `out_of_scope` 를 만드는 유일한 방법이다. */
const SELLER_C = '019596d0-1f1c-7c2e-9a0e-5a0000000003'

/** `sessionBuyer` 의 사용자. 쿠폰함은 사람마다 다르므로 주인이 있어야 한다. */
const USER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001'

/**
 * 발급 시각과 만료 시각.
 *
 * 주문서(`2026-09-05T04:15:00.000Z` 만료)를 여는 검사가 시스템 시각을 그 언저리로
 * 옮기므로, 살아 있는 쿠폰의 만료는 그보다 뒤이고 끝난 쿠폰의 만료는 앞이다.
 * 상대 시각으로 계산하면 픽스처가 실행할 때마다 달라져 「만료된 쿠폰」이 어느 날
 * 살아난다.
 */
const ISSUED_AT = '2026-09-01T00:00:00.000Z'
const VALID_FROM = '2026-09-01T00:00:00.000Z'
const VALID_UNTIL = '2026-09-30T14:59:59.000Z'
const ENDED_AT = '2026-08-31T14:59:59.000Z'
/** 아직 시작하지 않은 정책. **기다리면 되는** 거절이다. */
const STARTS_AT = '2026-10-01T00:00:00.000Z'

const USER_COUPON_IDS = {
  welcome: '019596d0-1f1c-7c2e-9a0e-6a0000000001',
  autumn: '019596d0-1f1c-7c2e-9a0e-6a0000000002',
  lumiere: '019596d0-1f1c-7c2e-9a0e-6a0000000003',
  nodestep: '019596d0-1f1c-7c2e-9a0e-6a0000000004',
  spent: '019596d0-1f1c-7c2e-9a0e-6a0000000005',
  ended: '019596d0-1f1c-7c2e-9a0e-6a0000000006',
  early: '019596d0-1f1c-7c2e-9a0e-6a0000000007',
  elsewhere: '019596d0-1f1c-7c2e-9a0e-6a0000000008',
  tooSmall: '019596d0-1f1c-7c2e-9a0e-6a0000000009',
  penny: '019596d0-1f1c-7c2e-9a0e-6a000000000a',
} as const

const COUPON_IDS = {
  welcome: '019596d0-1f1c-7c2e-9a0e-6b0000000001',
  autumn: '019596d0-1f1c-7c2e-9a0e-6b0000000002',
  lumiere: '019596d0-1f1c-7c2e-9a0e-6b0000000003',
  nodestep: '019596d0-1f1c-7c2e-9a0e-6b0000000004',
  spent: '019596d0-1f1c-7c2e-9a0e-6b0000000005',
  ended: '019596d0-1f1c-7c2e-9a0e-6b0000000006',
  early: '019596d0-1f1c-7c2e-9a0e-6b0000000007',
  elsewhere: '019596d0-1f1c-7c2e-9a0e-6b0000000008',
  tooSmall: '019596d0-1f1c-7c2e-9a0e-6b0000000009',
  penny: '019596d0-1f1c-7c2e-9a0e-6b000000000a',
} as const

/** 발행된 쿠폰 한 장을 쓰는 자리. 되풀이되는 열 칸을 한 번만 적는다. */
function coupon(fields: {
  readonly id: string
  readonly couponId: string
  readonly name: string
  readonly sellerId: string | null
  readonly discountType: 'FIXED' | 'PERCENT'
  readonly discountValue: number
  readonly maxDiscountAmount?: number | null
  readonly minOrderAmount?: number
  readonly scopeType: 'ALL' | 'CATEGORY' | 'PRODUCT' | 'SELLER'
  readonly scopeIds?: readonly string[]
  readonly status?: 'ISSUED' | 'USED' | 'EXPIRED'
  readonly expiresAt?: string
  readonly validFrom?: string
  readonly validUntil?: string
  readonly usedAt?: string | null
  readonly orderId?: string | null
}) {
  return {
    id: fields.id,
    couponId: fields.couponId,
    userId: USER_ID,
    status: fields.status ?? 'ISSUED',
    expiresAt: fields.expiresAt ?? VALID_UNTIL,
    issuedAt: ISSUED_AT,
    usedAt: fields.usedAt ?? null,
    orderId: fields.orderId ?? null,
    coupon: {
      id: fields.couponId,
      issuerType: fields.sellerId === null ? ('PLATFORM' as const) : ('SELLER' as const),
      sellerId: fields.sellerId,
      name: fields.name,
      code: null,
      discountType: fields.discountType,
      discountValue: fields.discountValue,
      maxDiscountAmount: fields.maxDiscountAmount ?? null,
      minOrderAmount: fields.minOrderAmount ?? 0,
      scopeType: fields.scopeType,
      scopeIds: [...(fields.scopeIds ?? [])],
      validFrom: fields.validFrom ?? VALID_FROM,
      validUntil: fields.validUntil ?? VALID_UNTIL,
      issueLimit: null,
      issuedCount: 1,
    },
  }
}

/**
 * 쓸 수 있는 넉 장 — 플랫폼 둘 · 판매자 둘.
 *
 * 플랫폼 두 장의 할인액이 다른 것(20,000 대 5,000)이 추천 조합의 근거다. 같으면
 * 「최대 할인」이 어느 쪽을 고르든 맞는 답이 되어, 추천이 실제로 계산된 것인지
 * 아무 쪽이나 집은 것인지 검사가 가릴 수 없다.
 */
const USABLE: readonly ApplicableCoupon[] = [
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.welcome,
      couponId: COUPON_IDS.welcome,
      name: '첫 주문 10% 할인',
      sellerId: null,
      discountType: 'PERCENT',
      discountValue: 10,
      // 474,000원의 10%는 47,400원이지만 상한이 먼저 걸린다. 상한 없는 정률만
      // 있으면 「상한이 실제로 적용되는가」를 화면 어디에서도 볼 수 없다.
      maxDiscountAmount: 20_000,
      scopeType: 'ALL',
    }),
    discountAmount: 20_000,
    fault: null,
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.autumn,
      couponId: COUPON_IDS.autumn,
      name: '가을 맞이 5천원',
      sellerId: null,
      discountType: 'FIXED',
      discountValue: 5_000,
      scopeType: 'ALL',
    }),
    discountAmount: 5_000,
    fault: null,
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.lumiere,
      couponId: COUPON_IDS.lumiere,
      name: '루미에르 10% 할인',
      sellerId: SELLER_A,
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: 30_000,
      scopeType: 'SELLER',
      scopeIds: [SELLER_A],
    }),
    discountAmount: 30_000,
    fault: null,
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.nodestep,
      couponId: COUPON_IDS.nodestep,
      name: '노드스텝 3천원',
      sellerId: SELLER_B,
      discountType: 'FIXED',
      discountValue: 3_000,
      scopeType: 'SELLER',
      scopeIds: [SELLER_B],
    }),
    discountAmount: 3_000,
    fault: null,
  },
]

/**
 * 못 쓰는 여섯 장 — 계약의 `couponApplicabilityFaults` 와 **일대일**이다.
 *
 * 순서도 계약의 순서다. 앞엣것이 뒤엣것을 가리므로(만료된 쿠폰에 「금액이
 * 모자라요」를 말하지 않는다), 목록이 그 순서를 지켜야 화면이 우선순위를 거꾸로
 * 그렸을 때 눈에 띈다.
 */
const UNUSABLE: readonly ApplicableCoupon[] = [
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.spent,
      couponId: COUPON_IDS.spent,
      name: '이미 쓴 1만원',
      sellerId: null,
      discountType: 'FIXED',
      discountValue: 10_000,
      scopeType: 'ALL',
      status: 'USED',
      usedAt: '2026-09-03T02:00:00.000Z',
      orderId: '019596d0-1f1c-7c2e-9a0e-5f0000000009',
    }),
    discountAmount: 0,
    fault: 'already_used',
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.ended,
      couponId: COUPON_IDS.ended,
      name: '여름 마감 5% 할인',
      sellerId: null,
      discountType: 'PERCENT',
      discountValue: 5,
      maxDiscountAmount: 10_000,
      scopeType: 'ALL',
      status: 'EXPIRED',
      expiresAt: ENDED_AT,
      validUntil: ENDED_AT,
    }),
    discountAmount: 0,
    fault: 'expired',
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.early,
      couponId: COUPON_IDS.early,
      name: '10월 오픈 2만원',
      sellerId: null,
      discountType: 'FIXED',
      discountValue: 20_000,
      scopeType: 'ALL',
      validFrom: STARTS_AT,
      validUntil: '2026-10-31T14:59:59.000Z',
      expiresAt: '2026-10-31T14:59:59.000Z',
    }),
    discountAmount: 0,
    fault: 'not_started',
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.elsewhere,
      couponId: COUPON_IDS.elsewhere,
      name: '아틀리에케이 15% 할인',
      sellerId: SELLER_C,
      discountType: 'PERCENT',
      discountValue: 15,
      maxDiscountAmount: 15_000,
      scopeType: 'SELLER',
      scopeIds: [SELLER_C],
    }),
    discountAmount: 0,
    fault: 'out_of_scope',
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.tooSmall,
      couponId: COUPON_IDS.tooSmall,
      name: '100만원 이상 5만원',
      sellerId: null,
      discountType: 'FIXED',
      discountValue: 50_000,
      minOrderAmount: 1_000_000,
      scopeType: 'ALL',
    }),
    discountAmount: 0,
    fault: 'below_minimum',
  },
  {
    userCoupon: coupon({
      id: USER_COUPON_IDS.penny,
      couponId: COUPON_IDS.penny,
      name: '노드스텝 1% 할인',
      sellerId: SELLER_B,
      discountType: 'PERCENT',
      discountValue: 1,
      // 닿기는 한다. 49,000원의 1%가 490원이므로 실제로는 깎이는데, 이 픽스처는
      // 「0원짜리」를 화면에 세우는 것이 목적이라 서버가 0으로 답한 경우를 든다 —
      // 어떤 조건에서 0이 되는지는 계산 엔진의 일이고 목이 재현할 것이 아니다.
      maxDiscountAmount: 100,
      scopeType: 'SELLER',
      scopeIds: [SELLER_B],
    }),
    discountAmount: 0,
    fault: 'no_discount',
  },
]

/**
 * `GET /checkouts/:id/coupons` 의 답.
 *
 * **추천은 세 장이다** — 플랫폼 최고액 한 장(20,000)과 판매자 둘(30,000 · 3,000).
 * 중복 규칙이 허락하는 최대이고, 합이 53,000원이다. `exhaustive` 가 `true` 인
 * 것은 조합이 넷뿐이라 전수 탐색으로 고른 답이라는 뜻이다.
 */
export const shopperCheckoutCoupons = defineFixture(checkoutCouponsResponseSchema, {
  coupons: [...USABLE, ...UNUSABLE],
  recommendation: {
    userCouponIds: [USER_COUPON_IDS.welcome, USER_COUPON_IDS.lumiere, USER_COUPON_IDS.nodestep],
    discountAmount: 20_000 + 30_000 + 3_000,
    exhaustive: true,
  },
})

/** 한 장도 없는 쿠폰함. 「쓸 쿠폰이 없다」는 화면도 그려져야 한다. */
export const emptyCheckoutCoupons = defineFixture(checkoutCouponsResponseSchema, {
  coupons: [],
  recommendation: { userCouponIds: [], discountAmount: 0, exhaustive: true },
})
