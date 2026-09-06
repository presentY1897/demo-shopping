/**
 * 정산 금액의 순수 판단 (TASK-0080 6.2, Q5 강화 — 분기 100%).
 *
 * `pricing.md` 6장이 명세다:
 *
 * ```
 * SellerOrder 정산액 = 판매액(실제 구매확정 금액)
 *                    − 플랫폼 수수료 (판매액 × 수수료율)
 *                    − 판매자 부담 쿠폰 안분액
 *                    − 반품으로 확정 취소된 금액
 * ```
 *
 * **여기가 틀리면 사람이 손해를 보고, 그 손해는 조용하다.** 판매자에게 덜 주면
 * 그는 몇 주 뒤 정산서의 숫자 하나로만 그것을 알 수 있고, 더 주면 플랫폼이 받아야
 * 할 것을 못 받는데 그쪽은 아무도 신고하지 않는다. 어느 쪽도 오류로 나타나지 않는다.
 *
 * **플랫폼 부담을 빼지 않는 것이 이 계산의 핵심이다** (D-029). 플랫폼 쿠폰과
 * 적립금은 플랫폼이 진 비용이고, 판매자는 **정가 기준으로** 정산받는다. 이 구분이
 * 없으면 정산이 단순 곱셈이 되어 도메인으로서 의미가 없어진다.
 */

import { commissionOf } from './commission-rate.js'

/** 하루. */
const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * KST 고정 오프셋 +09:00.
 *
 * `claim-deadline.ts` 가 같은 상수를 같은 이유로 쓴다 — 한국 표준시는 1988년 이후
 * 서머타임이 없어서 고정 오프셋 산술이 IANA 표와 정확히 같은 답을 낸다. 정산 회차는
 * **달력의 개념**이라 시간대 없이는 「지난주」를 셀 수 없다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

const DAYS_IN_WEEK = 7

/** 1970-01-01 은 목요일. 그날부터 센 일수를 요일로 옮길 때 쓴다. */
const EPOCH_DAY_OF_WEEK = 4

/** 정산 회차 하나 — **끝은 열려 있다.** */
export interface SettlementPeriod {
  readonly start: Date
  /** 이 순간은 **포함하지 않는다.** 다음 회차의 시작과 정확히 맞물린다 (R2). */
  readonly end: Date
}

/**
 * 이 순간에서 봤을 때 **완전히 끝난 마지막 주** (월요일 00:00 KST 시작).
 *
 * 「지난주」를 이렇게 정의하는 이유는 **아직 끝나지 않은 주를 정산하면 그 주의
 * 나머지 판매가 갈 곳이 없어지기** 때문이다. 한 번 정산된 몫은 다시 정산되지
 * 않으므로(F6), 반쯤 지난 주를 집으면 그 뒤의 판매는 다음 회차에서도 「이미 지난
 * 회차의 기간」에 속해 영영 빠진다.
 *
 * 배치가 언제 도는지와는 무관하다. 화요일에 늦게 돌아도 답은 같다.
 */
export function weekBefore(now: Date): SettlementPeriod {
  const today = Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS)
  const dayOfWeek = (((today + EPOCH_DAY_OF_WEEK) % DAYS_IN_WEEK) + DAYS_IN_WEEK) % DAYS_IN_WEEK
  // 월요일이 0 이 되게 옮긴다. 일요일(0)은 6이다 — 그 주의 마지막 날이다.
  const sinceMonday = (dayOfWeek + DAYS_IN_WEEK - 1) % DAYS_IN_WEEK
  const thisMonday = today - sinceMonday

  return {
    start: kstMidnight(thisMonday - DAYS_IN_WEEK),
    end: kstMidnight(thisMonday),
  }
}

/** KST 달력 날짜의 자정을 실제 순간으로. */
function kstMidnight(dayIndex: number): Date {
  return new Date(dayIndex * DAY_MS - KST_OFFSET_MS)
}

/** 정산서 한 줄이 담는 네 숫자. */
export interface SettlementAmounts {
  readonly salesAmount: number
  readonly commissionAmount: number
  readonly sellerCouponAmount: number
  /** `salesAmount − commissionAmount − sellerCouponAmount`. DB 도 같은 식을 강제한다. */
  readonly payoutAmount: number
}

/** 아무것도 없는 상태. 누계의 시작점이다. */
export const NO_AMOUNTS: SettlementAmounts = {
  salesAmount: 0,
  commissionAmount: 0,
  sellerCouponAmount: 0,
  payoutAmount: 0,
}

/**
 * 정산의 입력이 되는 주문 항목 하나.
 *
 * 전부 **주문 시점에 저장된 값**이다. 지금의 상품 가격도, 지금의 수수료율도, 지금의
 * 쿠폰 정책도 보지 않는다 — 계약은 판매 시점에 성립한다 (TASK-0079 F4).
 */
