import type { CouponDiscountType, CouponScopeType } from '@shopping/shared'

/**
 * 쿠폰의 순수 판단 (TASK-0072 6.2, Q5 강화).
 *
 * **여기가 틀리면 조용하다.** 세 갈래가 각각 다른 방식으로 조용하다.
 *
 * - **판매자 범위**가 한 칸 넓으면 판매자가 낸 쿠폰이 남의 가게 매출을 깎고, 그
 *   부담은 정산일까지 아무 데도 나타나지 않는다. 이 TASK 의 절반이 그 한 칸이다.
 * - **정책의 짝**(정률 100 초과, 정액에 상한)이 새면 계산기가 그 주문에서 돈을
 *   **돌려주게** 되고, 그것은 오류가 아니라 잘못된 금액으로 나타난다.
 * - **발급 가능 판정**의 경계가 어긋나면 만료 배치와 서로 다른 순간을 기준으로
 *   답하게 되고, 그 사이에 발급된 쿠폰은 받자마자 만료된 채로 쿠폰함에 앉는다.
 *
 * 서비스와 나뉘어 있는 것은 `claims/claim-rules.ts` 와 같은 이유다 — `await` 가
 * 섞인 파일에 분기 100%를 걸면 닿을 수 없는 방어 분기가 생기고, 그것은 게이트를
 * 만족시키려고 코드를 나쁘게 만드는 일이다.
 *
 * **이 판단들은 DB 에도 있다** (`20260909010000_coupon/migration.sql`). 사본이
 * 아니라 겹이다: 화면이 먼저 막는 것은 친절이고, 서버가 막는 것은 규칙이며, DB 가
 * 막는 것은 API 를 직접 부르는 길까지 닫는 마지막 방어선이다.
 */

/** 발행 요청 하나가 거절되는 이유. 아래 {@link policyFault} 가 이 순서로 본다. */
export const couponPolicyFaults = [
  /** `ALL` 인데 대상이 딸려 왔다. */
  'scope_targets_forbidden',
  /** `ALL` 이 아닌데 대상이 없다 — 아무것에도 붙지 않는 쿠폰이다. */
  'scope_targets_required',
  /**
   * 판매자가 자기 가게 밖까지 덮는 범위를 골랐다.
   *
   * `ALL` 과 `CATEGORY` 둘 다다. 카테고리가 이름만 좁을 뿐 결과가 같은 것은
   * 카테고리가 **플랫폼 공용**이기 때문이다 — 「셔츠 10%」를 낸 판매자가 다른
   * 가게의 셔츠까지 물게 된다.
   */
  'seller_scope_too_wide',
  /** 판매자가 **남의 가게**를 범위로 골랐다. */
  'seller_scope_foreign',
  /** 정률이 1~100 밖이다. 100 은 전액이고 그것을 넘는 수는 존재하지 않는다. */
  'percent_out_of_range',
  /** 정액에 상한을 걸었다. 뜻이 없는 값이라 읽는 쪽이 해석하려 든다. */
  'max_discount_meaningless',
  /** 시작이 끝보다 뒤다. 아무도 쓸 수 없는 쿠폰이다. */
  'period_inverted',
] as const

export type CouponPolicyFault = (typeof couponPolicyFaults)[number]

/**
 * 거절이 가리키는 입력의 이름.
 *
 * `details[]` 에 실려 화면의 그 칸에 문장이 붙는다. 표로 두는 이유는 이것이
 * **분기가 아니라 대응**이기 때문이다 — `switch` 로 적으면 이유가 하나 늘 때
 * 기본 갈래가 그것을 삼키고, 그때 실패는 어느 칸에도 붙지 않은 채 화면 위쪽의
 * 배너가 된다.
 */
export const couponPolicyFaultFields: Readonly<Record<CouponPolicyFault, string>> = {
  scope_targets_forbidden: 'scopeIds',
  scope_targets_required: 'scopeIds',
  seller_scope_too_wide: 'scopeType',
  seller_scope_foreign: 'scopeIds',
  percent_out_of_range: 'discountValue',
  max_discount_meaningless: 'maxDiscountAmount',
  period_inverted: 'validUntil',
}

/** 발행 요청에서 판단에 쓰이는 부분. 이름·수량처럼 짝이 없는 값은 스키마가 본다. */
export interface CouponPolicyInput {
  /** `null` 이면 플랫폼 쿠폰. 그 자체가 부담 주체다. */
  readonly sellerId: string | null
  readonly discountType: CouponDiscountType
  readonly discountValue: number
  readonly maxDiscountAmount: number | null
  readonly scopeType: CouponScopeType
  readonly scopeIds: readonly string[]
  readonly validFrom: Date
  readonly validUntil: Date
}

/** 판매자 쿠폰이 가질 수 있는 범위. 나머지는 남의 매출을 덮는다. */
const SELLER_SCOPES: readonly CouponScopeType[] = ['SELLER', 'PRODUCT']

/** 대상이 uuid 인 범위. 카테고리만 정수라 여기 없다. */
const UUID_SCOPES: readonly CouponScopeType[] = ['SELLER', 'PRODUCT']

/**
 * 범위 대상을 저장할 모양으로 고른다 — **중복을 빼고, uuid 는 소문자로.**
 *
 * `scopeIds` 가 텍스트 배열이라 대소문자가 다른 두 문자열이 **같은 대상을 가리키면서
 * 다른 값**이 된다. 그 순간 세 곳이 서로 다른 답을 낸다: `Coupon_seller_scope_check`
 * 는 `"sellerId"::text`(Postgres 의 표준형, 소문자)와 견주므로 대문자로 온 uuid 를
 * 거절하고, 적용(TASK-0075)의 `= ANY(scopeIds)` 는 못 찾으며, 서버의 비교는 통과한다.
 * 셋 중 어느 것도 「대소문자」라고 말해 주지 않는다.
 *
 * 중복을 빼는 것도 같은 종류다. `['s1','s1']` 은 `ARRAY['s1']` 과 다른 배열이라
 * 위 CHECK 에서 거절되는데, 발행자가 대상을 두 번 고른 것뿐이다.
 */
