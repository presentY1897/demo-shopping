/**
 * 환불액 계산 (TASK-0068 · `docs/design/pricing.md` 4장).
 *
 * **다시 계산하지 않는다.** 주문 시점에 항목까지 저장해 둔 안분액이 진실이고
 * (`pricing.md` 2장), 환불 때 다시 나누면 그 사이 쿠폰 정책이 바뀌었을 때 값이
 * 달라진다. 그래서 이 파일은 **저장된 숫자를 쪼개기만** 한다.
 *
 * 쪼개는 일이 이 파일의 전부이고, 그것이 생각보다 까다롭다 — 아래 4.1.
 */

/** 환불 계산이 보는 주문 항목. 저장된 값 그대로다. */
export interface RefundableLine {
  /** 주문한 수량. */
  readonly quantity: number
  /** `unitPrice × quantity`. */
  readonly productAmount: number
  /** 이 항목에 안분된 쿠폰 할인. */
  readonly couponDiscountAmount: number
  /** 이 항목에 안분된 적립금. */
  readonly pointDiscountAmount: number
}

/**
 * 이 항목에서 실제로 받은 돈.
 *
 * 할인은 **이미 안분돼 저장돼 있다.** 여기서 다시 비율을 세지 않는 이유가
 * `pricing.md` 2장이고, 뺄셈 하나로 끝나는 것이 그 저장의 값이다.
 */
export function lineNetAmount(line: RefundableLine): number {
  return line.productAmount - line.couponDiscountAmount - line.pointDiscountAmount
}

/**
 * 이 항목에서 `units` 개까지 환불했을 때의 **누적** 환불액.
 *
 * **누적으로 세는 것이 이 파일에서 가장 중요한 결정이다.**
 *
 * 한 항목을 여러 번 나눠 환불할 수 있다(3개 중 1개, 나중에 또 1개). 그때마다
 * 「이번 몫」을 따로 반올림하면 **합계가 원래 금액과 어긋난다** — 10,000원짜리 3개를
 * 하나씩 세 번 환불하면 `floor(10000/3) × 3 = 9,999` 로 1원이 사라진다. 그 1원은
 * 아무 데도 안 가고, 전량 환불한 사람의 장부에 영원히 남는다.
 *
 * 그래서 매번 **처음부터 다시 센다**: 「지금까지 n개」의 누적액에서 「지금까지
 * n−k개」의 누적액을 뺀 것이 이번 몫이다. 이러면 마지막 환불이 잔여를 자동으로
 * 가져가고, 전량 환불의 합계가 `lineNetAmount` 와 **정확히** 같아진다.
 *
 * `pricing.md` 1장의 「원 단위 잔여를 버리지 않는다」를 **시간 축에 적용한 것**이고,
 * 항목 사이의 안분이 「마지막 항목에 잔여를 몰아」 합계를 지키는 것과 같은 장치다.
 */
export function refundThroughUnits(line: RefundableLine, units: number): number {
  const capped = Math.min(Math.max(0, units), line.quantity)

  return Math.floor((lineNetAmount(line) * capped) / line.quantity)
}

/**
 * 이번에 실제로 환불되는 개수. 남은 것보다 많이 요청해도 남은 만큼이다.
 *
 * 금액과 **같은 자를 쓰는 것**이 요점이다 — 둘이 다른 값을 보면 저장된 행이 자기
 * 금액을 설명하지 못한다.
 */
export function refundableUnits(
  line: RefundableLine,
  alreadyRefundedUnits: number,
  units: number,
): number {
  const already = Math.min(Math.max(0, alreadyRefundedUnits), line.quantity)

  return Math.min(Math.max(0, units), line.quantity - already)
}

/**
 * 이번에 환불할 이 항목의 몫.
 *
 * `alreadyRefundedUnits` 가 인자인 것이 위 누적 계산의 전부다 — 부르는 쪽이 그
 * 값을 모르면 이 함수는 옳은 답을 낼 수 없다.
 */
export function lineRefundAmount(
  line: RefundableLine,
  alreadyRefundedUnits: number,
  units: number,
): number {
  const through = refundThroughUnits(line, alreadyRefundedUnits + units)

  return through - refundThroughUnits(line, alreadyRefundedUnits)
}

/**
 * 배송비를 어떻게 할 것인가 (`pricing.md` 4장 · TASK-0068 4장 표).
 *
 * **환불액에 더하거나 빼는 한 숫자로 접는다.** 부르는 쪽이 「전액 환불인가 재부과인가
 * 반품비 차감인가」를 다시 판단하지 않게 하려는 것이고, 그 판단이 두 곳에 있으면
 * 언젠가 다른 답을 낸다.
 */
