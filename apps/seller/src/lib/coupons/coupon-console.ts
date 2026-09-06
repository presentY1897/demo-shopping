import type { Coupon, CouponLifecycle, CouponListEntry, CouponScopeType } from '@shopping/shared'

/**
 * 판매자 쿠폰 화면의 판단들 — **전부 순수 함수다** (TASK-0074).
 *
 * 컴포넌트 안에 두지 않는 이유는 이것들이 **분기를 가진 결정**이기 때문이다
 * (`lib/products/product-failures.ts` 가 같은 자리에서 같은 문장을 적어 두었다).
 * 특히 예상 부담액은 「경계가 없다」는 답을 낼 수 있는 계산이라, 그 갈래가 화면을
 * 렌더링해야만 닿을 수 있는 곳에 있으면 아무도 그것을 검사하지 않는다 —
 * QUALITY-GATES Q5 가 순수 로직에 분기 커버리지 100% 를 거는 이유가 그것이다.
 */

/**
 * 판매자가 낼 수 있는 범위 — **둘뿐이다** (F1).
 *
 * `ALL` 은 남의 매출에까지 자기 부담을 넣는 일이고, `CATEGORY` 는 카테고리가 플랫폼
 * 공용이라 이름만 좁을 뿐 결과가 같다 — 「셔츠 10%」를 낸 판매자가 다른 가게의
 * 셔츠까지 물게 된다. 서버가 막고 DB 도 막지만(`Coupon_seller_scope_check`),
 * **화면이 내놓지 않는 것**이 먼저다: 고를 수 있게 해 놓고 거절하는 것은 무엇을
 * 잘못했는지 알려 주지 않는 화면이다.
 *
 * `satisfies` 로 계약의 유니온에 묶는다. 계약에서 이름이 바뀌면 여기가
 * `pnpm typecheck` 에서 걸리고, 그때 이 목록을 다시 읽게 된다.
 */
export const SELLER_COUPON_SCOPE_TYPES = [
  'SELLER',
  'PRODUCT',
] as const satisfies readonly CouponScopeType[]

export type SellerCouponScopeType = (typeof SELLER_COUPON_SCOPE_TYPES)[number]

/** 셀렉트가 돌려준 문자열이 판매자가 고를 수 있는 범위인가. */
export function isSellerCouponScopeType(value: string): value is SellerCouponScopeType {
  return SELLER_COUPON_SCOPE_TYPES.some((scope) => scope === value)
}

/**
 * 예상 최대 부담 (F3).
 *
 * **세 갈래이고, 셋 다 다른 문장을 받는다.**
 *
 * | | 언제 | 화면이 하는 말 |
 * | --- | --- | --- |
 * | `bounded` | 장당 최대 할인액과 발급 수량이 둘 다 정해졌다 | 「100장 × 5,000원 = 500,000원」 |
 * | `unbounded` | 둘 중 하나에 경계가 없다 | 왜 계산할 수 없는지 |
 * | `unknown` | 아직 할인액을 입력하지 않았다 | 아무것도 — 채우면 나타난다 |
 *
 * **`unbounded` 를 0원이나 「-」 로 접지 않는 것이 이 함수의 이유다.** 상한 없는
 * 정률 쿠폰의 최대 부담은 큰 수가 아니라 **없는 수**이고, 거기에 숫자를 적으면 그
 * 숫자가 곧 「이만큼만 나가겠구나」가 된다 — TASK-0074 4장이 막으려는 오해가 정확히
 * 그것이다.
 */
export type CouponLiability =
  | {
      readonly kind: 'bounded'
      readonly issueLimit: number
      /** 한 장이 최대로 깎을 수 있는 금액. 정액이면 할인액, 정률이면 그 상한이다. */
      readonly perVoucher: number
      readonly total: number
    }
  | { readonly kind: 'unbounded'; readonly reason: CouponLiabilityUnbounded }
  | { readonly kind: 'unknown' }

/**
 * 경계가 없는 두 가지 이유. **각각 고치는 곳이 다르다.**
 *
 * `noDiscountCeiling` 은 정률 쿠폰에 최대 할인 금액이 없는 것이고,
 * `unlimitedIssue` 는 발급 수량이 무제한인 것이다 — 하나로 접으면 화면은 어느 칸을
 * 채우라고 말할지 정하지 못한다.
 */
export type CouponLiabilityUnbounded = 'noDiscountCeiling' | 'unlimitedIssue'

