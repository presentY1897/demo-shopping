import type { RefundBreakdown, RefundInput, ShippingAdjustmentInput } from './refund-calc.js'
import { refundBreakdown, shippingAdjustment } from './refund-calc.js'

/**
 * 환불 실행이 `refund-calc.ts` 에 넘길 입력을 **저장된 사실에서 만든다** (TASK-0068).
 *
 * 저쪽 파일은 숫자를 쪼개는 일만 하고, 그 숫자가 어디서 오는지는 모른다. 여기가 그
 * 사이를 잇는 자리이고, 이 파일이 따로 있는 이유는 **여기에도 판단이 있기**
 * 때문이다 — 데이터베이스도 시계도 보지 않으므로 분기 전부가 단위 스펙에서 닿는다.
 *
 * ## 배송비도 누적으로 센다
 *
 * `refundThroughUnits` 가 항목에 쓰는 장치를 **배송비에 그대로 적용한 것**이 이
 * 파일의 전부다. 저쪽이 「지금까지 n개」에서 「지금까지 n−k개」를 빼듯, 여기서는
 * 「이번 환불 뒤의 배송비 판정」에서 「이번 환불 전의 배송비 판정」을 뺀다.
 *
 * 그 뺄셈이 없으면 **전량 취소의 합계가 실결제금액과 어긋난다.** 실제로 어긋나는
 * 경로가 이것이다.
 *
 * | | 무료배송(0원)으로 산 두 항목, 기본 배송비 3,000원 |
 * | --- | --- |
 * | ① 한 항목 취소 | 남은 것이 문턱 아래로 내려가 **3,000원 재부과**(−3,000) |
 * | ② 남은 항목 취소 | 전량이 됐으니 배송비 전액 환불 — 그런데 낸 배송비가 0원이라 **0** |
 * | 합계 | 실결제금액보다 **3,000원 적다.** 그 돈은 아무 데도 안 가고 사라진다 |
 *
 * 뺄셈을 넣으면 ②가 `0 − (−3,000) = +3,000` 이 되어 ①의 재부과를 되돌린다. 「전량
 * 취소」는 한 신청의 크기가 아니라 **그 뒤에 남은 것의 크기**라는 `cancelScopeOf`
 * 의 판단을, 시간 축에서 한 번 더 지키는 장치다.
 *
 * ## 그래서 `CancelApproved.scope` 를 쓰지 않는다
 *
 * 저 값은 **승인 시점의 답**이다. 환불이 실패해 며칠 뒤 재시도되면 그 사이에 다른
 * 취소가 승인돼 있을 수 있고, 그때 옛 답으로 배송비를 돌려주면 두 클레임이 같은
 * 배송비를 각자 한 번씩 돌려준다. 위 뺄셈이 성립하려면 「전량인가」도 **환불
 * 원장에서** 나와야 한다 — 두 판정이 같은 사실을 보지 않으면 차분이 접히지 않는다.
 */

/** 배송비 판정에 필요한 판매자 몫의 사실들. 전부 저장된 값이다. */
export interface SellerShippingFacts {
  /** 주문 때 **실제로 부과된** 배송비 (`SellerOrder.shippingFee`). 무료배송이면 0. */
  readonly chargedShippingFee: number
  /** 이 가게의 기본 배송비 (`Seller.shippingFee`). 무료 조건이 무너지면 되살아난다. */
  readonly standardShippingFee: number
  /** 이 판매자의 무료배송 문턱 (`Seller.freeShippingThreshold`). `null` 이면 없다. */
  readonly freeShippingThreshold: number | null
}

/**
 * 한 주문 항목이 환불에 대해 아는 전부.
 *
 * **판매자 몫의 항목이 전부 들어온다** — 이번 클레임에 걸리지 않은 것까지. 무료배송
 * 문턱을 다시 보려면 「남는 것」을 알아야 하고, 남는 것은 걸리지 않은 항목이다.
 */
export interface RefundLedgerItem {
  readonly orderItemId: string
  /** 주문한 수량. */
  readonly quantity: number
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly pointDiscountAmount: number
  /**
   * 이 항목에서 **이미 환불이 끝난** 수량.
   *
   * 세는 것은 `REFUNDED` 클레임의 수량 합이다 — 승인만 된 것은 아직 돈이 나가지
   * 않았고, `lineRefundAmount` 가 묻는 것은 「얼마를 이미 돌려줬나」다.
   */
  readonly refundedUnits: number
  /** 이번 환불이 가져가는 수량. 이 클레임에 없는 항목은 0 이다. */
  readonly units: number
}

/**
 * 무료배송 문턱을 다시 볼 때 쓰는 금액 — **상품금액에서 쿠폰 할인을 뺀 값**.
 *
 * 처음 판정과 같은 기준이다 (`Seller.freeShippingThreshold` · 2026-09-05 결정).
 * 적립금을 빼지 않는 것도 그 기준 그대로다 — 적립금은 결제수단에 가깝고, 그것까지
 * 빼면 같은 장바구니가 적립금을 쓴 날에만 배송비를 문다.
 */
