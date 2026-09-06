import type {
  AppliedCoupon,
  CouponApplicabilityFault,
  CouponDiscountType,
  CouponIssuerType,
  CouponRecommendation,
  CouponScopeType,
  CouponSelectionFault,
  PricingDiscount,
  PricingItem,
  ShippingPolicy,
  UserCouponStatus,
} from '@shopping/shared'
import { allocate, calculateOrder } from '@shopping/shared'

/**
 * 쿠폰을 주문서에 얹는 판단 (TASK-0075 6.2, Q5 강화).
 *
 * **이 TASK 의 성공 기준은 계산기를 고치지 않는 것이다** (F1). M07 이 `discounts`
 * 를 목록으로 받게 설계한 이유가 여기서 검증되므로, 이 파일이 하는 일은 전부
 * 「쿠폰 한 장을 계산기가 아는 모양으로 옮기는 것」이다 — 깎는 일은 계산기가 한다.
 *
 * `coupon-rules.ts` 와 나뉘어 있는 것은 **묻는 질문이 다르기** 때문이다. 저쪽은
 * 「이 쿠폰을 발행해도 되는가」이고 여기는 「이 주문서에 이 쿠폰이 닿는가」다. 한
 * 파일에 두면 발행 화면이 주문서의 규칙을 들고 다니게 된다.
 *
 * **여기가 틀리면 조용하다.** 세 갈래가 각각 다르게 조용하다.
 *
 * - **범위 판정**이 한 칸 넓으면 판매자 쿠폰이 남의 가게 항목을 깎는다. 사는 사람의
 *   화면에는 아무 이상이 없고, 그 부담은 정산일에 남의 정산액에서 나타난다.
 * - **기준 금액**이 갈리면 「최소 주문금액은 넘었는데 할인이 0원」이 생긴다. 오류가
 *   아니라 금액으로 나타나므로 아무도 신고하지 않는다.
 * - **추천 조합**이 총 할인액만 보면 무료배송을 잃는 조합을 권한다 — 쿠폰을 더
 *   썼는데 **더 내는** 화면이고, 그것을 만든 것은 우리다.
 */

/**
 * 계산에 들어가는 한 줄 — 쿠폰이 닿는지 판정하는 데 필요한 것까지.
 *
 * `PricingItem` 을 넓힌 이유는 **두 계산이 같은 줄에서 나와야** 하기 때문이다.
 * 쿠폰 판정용 배열을 따로 만들면 그 배열과 계산기에 들어가는 배열이 갈리는 날이
 * 오고, 그때 「보여 준 할인」과 「빠진 할인」이 다른 항목을 가리킨다.
 */
export interface CouponLine extends PricingItem {
  readonly productId: string
  /**
   * 이 항목이 속한 카테고리와 그 조상들 — `/1/5/12/`.
   *
   * 카테고리 범위 쿠폰이 **하위 카테고리까지 덮는** 근거다. 「셔츠」 쿠폰이
   * 「반팔 셔츠」에 안 붙으면 발행자는 잎 카테고리를 전부 나열해야 하고, 나중에
   * 추가된 잎은 아무도 다시 나열해 주지 않는다.
   */
  readonly categoryPath: string
}

/**
 * 판정에 쓰이는 쿠폰 한 장 — 정책(`Coupon`)과 발급된 장(`UserCoupon`)이 합쳐진 모양.
 *
 * 두 표에서 오지만 한 값인 이유는 **판정이 둘을 함께 봐야** 하기 때문이다: 만료는
 * 발급된 장의 사실(`expiresAt`, 발급 시점의 스냅샷)이고 할인율은 정책의 사실이다.
 */
export interface CouponCandidate {
  readonly userCouponId: string
  readonly couponId: string
  readonly name: string
  readonly issuerType: CouponIssuerType
  /** 판매자 쿠폰일 때만. 중복 규칙이 이 값으로 「판매자당 한 장」을 센다. */
  readonly sellerId: string | null
  readonly status: UserCouponStatus
  readonly expiresAt: Date
  readonly validFrom: Date
  readonly discountType: CouponDiscountType
  readonly discountValue: number
  readonly maxDiscountAmount: number | null
  readonly minOrderAmount: number
  readonly scopeType: CouponScopeType
  readonly scopeIds: readonly string[]
}

/** 한 줄의 상품금액 (①). 쿠폰 판정의 모든 기준이 이 값에서 나온다. */
function productAmountOf(line: CouponLine): number {
  return line.unitPrice * line.quantity
}