export interface CouponLiabilityInput {
  /** 아직 고르지 않았으면 `null`. 폼의 첫 프레임이 그렇다. */
  readonly discountType: Coupon['discountType'] | null
  /** `FIXED` 면 원, `PERCENT` 면 퍼센트. 읽히지 않는 입력은 `null`. */
  readonly discountValue: number | null
  /** 정률의 상한. **`null` 은 「상한 없음」이라는 뜻이지 미입력이 아니다.** */
  readonly maxDiscountAmount: number | null
  /** 발급 수량. **`null` 은 계약이 정한 「무제한」이다** (`issueLimit`). */
  readonly issueLimit: number | null
}

/** 금액으로 쓸 수 있는 수인가 — 정수이고, 1원 이상. */
function isAmount(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0
}

/**
 * 발급 수량 × 장당 최대 할인액.
 *
 * 순서가 설계다.
 *
 * 1. **장당 얼마인지 모르면 아무 말도 하지 않는다.** 할인액을 아직 입력하지 않은
 *    폼에 「상한이 없습니다」를 띄우면, 그것은 경고가 아니라 소음이다.
 * 2. **정률에 상한이 없으면 거기서 끝난다.** 곱할 첫 번째 수가 없으므로 수량을 봐도
 *    소용이 없고, 채워야 할 칸은 상한 쪽이다.
 * 3. **수량이 무제한이면 곱할 두 번째 수가 없다.** 정액 5,000원 쿠폰이라도 몇 장이
 *    나갈지 모르면 최대 부담은 없는 수다.
 */
export function estimateCouponLiability(input: CouponLiabilityInput): CouponLiability {
  if (input.discountType === null || !isAmount(input.discountValue)) return { kind: 'unknown' }

  // 정액의 장당 최대는 할인액 그 자체다. **주문금액이 그보다 작으면 덜 깎이므로**
  // 실제 부담은 이보다 작을 수 있고, 그래서 이것은 「최대」다.
  const perVoucher = input.discountType === 'FIXED' ? input.discountValue : input.maxDiscountAmount

  if (!isAmount(perVoucher)) return { kind: 'unbounded', reason: 'noDiscountCeiling' }
  if (!isAmount(input.issueLimit)) return { kind: 'unbounded', reason: 'unlimitedIssue' }

  return {
    kind: 'bounded',
    issueLimit: input.issueLimit,
    perVoucher,
    total: perVoucher * input.issueLimit,
  }
}

/** 목록 한 페이지가 지금까지 만든 것. */
export interface CouponLiabilityTotals {
  readonly usedCount: number
  readonly discountTotal: number
}

/**
 * 화면에 떠 있는 줄들의 합 (F5).
 *
 * **이 페이지의 합이지 이 스토어의 합이 아니다.** 계약에 발행자별 누계를 답하는
 * 자리가 없고(`GET /coupons` 는 줄마다의 `stats` 만 싣는다), 없는 것을 합쳐 놓고
 * 「전체」라고 부르면 두 번째 페이지를 넘긴 사람이 줄어든 숫자를 보게 된다. 화면은
 * 이 값을 **이 페이지의 것**이라고 말한다.
 */
export function couponLiabilityTotals(entries: readonly CouponListEntry[]): CouponLiabilityTotals {
  return entries.reduce<CouponLiabilityTotals>(
    (totals, entry) => ({
      usedCount: totals.usedCount + entry.stats.usedCount,
      discountTotal: totals.discountTotal + entry.stats.discountTotal,
    }),
    { usedCount: 0, discountTotal: 0 },
  )
}

/**
 * 중단·재개 버튼을 낼 수 있는 줄인가.
 *
 * **기간이 끝난 쿠폰에는 되돌릴 것이 없다.** `PATCH` 는 `suspendedAt` 하나만
 * 움직이는데, 이미 `ENDED` 인 쿠폰은 그 칸을 비워도 여전히 `ENDED` 다 — 눌러도 아무
 * 일이 일어나지 않는 버튼을 내놓는 것은, 판매자에게 「다시 열 수 있다」고 거짓말을
 * 하는 것이다.
 */
export function canToggleIssuing(lifecycle: CouponLifecycle): boolean {
  return lifecycle !== 'ENDED'
}

/** 지금 발행이 멈춰 있는가. 다음에 보낼 `suspended` 는 이것의 반대다. */
export function isSuspended(coupon: Coupon): boolean {
  return coupon.suspendedAt !== null
}