function basisOf(item: RefundLedgerItem): number {
  return item.productAmount - item.couponDiscountAmount
}

/** 이 항목에서 `units` 개까지 환불했을 때 **빠져나간** 판정 금액의 누계. */
function basisThrough(item: RefundLedgerItem, units: number): number {
  const capped = Math.min(Math.max(0, units), item.quantity)

  return Math.floor((basisOf(item) * capped) / item.quantity)
}

/**
 * `refunded` 개가 환불된 뒤 **남아서 여전히 배송되는** 금액의 합.
 *
 * 누계에서 빼는 모양이 `refundThroughUnits` 와 같다. 한 항목의 절반을 환불할 때
 * 「이번 몫」을 따로 반올림하면 남은 금액이 원래 값과 어긋나고, 그 1원이 무료배송
 * 문턱의 경계에 앉으면 배송비 3,000원이 갈린다.
 */
function remainingBasisOf(
  items: readonly RefundLedgerItem[],
  refunded: (item: RefundLedgerItem) => number,
): number {
  return items.reduce((sum, item) => sum + basisOf(item) - basisThrough(item, refunded(item)), 0)
}

/** 이 항목들이 **전부** 환불됐는가. `cancelScopeOf` 와 같은 판단을 환불 원장으로. */
function allRefunded(
  items: readonly RefundLedgerItem[],
  refunded: (item: RefundLedgerItem) => number,
): boolean {
  return items.every((item) => refunded(item) >= item.quantity)
}

/**
 * 이번 환불 **전후**의 배송비 입력 두 벌.
 *
 * `before` 는 이번 환불이 없었던 세상의 판정이고 `after` 는 있는 세상의 판정이다.
 * 둘의 차이가 이번에 움직일 배송비이고, 그 차분이 파일 첫머리의 표를 지킨다.
 */
export interface ShippingPair {
  readonly after: ShippingAdjustmentInput
  /**
   * 누계를 되짚을 기준. **반품에는 `null`** 이다 — 아래 {@link returnShipping} 참조.
   */
  readonly before: ShippingAdjustmentInput | null
}

/**
 * 취소의 배송비 입력 (`pricing.md` 4장의 위 두 줄).
 *
 * **반품비가 없다.** 취소는 물건이 아직 떠나지 않은 자리라 회수할 운송이 없고,
 * 그래서 `returnFee` 는 언제나 0 이다 (`shippingAdjustment` 의 네 줄 중 마지막 줄은
 * 반품 경로의 것이다).
 */
export function cancelShipping(
  items: readonly RefundLedgerItem[],
  facts: SellerShippingFacts,
): ShippingPair {
  const inputFor = (refunded: (item: RefundLedgerItem) => number): ShippingAdjustmentInput => ({
    full: allRefunded(items, refunded),
    chargedShippingFee: facts.chargedShippingFee,
    standardShippingFee: facts.standardShippingFee,
    remainingEligibleAmount: remainingBasisOf(items, refunded),
    freeShippingThreshold: facts.freeShippingThreshold,
    returnFee: 0,
    // **취소에는 귀책이 배송비를 가르는 축이 아니다.** `pricing.md` 4장의 표에서
    // 「판매자 귀책」 줄은 반품 두 줄에만 붙어 있고, 재부과 줄에는 조건이 없다.
    // `ClaimRequest.fault` 는 구매자가 신청서에 적는 값이라 이 자리에 그대로
    // 넘기면 배송비를 신청자가 고르게 된다.
    sellerAtFault: false,
  })

  return {
    after: inputFor((item) => item.refundedUnits + item.units),
    before: inputFor((item) => item.refundedUnits),
  }
}

/** 반품이 신청 시점에 굳혀 둔 두 금액 (`ReturnDetail` · `returnCostShare`). */
export interface ReturnShippingFacts {
  /** 돌려줄 원 배송비. 판매자 귀책에서만 0보다 크다. */
  readonly originalShippingRefund: number
  /** 환불액에서 뺄 반품 배송비. 구매자 부담에서만 0보다 크다. */
  readonly returnShippingDeduction: number
  /**
   * 판매자 귀책인가 (하자 · 오배송).
   *
   * 아래 `full: true` 갈래에서는 `shippingAdjustment` 가 이 값을 읽지 않는다. 그래도
   * 넘기는 이유는 **사실을 지어내지 않기 위해서**다 — 이 경로가 언젠가 부분 갈래를
   * 쓰게 되는 날, `false` 로 굳어 있던 값은 「하자 반품인데 배송비를 새로 무는」
   * 결함이 되어 나타난다.
   */
  readonly sellerAtFault: boolean
}