export interface ShippingAdjustmentInput {
  /** 이 판매자 몫의 항목이 **전부** 환불되는가. */
  readonly full: boolean
  /**
   * 주문 때 **실제로 부과된** 배송비. 무료배송이었으면 0 이다.
   *
   * `standardShippingFee` 와 나눠 두는 것이 이 계산의 핵심이다 — 무료배송으로 0원을
   * 낸 사람과 3,000원을 낸 사람은 부분 취소 뒤에 서로 다른 답을 받아야 한다.
   */
  readonly chargedShippingFee: number
  /** 이 가게의 기본 배송비. 무료배송 조건이 무너졌을 때 되살아나는 값이다. */
  readonly standardShippingFee: number
  /**
   * 남는 항목의 **무료배송 판정 금액** 합. 전량 환불이면 의미가 없다.
   *
   * **상품금액이 아니라 「상품금액 − 쿠폰 할인」이다** (`pricing.md` 1장이 무료배송
   * 판정을 그렇게 못 박고, 3장이 「부분 취소도 같은 기준」이라고 잇는다). 이름을
   * `productAmount` 로 두면 부르는 쪽이 상품금액을 그대로 넣게 되고, 그 차이가
   * 배송비 3,000원이 붙느냐 마느냐를 가른다.
   */
  readonly remainingEligibleAmount: number
  /** 이 판매자의 무료배송 문턱. `null` 이면 무료배송 자체가 없다. */
  readonly freeShippingThreshold: number | null
  /**
   * 이번 환불이 물어야 하는 반품 배송비. 취소에는 없고(0), 반품에서 귀책이 정한다
   * (`return-rules.ts` 의 `returnCostShare`).
   */
  readonly returnFee: number
  /**
   * 판매자 귀책인가 (하자·오배송).
   *
   * **재부과를 막는 유일한 값이다.** 이것이 없으면 하자 상품을 일부 반품한 사람이
   * 남은 금액이 문턱에 못 미친다는 이유로 **배송비를 새로 물게 된다** — 잘못은
   * 판매자가 했는데 구매자가 무료배송을 잃는다. `pricing.md` 4장이 「판매자 귀책
   * 반품은 배송비·반품비 판매자 부담」이라고 적은 것이 이 자리다.
   */
  readonly sellerAtFault: boolean
}

/**
 * 배송비 조정액. **양수면 더 돌려주고 음수면 덜 돌려준다.**
 *
 * 네 줄이 `pricing.md` 의 표 그대로다.
 *
 * | 상황 | 조정 |
 * | --- | --- |
 * | 전량 환불 | 배송비 **전액 환불** — 보낼 물건이 없어졌으니 받을 이유도 없다 |
 * | 부분 환불, 남은 것이 여전히 문턱 이상 | 0 |
 * | 부분 환불, 남은 것이 문턱 **미달** | **재부과**(음수) — 무료배송의 조건이 사라졌다 |
 * | 반품 배송비 | **차감**(음수) — 귀책이 구매자일 때만 값이 있다 |
 *
 * 조정은 **이번 환불액 안에서만** 일어난다 — 총액이 0에서 바닥을 치므로, 재부과가
 * 환불액보다 커도 사람에게 **새로 청구하지는 않는다.**
 */
export function shippingAdjustment(input: ShippingAdjustmentInput): number {
  if (input.full) return input.chargedShippingFee - input.returnFee

  const threshold = input.freeShippingThreshold
  // 되살아날 것이 없는 세 경우 — 무료배송이 없는 가게, 남은 것이 여전히 문턱 이상,
  // 그리고 **판매자 귀책**. 마지막이 없으면 잘못한 쪽은 판매자인데 구매자가 무료배송을
  // 잃는다.
  const kept =
    input.sellerAtFault || threshold === null || input.remainingEligibleAmount >= threshold
  // **재부과액은 「기본 배송비 − 이미 낸 배송비」다.** 이미 3,000원을 낸 사람에게는
  // 0 이고 무료배송으로 0원을 낸 사람에게만 3,000원이 붙는다. 이 뺄셈이 없으면
  // 배송비를 두 번 받는다.
  const rebilled = kept ? 0 : Math.max(0, input.standardShippingFee - input.chargedShippingFee)

  return -input.returnFee - rebilled
}

/** 한 항목의 환불 한 줄. 저장될 값 그대로다. */
export interface RefundLine {
  readonly orderItemId: string
  readonly units: number
  readonly amount: number
}

export interface RefundBreakdown {
  readonly lines: readonly RefundLine[]
  /** 항목 몫의 합. */
  readonly itemsAmount: number
  /** 배송비 조정. 양수면 더, 음수면 덜. */
  readonly shippingAmount: number
  /**
   * 실제로 프로바이더에 요청할 금액.
   *
   * **음수가 될 수 없다.** 반품비가 항목 환불액보다 큰 경우(아주 싼 물건의 변심
   * 반품)에 0으로 바닥을 친다 — 환불이 **청구로 뒤집히지 않게** 하는 자리이고,
   * 그 차액을 어떻게 받을지는 이 TASK 의 것이 아니다.
   */
  readonly total: number
}

export interface RefundInput {
  readonly lines: readonly {
    readonly orderItemId: string
    readonly line: RefundableLine
    readonly alreadyRefundedUnits: number
    readonly units: number
  }[]
  readonly shipping: ShippingAdjustmentInput
}

/** 이번 환불의 전부. 부르는 쪽은 이 값을 그대로 적으면 된다. */
export function refundBreakdown(input: RefundInput): RefundBreakdown {
  const lines = input.lines.map((entry) => ({
    orderItemId: entry.orderItemId,
    // **금액과 같은 자로 자른다.** 요청값을 그대로 실으면 「7개를 환불했다」는 행이
    // 남는데 금액은 남은 1개 몫이라, 그 행을 근거로 누계를 세는 쪽이 틀린 답에 닿는다.
    // 수량을 **거절**하는 것은 부르는 쪽의 일이고, 여기서는 적히는 값이 사실이기만
    // 하면 된다.
    units: refundableUnits(entry.line, entry.alreadyRefundedUnits, entry.units),
    amount: lineRefundAmount(entry.line, entry.alreadyRefundedUnits, entry.units),
  }))
  const itemsAmount = lines.reduce((sum, line) => sum + line.amount, 0)
  const shippingAmount = shippingAdjustment(input.shipping)

  return {
    lines,
    itemsAmount,
    shippingAmount,
    total: Math.max(0, itemsAmount + shippingAmount),
  }
}