export interface SettlementItemSource {
  readonly unitPrice: number
  readonly quantity: number
  /** 반품으로 **확정 취소된** 수량. 환불까지 끝난 것만 센다. */
  readonly returnedQuantity: number
  readonly commissionRateBp: number
  /** 이 항목에 안분된 쿠폰 중 **판매자가 부담한** 몫 (F3 · F4). */
  readonly sellerCouponDiscountAmount: number
}

/**
 * 이 항목들을 지금 상태로 정산하면 얼마인가.
 *
 * 항목마다 따로 재는 이유는 **수수료율이 항목마다 다를 수 있기** 때문이다
 * (TASK-0079). 한 판매자 몫에 패션(3%)과 가전(5%)이 섞여 있으면 몫 전체에 한 요율을
 * 곱할 수 없다.
 *
 * 판매자 부담 쿠폰을 남은 수량만큼으로 줄일 때 **내린다.** 올리면 반품된 몫에 붙어
 * 있던 할인까지 판매자에게서 빼게 되고, 그것은 그가 부담한 적 없는 돈이다.
 */
export function amountsOf(items: readonly SettlementItemSource[]): SettlementAmounts {
  let salesAmount = 0
  let commissionAmount = 0
  let sellerCouponAmount = 0

  for (const item of items) {
    const settled = Math.max(0, item.quantity - item.returnedQuantity)
    const sales = item.unitPrice * settled

    salesAmount += sales
    commissionAmount += commissionOf(sales, item.commissionRateBp)
    sellerCouponAmount += Math.floor((item.sellerCouponDiscountAmount * settled) / item.quantity)
  }

  return withPayout({ salesAmount, commissionAmount, sellerCouponAmount })
}

/** 세 항에서 지급액을 붙인다. 한 곳에서만 계산되게 하려고 있다. */
function withPayout(amounts: Omit<SettlementAmounts, 'payoutAmount'>): SettlementAmounts {
  return {
    ...amounts,
    payoutAmount: amounts.salesAmount - amounts.commissionAmount - amounts.sellerCouponAmount,
  }
}

/**
 * **누계에서 빼는 장치** — 이미 정산된 것과 지금 정산돼야 하는 것의 차이.
 *
 * 「이 반품 때문에 얼마를 빼야 하나」를 반품 하나만 보고 계산하지 않는 이유는
 * **나눠서 반품한 사람의 합이 한 번에 반품한 사람과 어긋나기** 때문이다. 세 개 중
 * 하나를 반품하고 나중에 또 하나를 반품하면, 각각을 따로 계산한 두 번의 내림이
 * 한꺼번에 계산한 한 번의 내림과 1원 다를 수 있다. 누계로 재면 그런 일이 없다 —
 * 환불(TASK-0068)과 적립금 복원(TASK-0078)이 같은 장치를 쓴다.
 *
 * 돌아오는 값은 **음수이거나 0**이다. 정산 뒤에 늘어나는 판매는 없다.
 */
export function differenceOf(
  shouldBe: SettlementAmounts,
  settled: SettlementAmounts,
): SettlementAmounts {
  return withPayout({
    salesAmount: shouldBe.salesAmount - settled.salesAmount,
    commissionAmount: shouldBe.commissionAmount - settled.commissionAmount,
    sellerCouponAmount: shouldBe.sellerCouponAmount - settled.sellerCouponAmount,
  })
}

/** 여러 줄의 합. 부호가 줄에 박혀 있어서 **그냥 합**이다. */
export function sumOf(amounts: readonly SettlementAmounts[]): SettlementAmounts {
  return amounts.reduce(
    (total, entry) =>
      withPayout({
        salesAmount: total.salesAmount + entry.salesAmount,
        commissionAmount: total.commissionAmount + entry.commissionAmount,
        sellerCouponAmount: total.sellerCouponAmount + entry.sellerCouponAmount,
      }),
    NO_AMOUNTS,
  )
}

/** 정산서 한 장의 합계. 판매 줄과 차감 줄을 나눠 센다. */
export interface SettlementTotals extends SettlementAmounts {
  /** 지난 회차 뒤에 확정된 반품의 차감. **음수이거나 0이다.** */
  readonly returnAdjustmentAmount: number
}

/**
 * 정산서 한 장의 합계 (F8).
 *
 * 판매 줄의 세 항은 그대로 합계가 되고, 차감 줄은 **지급액만** 따로 모은다. 차감을
 * 판매액·수수료에 섞으면 정산서에서 「이번 주에 얼마 팔았나」를 읽을 수 없게 된다 —
 * 지난주 반품이 이번 주 판매액을 깎아 놓기 때문이다.
 */
export function totalsOf(
  sales: readonly SettlementAmounts[],
  adjustments: readonly SettlementAmounts[],
): SettlementTotals {
  const sold = sumOf(sales)
  const returnAdjustmentAmount = sumOf(adjustments).payoutAmount

  return {
    ...sold,
    returnAdjustmentAmount,
    payoutAmount: sold.payoutAmount + returnAdjustmentAmount,
  }
}