/** 여러 줄의 상품금액 합. */
function baseOf(lines: readonly CouponLine[]): number {
  return lines.reduce((sum, line) => sum + productAmountOf(line), 0)
}

/**
 * 이 쿠폰이 이 줄에 닿는가.
 *
 * `CATEGORY` 만 포함 관계다. 나머지 셋은 「그 id 인가」로 끝나지만 카테고리는
 * **조상이어도 닿아야** 하고, 그 판정을 재귀 없이 하려고 `Category.path` 가 있다
 * (`schema.prisma` 의 그 컬럼 주석). `/12/` 로 감싸 견주는 것이 핵심이다 — 감싸지
 * 않으면 카테고리 1이 11 · 21 · 120 에까지 붙는다.
 */
function reaches(coupon: CouponCandidate, line: CouponLine): boolean {
  if (coupon.scopeType === 'ALL') return true
  if (coupon.scopeType === 'SELLER') return coupon.scopeIds.includes(line.sellerId)
  if (coupon.scopeType === 'PRODUCT') return coupon.scopeIds.includes(line.productId)

  return coupon.scopeIds.some((id) => line.categoryPath.includes(`/${id}/`))
}

/** 이 주문서에서 이 쿠폰이 닿는 줄들. */
export function reachOf(
  coupon: CouponCandidate,
  lines: readonly CouponLine[],
): readonly CouponLine[] {
  return lines.filter((line) => reaches(coupon, line))
}

/**
 * 이 쿠폰이 이 금액에서 깎는 액수.
 *
 * **기준 금액은 쿠폰이 닿는 줄의 상품금액(①)이다** — 다른 쿠폰의 할인을 빼기
 * 전이다. 그래야 고른 순서와 무관한 값이 되고, 순서에 따라 달라지는 값 위에서는
 * 「최대 할인 조합」이라는 말 자체가 정의되지 않는다.
 *
 * 마지막에 기준 금액으로 한 번 더 자르는 것은 **정액 쿠폰 때문**이다. 3,000원짜리
 * 항목 하나에 닿는 5,000원 쿠폰을 목록이 「5,000원 할인」으로 그리면, 고른 사람은
 * 2,000원이 어디로 갔는지 묻게 된다. 계산기도 같은 자리를 자르지만(`room`) 그것은
 * 저장될 금액을 지키는 일이고, 이것은 **보여 줄 금액**을 지키는 일이다.
 */
export function discountOf(coupon: CouponCandidate, base: number): number {
  return Math.min(rawDiscountOf(coupon, base), base)
}

function rawDiscountOf(coupon: CouponCandidate, base: number): number {
  if (coupon.discountType === 'FIXED') return coupon.discountValue

  const percent = Math.floor((base * coupon.discountValue) / 100)

  return coupon.maxDiscountAmount === null ? percent : Math.min(percent, coupon.maxDiscountAmount)
}

/** 한 장을 이 주문서에 대고 본 결과. */
export interface CouponVerdict {
  /** 못 쓰는 이유. `null` 이면 쓸 수 있다. */
  readonly fault: CouponApplicabilityFault | null
  /** **이 장만 썼을 때** 깎이는 금액. 못 쓰면 0이다. */
  readonly discountAmount: number
  /** 닿는 줄들. 거절이 범위 판정보다 앞에서 났으면 비어 있다. */
  readonly reach: readonly CouponLine[]
}

/**
 * 한 장을 판정한다 (F2).
 *
 * **순서가 규칙이다.** 앞엣것이 뒤엣것을 가리도록 세웠다 — 만료된 쿠폰에
 * 「10,000원 이상부터 쓸 수 있어요」라고 답하면 사람은 장바구니를 채우러 갔다가
 * 같은 자리에서 다시 거절당한다. 상태 → 기간 → 범위 → 금액 순인 것은 **바꿀 수
 * 있는 것이 뒤에 오도록** 한 것이다: 앞의 셋은 이 사람이 지금 할 수 있는 일이
 * 없고, 마지막 둘만 장바구니를 고쳐 넘길 수 있다.
 *
 * 만료를 `status` 와 시각 둘 다로 보는 이유는 **배치가 1분마다 돌기** 때문이다
 * (`coupon-expiry.ts`). 그 사이에 만료된 장은 아직 `ISSUED` 이고, 시각을 보지
 * 않으면 주문서가 그것을 쓸 수 있는 쿠폰으로 그린다.
 */