/**
 * 반품의 배송비 입력.
 *
 * ## 여기서는 다시 계산하지 않는다
 *
 * 두 금액은 **신청 시점에 `returnCostShare` 가 정해 `ReturnDetail` 에 굳혀 둔 값**
 * 이다. 그 뒤에 판매자가 배송비 정책을 바꿔도 움직이지 않아야 하고
 * (`return-events.ts`), `ReturnDetail_bearer_amount_check` 가 둘이 어긋난 행을 막는다.
 * 그래서 이 함수가 하는 일은 그 결과를 `shippingAdjustment` 의 모양으로 옮기는
 * 것뿐이다.
 *
 * ## 왜 `full: true` 인가 — 반품은 **재부과하지 않는다**
 *
 * `pricing.md` 4장의 표에서 재부과 줄은 **부분 취소**에만 붙어 있고, 반품 두 줄은
 * 배송비를 귀책으로만 가른다. 그럴 만한 이유가 있다 — 재부과는 「보내기 전에
 * 취소했으니 무료배송의 조건이 사라졌다」는 말인데, 반품에서는 **물건이 실제로
 * 배송됐다.** 이미 제공된 운송의 값을 사후에 무르는 것은 다른 결정이고, 이 TASK 의
 * 것이 아니다.
 *
 * 그래서 반품이 쓰는 것은 네 줄 중 「전액 환불」과 「반품비 차감」 둘이고, 그 둘을 한
 * 번에 내놓는 갈래가 `full` 이다 — `chargedShippingFee` 자리에 **돌려줄 원 배송비**를,
 * `returnFee` 자리에 **차감할 반품비**를 넣으면 답이 정확히 `원 배송비 − 반품비` 다.
 * 그 두 값은 신청 시점에 `returnCostShare` 가 정해 굳혀 둔 것이고, 여기서 다시
 * 계산하지 않는다.
 *
 * ## 그래서 `before` 가 `null` 이다
 *
 * 취소의 차분은 「이 몫의 배송비를 한 번만 돌려준다」를 지키려는 것인데, 반품의 두
 * 금액은 **판정이 아니라 이미 정해진 값**이라 되짚을 앞 판정이 없다. `null` 은
 * 「누계를 세지 않는다」는 뜻이고, 이 경로에서 그것이 무엇을 못 잡는지는 TASK 보고에
 * 적었다.
 */
export function returnShipping(facts: ReturnShippingFacts): ShippingPair {
  return {
    after: {
      full: true,
      chargedShippingFee: facts.originalShippingRefund,
      standardShippingFee: 0,
      remainingEligibleAmount: 0,
      freeShippingThreshold: null,
      returnFee: facts.returnShippingDeduction,
      sellerAtFault: facts.sellerAtFault,
    },
    before: null,
  }
}

/** 이번 환불에 실제로 걸리는 줄들. 수량이 0인 항목은 이 클레임의 것이 아니다. */
function linesOf(items: readonly RefundLedgerItem[]): RefundInput['lines'] {
  return items
    .filter((item) => item.units > 0)
    .map((item) => ({
      orderItemId: item.orderItemId,
      line: {
        quantity: item.quantity,
        productAmount: item.productAmount,
        couponDiscountAmount: item.couponDiscountAmount,
        pointDiscountAmount: item.pointDiscountAmount,
      },
      alreadyRefundedUnits: item.refundedUnits,
      units: item.units,
    }))
}

/**
 * 이번 환불의 전부 — **배송비를 누계에서 뺀 뒤**의 값.
 *
 * 항목 몫은 `refundBreakdown` 이 그대로 낸다(그쪽이 이미 누적으로 센다). 배송비만
 * 여기서 한 겹 더 벗기고, 총액은 그 결과로 다시 바닥을 친다 — `refundBreakdown` 이
 * 「환불이 청구로 뒤집히지 않게」 두었던 그 바닥이고, 배송비가 바뀌었으므로 같은
 * 규칙을 같은 자리에서 한 번 더 적용한다.
 */
export function claimRefundBreakdown(
  items: readonly RefundLedgerItem[],
  shipping: ShippingPair,
): RefundBreakdown {
  const gross = refundBreakdown({ lines: linesOf(items), shipping: shipping.after })
  const settled = shipping.before === null ? 0 : shippingAdjustment(shipping.before)
  // `+ 0` 이 `-0` 을 접는다. `shippingAdjustment` 의 부분 갈래는 `-0 - 0` 으로 끝날
  // 수 있고, 돈으로는 0이지만 **`Object.is` 로 비교하는 곳에서는 0이 아니다** —
  // 정수 컬럼에 들어가면서 사라지는 값이 응답 JSON 과 단언에서만 다르게 보이는 것이
  // 이 한 항이 막는 것이다.
  const shippingAmount = gross.shippingAmount - settled + 0

  return {
    lines: gross.lines,
    itemsAmount: gross.itemsAmount,
    shippingAmount,
    total: Math.max(0, gross.itemsAmount + shippingAmount),
  }
}