export function canonicalScopeIds(
  scopeType: CouponScopeType,
  scopeIds: readonly string[],
): readonly string[] {
  const cased = UUID_SCOPES.includes(scopeType)
    ? scopeIds.map((id) => id.toLowerCase())
    : [...scopeIds]

  return [...new Set(cased)]
}

/**
 * 판매자 쿠폰의 범위를 강제한다.
 *
 * **플랫폼 쿠폰에는 아무 제한이 없다** — 부담이 플랫폼이므로 전체든 카테고리든
 * 자기 돈이다. 제한이 판매자에게만 붙는 이유가 그것이고, 그래서 이 함수는
 * `sellerId` 가 `null` 이면 아무 말도 하지 않는다.
 *
 * `SELLER` 범위의 대상이 **자기 자신인지**까지 여기서 본다. DB 도 같은 것을 보고
 * (`Coupon_seller_scope_check`), 그쪽은 두 값이 한 행에 있어서 CHECK 로 표현된다.
 * `PRODUCT` 범위의 상품이 실제로 그 가게 것인지는 조인이 필요해 여기서도 DB 에서도
 * 잴 수 없다 — 그 절반은 서비스가 확인한다.
 */
export function sellerScopeFault(
  input: Pick<CouponPolicyInput, 'sellerId' | 'scopeType' | 'scopeIds'>,
): CouponPolicyFault | null {
  if (input.sellerId === null) return null

  if (!SELLER_SCOPES.includes(input.scopeType)) return 'seller_scope_too_wide'

  if (input.scopeType === 'SELLER' && input.scopeIds.some((id) => id !== input.sellerId)) {
    return 'seller_scope_foreign'
  }

  return null
}

/**
 * 발행 요청 하나가 거절되는 첫 번째 이유. 받아도 되면 `null`.
 *
 * **순서가 있다.** 범위의 구조(대상이 있어야 하는가)를 먼저 보는 이유는 그 다음
 * 판단이 대상 배열을 읽기 때문이고, 그것을 뒤집으면 「대상이 비었다」와 「남의
 * 가게다」가 같은 요청에서 순서에 따라 갈린다. 판매자 범위를 금액보다 먼저 보는
 * 이유는 **사람이 할 일이 다르기** 때문이다 — 「할인율을 고치세요」를 받은 판매자는
 * 그것을 고쳐 다시 시도하고, 또 거절당한다.
 */
export function policyFault(input: CouponPolicyInput): CouponPolicyFault | null {
  const empty = input.scopeIds.length === 0

  if (input.scopeType === 'ALL') {
    if (!empty) return 'scope_targets_forbidden'
  } else if (empty) return 'scope_targets_required'

  const scope = sellerScopeFault(input)

  if (scope !== null) return scope

  if (input.discountType === 'PERCENT') {
    if (input.discountValue < 1 || input.discountValue > 100) return 'percent_out_of_range'
  } else if (input.maxDiscountAmount !== null) return 'max_discount_meaningless'

  return input.validFrom < input.validUntil ? null : 'period_inverted'
}

/** 발급이 거절되는 이유 중 **기간**에 관한 것. 수량은 갱신이 판단한다. */
export type CouponIssuabilityFault = 'not_started' | 'ended'

/** 유효기간을 가진 무엇이든. 정책(`Coupon`)과 발급된 장(`UserCoupon`) 둘 다 온다. */
export interface CouponPeriod {
  readonly validFrom: Date
  readonly validUntil: Date
}

/**
 * 지금 발급받을 수 있는 기간인가.
 *
 * **둘을 하나로 묶지 않는 이유는 사람이 할 일이 다르기 때문이다.** 아직 시작하지
 * 않은 쿠폰은 기다리면 되고, 끝난 쿠폰은 기다려도 안 된다. 한 코드로 답하면
 * 화면은 둘 중 하나를 반드시 틀리게 말한다.
 *
 * **끝이 열린 구간이다** (`now >= validUntil` 이면 끝). 만료 배치가 쓰는 조건
 * (`"expiresAt" <= now`)과 같은 순간을 가리켜야 하고, 어긋나면 그 한 밀리초 동안
 * 발급된 쿠폰이 **받자마자 만료된 채로** 쿠폰함에 앉는다. `coupon-rules.spec.ts`
 * 가 그 등식을 단언한다.
 */
export function issuabilityFault(period: CouponPeriod, now: Date): CouponIssuabilityFault | null {
  if (now.getTime() < period.validFrom.getTime()) return 'not_started'

  return now.getTime() >= period.validUntil.getTime() ? 'ended' : null
}

/**
 * 발급 수량이 다 찼는가.
 *
 * **판단이 아니라 설명이다.** 실제로 막는 것은 조건부 갱신 한 문장이고
 * (`CouponService.takeIssueSlot`), 이 함수는 그 갱신이 0행을 고친 **뒤에** 이유를
 * 가리기 위해 불린다 — 중복 발급도 0행을 만들 수 있기 때문이다. 성공하는 길에는
 * 이 함수가 없다 (`ReservationService.explainRefusal` 과 같은 나눔).
 */
export function issueExhausted(issueLimit: number | null, issuedCount: number): boolean {
  return issueLimit !== null && issuedCount >= issueLimit
}