export function evaluateCoupon(
  coupon: CouponCandidate,
  lines: readonly CouponLine[],
  now: Date,
): CouponVerdict {
  const refused = (fault: CouponApplicabilityFault): CouponVerdict => ({
    fault,
    discountAmount: 0,
    reach: [],
  })

  if (coupon.status === 'USED') return refused('already_used')
  if (coupon.status === 'EXPIRED') return refused('expired')
  if (now.getTime() >= coupon.expiresAt.getTime()) return refused('expired')
  if (now.getTime() < coupon.validFrom.getTime()) return refused('not_started')

  const reach = reachOf(coupon, lines)

  if (reach.length === 0) return refused('out_of_scope')

  const base = baseOf(reach)

  if (base < coupon.minOrderAmount) return refused('below_minimum')

  const discountAmount = discountOf(coupon, base)

  // 0원짜리를 「쓸 수 있음」으로 내려보내면 사람이 그것을 골라 **한 장을 태운다.**
  // 1% 쿠폰이 50원짜리 하나에만 닿는 경우가 그렇다 — `floor` 가 0을 낸다.
  if (discountAmount === 0) return { fault: 'no_discount', discountAmount: 0, reach }

  return { fault: null, discountAmount, reach }
}

/**
 * 고른 조합이 중복 규칙을 어겼는가 (F4).
 *
 * **플랫폼 한 장 + 판매자당 한 장** (`docs/design/pricing.md` 4장). 플랫폼끼리
 * 중복이 안 되는 이유는 부담이 한 주머니에서 나오기 때문이고, 판매자별로 한 장인
 * 이유는 각 판매자가 자기 몫에만 부담을 지기 때문이다 — 판매자 A 의 쿠폰 두 장은
 * A 의 정산에서 두 번 빠진다.
 */
export function selectionFault(selected: readonly CouponCandidate[]): CouponSelectionFault | null {
  const platform = selected.filter((coupon) => coupon.issuerType === 'PLATFORM')

  if (platform.length > 1) return 'duplicate_platform'

  const sellers = selected
    .filter((coupon) => coupon.issuerType === 'SELLER')
    .map((coupon) => coupon.sellerId)

  return new Set(sellers).size === sellers.length ? null : 'duplicate_seller'
}

/**
 * 적용 순서 — **플랫폼 먼저, 그다음 판매자.**
 *
 * 대개는 순서가 답을 바꾸지 않는다. 바뀌는 것은 두 쿠폰이 같은 항목을 덮고 그 합이
 * 상품금액을 넘을 때뿐이고, 그때 뒤엣것은 남은 만큼만 깎인다(계산기의 `room`).
 * 그래도 순서를 못박는 이유는 **저장되는 금액이 입력 순서에 따라 달라지면 안 되기**
 * 때문이다 — 화면이 고른 순서대로 보내면 같은 조합이 다른 주문에서 다른 정산을
 * 만든다.
 *
 * 플랫폼이 먼저인 것은 **판매자 쪽이 잘리는 편이 낫기** 때문이다. 잘린 몫은 부담
 * 주체가 물지 않은 금액이고, 판매자 쿠폰이 잘리면 그 판매자의 정산 차감이 줄어든다 —
 * 반대로 두면 플랫폼이 광고한 「5,000원 할인」이 판매자 쿠폰 때문에 3,000원으로
 * 줄어든 채 사는 사람의 화면에 남는다.
 */
export function orderedSelection(selected: readonly CouponCandidate[]): readonly CouponCandidate[] {
  return [...selected].sort((a, b) => rankOf(a) - rankOf(b))
}

function rankOf(coupon: CouponCandidate): number {
  return coupon.issuerType === 'PLATFORM' ? 0 : 1
}

/**
 * 쿠폰 한 장을 계산기가 아는 할인 항목으로 옮긴다 (F1 · F3).
 *
 * 계산기의 범위는 셋뿐이다 — `ORDER` · `SELLER` · `ITEM`. 쿠폰의 범위는 넷이고
 * (`ALL` · `CATEGORY` · `PRODUCT` · `SELLER`) **`CATEGORY` 와 `PRODUCT` 는 셋 중
 * 어느 것도 아니다**: 주문의 일부 항목만, 그것도 여러 판매자에 걸쳐 가리킬 수 있다.
 *
 * 그래서 세 갈래다.
 *
 * 1. 닿는 것이 **주문 전체**면 `ORDER` 한 줄.
 * 2. 닿는 것이 **어느 판매자의 전부**면 `SELLER` 한 줄.
 * 3. 그 밖이면 우리가 안분해서 **줄마다 `ITEM` 한 줄**.
 *
 * 앞의 둘을 굳이 남긴 이유는 **계산기가 하는 안분이 우리가 하는 안분보다 낫기**
 * 때문이다. 계산기는 그룹 전체를 한 번에 나누므로 어느 항목이 한도에 걸리면 남은
 * 몫을 형제 항목으로 돌린다. 3번은 그 재분배를 할 수 없다 — 이미 나뉜 뒤라 각 줄이
 * 독립이다. 그 차이는 두 쿠폰이 같은 항목을 덮어 한도가 실제로 걸릴 때만 드러나고,
 * 드러나는 방향은 언제나 **덜 깎이는 쪽**이다.
 *
 * 3번의 안분에 계산기와 같은 `allocate` 를 쓰는 것이 F8(안분 합계 = 쿠폰 할인액)을
 * 지키는 자리다. 잔여를 버리지 않는 규칙이 두 곳에 따로 구현되면 1원이 어긋난다.
 */
export function toPricingDiscounts(
  coupon: CouponCandidate,
  amount: number,
  reach: readonly CouponLine[],
  lines: readonly CouponLine[],
): readonly PricingDiscount[] {
  const bearer = coupon.issuerType

  if (reach.length === lines.length) {
    return [{ id: coupon.userCouponId, type: 'COUPON', scope: 'ORDER', amount, bearer }]
  }

  const whole = [...groupBySeller(lines)].find(
    ([, own]) => own.length === reach.length && own.every((line) => reach.includes(line)),
  )

  if (whole !== undefined) {
    return [
      {
        id: coupon.userCouponId,
        type: 'COUPON',
        scope: 'SELLER',
        targetId: whole[0],
        amount,
        bearer,
      },
    ]
  }

  return (
    allocate(
      amount,
      reach.map((line) => {
        const cap = productAmountOf(line)

        return { item: line, weight: cap, cap }
      }),
    )
      // 0원짜리 항목 할인은 계산기에 아무 일도 시키지 않으면서 저장될 목록만 늘린다.
      .filter((share) => share.amount > 0)
      .map((share) => ({
        id: `${coupon.userCouponId}:${share.item.itemId}`,
        type: 'COUPON' as const,
        scope: 'ITEM' as const,
        targetId: share.item.itemId,
        amount: share.amount,
        bearer,
      }))
  )
}

function groupBySeller(lines: readonly CouponLine[]): ReadonlyMap<string, CouponLine[]> {
  const groups = new Map<string, CouponLine[]>()

  for (const line of lines) {
    const held = groups.get(line.sellerId)

    if (held === undefined) {
      groups.set(line.sellerId, [line])
      continue
    }

    held.push(line)
  }

  return groups
}

/** 고른 쿠폰들을 계산기에 넘길 목록으로 편 결과. */
export interface CouponApplication {
  /** `calculateOrder` 의 `discounts` 로 그대로 들어간다. */
  readonly discounts: readonly PricingDiscount[]
  /** 장별로 **실제로** 깎인 금액. 전부 더하면 주문의 쿠폰 할인액이다. */
  readonly applied: readonly AppliedCoupon[]
}

/**
 * 고른 쿠폰 전부를 적용한다 (F6 · F8).
 *
 * **장별 금액을 계산기에게 묻는 방법이 이 함수의 전부다.** 계산기는 「쿠폰 할인
 * 합계」만 답하고 어느 장이 얼마를 깎았는지는 말하지 않는데, 정산(M12)이 필요로
 * 하는 것은 정확히 그 나눔이다 — 판매자 부담 쿠폰의 안분액만 그 판매자의 정산에서
 * 빠진다(`pricing.md` 6장).
 *
 * 그래서 **앞에서부터 하나씩 더해 가며 합계의 증분을 읽는다.** k번째 장의 몫은
 * 「k장까지 넣었을 때의 합계 − (k−1)장까지의 합계」다. 계산기가 순서대로 적용하고
 * 각 장이 남은 금액까지만 깎으므로 이 증분이 곧 그 장이 실제로 깎은 금액이고, 증분
 * 들의 합은 정의상 전체 합계와 같다. 계산기를 고쳐 장별 결과를 내게 하는 길도
 * 있었지만, **그것이 F1 이 금지하는 일**이다.
 *
 * 계산기를 n+1번 부르는 비용은 순수한 정수 산술이고 n 은 「플랫폼 하나 + 판매자당
 * 하나」라 작다.
 */
export function applyCoupons(
  selected: readonly CouponCandidate[],
  lines: readonly CouponLine[],
  policies: readonly ShippingPolicy[],
  now: Date,
): CouponApplication {
  const discounts: PricingDiscount[] = []
  const applied: AppliedCoupon[] = []
  let through = 0

  for (const coupon of orderedSelection(selected)) {
    const verdict = evaluateCoupon(coupon, lines, now)

    discounts.push(...toPricingDiscounts(coupon, verdict.discountAmount, verdict.reach, lines))

    const total = calculateOrder({
      items: lines,
      discounts,
      shippingPolicies: policies,
    }).totalCouponDiscountAmount

    applied.push({
      userCouponId: coupon.userCouponId,
      couponId: coupon.couponId,
      name: coupon.name,
      issuerType: coupon.issuerType,
      discountAmount: total - through,
    })
    through = total
  }

  return { discounts, applied }
}

/**
 * 전수 탐색을 포기하는 지점 (R2).
 *
 * 조합의 수는 `∏(그룹 크기 + 1)` 이라 판매자가 늘면 곱으로 커진다. 256이면 판매자
 * 넷이 각각 세 장씩 든 주문서(4^4 = 256)까지 전부 훑고, 그보다 큰 경우는 실제
 * 쿠폰함에서 나오지 않는다. 상한이 없으면 **한 사람의 쿠폰함이 서버의 CPU 를 정한다.**
 */
export const RECOMMENDATION_COMBINATION_LIMIT = 256

/** 한 조합을 실제로 계산해 본 결과. */
interface Evaluated {
  readonly ids: readonly string[]
  readonly size: number
  readonly paidAmount: number
  readonly discountAmount: number
}

/**
 * 최대 할인 조합 (F7).
 *
 * **고르는 기준은 「할인액이 큰 것」이 아니라 「덜 내는 것」이다.** 무료배송 판정이
 * 쿠폰까지 반영한 상품금액 기준이므로(`pricing.md` 1장), 큰 쿠폰이 그 문턱 아래로
 * 끌어내리면 배송비가 되살아난다. 할인액만 보고 고르면 **쿠폰을 더 쓰고 더 내는
 * 조합**을 권하게 되고, 그 화면은 설명할 수 없다.
 *
 * 같은 금액이면 **적게 쓰는 쪽**이다. 남은 한 장은 다음 주문에서 쓸 수 있는 값이고,
 * 오늘 아무것도 바꾸지 못한 채 소진되는 것은 손해다.
 *
 * 조합이 상한을 넘으면 **그룹마다 혼자 썼을 때 가장 덜 내는 장**을 골라 이어 붙인다.
 * 그 답이 최적이 아닐 수 있는 경우는 쿠폰끼리 겹쳐 잘릴 때뿐이라 드물고, 근사라는
 * 사실은 `exhaustive: false` 로 응답에 남는다.
 */
export function recommendCoupons(
  usable: readonly CouponCandidate[],
  lines: readonly CouponLine[],
  policies: readonly ShippingPolicy[],
  now: Date,
): CouponRecommendation {
  const groups = groupsOf(usable)
  const width = groups.reduce((product, group) => product * (group.length + 1), 1)
  const exhaustive = width <= RECOMMENDATION_COMBINATION_LIMIT
  const evaluate = (combo: readonly CouponCandidate[]): Evaluated => {
    const priced = calculateOrder({
      items: lines,
      discounts: orderedSelection(combo).flatMap((coupon) => {
        const verdict = evaluateCoupon(coupon, lines, now)

        return toPricingDiscounts(coupon, verdict.discountAmount, verdict.reach, lines)
      }),
      shippingPolicies: policies,
    })

    return {
      ids: combo.map((coupon) => coupon.userCouponId),
      size: combo.length,
      paidAmount: priced.paidAmount,
      discountAmount: priced.totalCouponDiscountAmount,
    }
  }
  const combos = exhaustive ? combinationsOf(groups) : [greedyOf(groups, evaluate)]
  // 초기값 없는 `reduce` 다. 조합 목록은 **언제나 비어 있지 않으므로**(그룹이 하나도
  // 없어도 「아무것도 고르지 않음」 하나가 나온다) 빈 배열을 받는 갈래가 필요 없고,
  // 그 갈래를 적으면 결코 실행되지 않는 방어가 커버리지에 영원한 구멍으로 남는다.
  const chosen = combos
    .map((combo) => evaluate(combo))
    .reduce((best, scored) => (isBetter(scored, best) ? scored : best))

  return { userCouponIds: [...chosen.ids], discountAmount: chosen.discountAmount, exhaustive }
}

/** 덜 내는 쪽이 이기고, 같으면 적게 쓰는 쪽이 이긴다. */
function isBetter(candidate: Evaluated, best: Evaluated): boolean {
  if (candidate.paidAmount !== best.paidAmount) return candidate.paidAmount < best.paidAmount

  return candidate.size < best.size
}

/**
 * 중복 규칙이 그대로 그룹이 된다 — 플랫폼 하나, 판매자마다 하나.
 *
 * 조합을 만든 뒤에 규칙을 검사하지 않는 이유는 **만들지 않는 편이 검사보다 강하기**
 * 때문이다. 규칙을 어긴 조합이 목록에 한 번이라도 들어오면, 그것을 거르는 코드가
 * 빠지는 날 추천이 규칙을 어긴다.
 */
function groupsOf(usable: readonly CouponCandidate[]): readonly (readonly CouponCandidate[])[] {
  const platform = usable.filter((coupon) => coupon.issuerType === 'PLATFORM')
  const sellers = groupBySellerId(usable.filter((coupon) => coupon.issuerType === 'SELLER'))

  return [platform, ...sellers].filter((group) => group.length > 0)
}

/**
 * 판매자별로 나눈다. 열쇠가 `string | null` 인 것은 **`null` 을 접지 않기** 위해서다.
 *
 * 여기 오는 것은 판매자 쿠폰뿐이라 `sellerId` 는 언제나 채워져 있지만, 그 성질을
 * 타입으로 말할 방법이 없어 `?? ''` 를 적으면 결코 실행되지 않는 갈래가 생긴다 —
 * `Map` 의 열쇠는 아무 값이나 될 수 있으므로 그냥 그대로 쓴다.
 */
function groupBySellerId(coupons: readonly CouponCandidate[]): readonly CouponCandidate[][] {
  const groups = new Map<string | null, CouponCandidate[]>()

  for (const coupon of coupons) {
    const held = groups.get(coupon.sellerId)

    if (held === undefined) {
      groups.set(coupon.sellerId, [coupon])
      continue
    }

    held.push(coupon)
  }

  return [...groups.values()]
}

/**
 * 그룹마다 「고르지 않음」을 포함해 하나씩 고른 모든 조합.
 *
 * **「고르지 않음」이 뒤에 온다.** 순서가 답을 정하는 경우가 하나 있기 때문이다 —
 * 낼 돈도 장수도 같은 두 조합이 있을 때 {@link isBetter} 는 **먼저 나온 것**을
 * 남긴다. 그룹이 플랫폼부터 세워져 있으므로(`groupsOf`) 그 동점은 플랫폼 쿠폰을 쓰는
 * 쪽으로 갈리고, 그것이 옳은 이유는 **판매자 쿠폰만 정산에서 차감되기** 때문이다:
 * 사는 사람이 내는 돈이 같다면 아무도 손해를 보지 않는 쪽을 권한다.
 */
function combinationsOf(
  groups: readonly (readonly CouponCandidate[])[],
): readonly (readonly CouponCandidate[])[] {
  return groups.reduce<readonly (readonly CouponCandidate[])[]>(
    (combos, group) =>
      combos.flatMap((combo) => [...group.map((coupon) => [...combo, coupon]), combo]),
    [[]],
  )
}

/** 그룹마다 혼자 썼을 때 가장 덜 내는 장. 아무것도 못 줄이면 그 그룹은 비운다. */
function greedyOf(
  groups: readonly (readonly CouponCandidate[])[],
  evaluate: (combo: readonly CouponCandidate[]) => Evaluated,
): readonly CouponCandidate[] {
  const none = evaluate([])

  return groups.flatMap((group) => {
    const best = group
      .map((coupon) => ({ coupon, scored: evaluate([coupon]) }))
      .reduce((left, right) => (isBetter(right.scored, left.scored) ? right : left))

    return isBetter(best.scored, none) ? [best.coupon] : []
  })
}
