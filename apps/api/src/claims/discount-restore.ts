import { earnedAmount } from '../points/point-ledger.js'
import type { RefundLedgerItem } from './refund-plan.js'

/**
 * 환불이 되돌리는 할인 (TASK-0078, 6.2 Q5 강화).
 *
 * `pricing.md` 4장의 **적용의 역순**이 이 파일의 전부다: ① 적립금 복구 → ② 쿠폰
 * 복원 → ③ 현금 환불. 앞의 둘이 여기 있고 마지막은 TASK-0068 이 이미 한다.
 *
 * **여기가 틀리면 사람이 손해를 본다.** 그리고 그 손해는 조용하다 — 환불은 성공하고,
 * 금액도 맞고, 다만 쓴 적립금이 돌아오지 않거나 쿠폰이 사라진 채 남는다. 반대로 너무
 * 많이 돌려주면 그것은 **없는 돈을 만든 것**이고, 그쪽은 정산일까지 아무 데도
 * 나타나지 않는다.
 *
 * 순수 함수인 이유는 `refund-calc.ts` 와 같다. 이 판단들에 `await` 를 섞으면 분기
 * 100%를 요구할 때 닿을 수 없는 방어가 생기고, 그것은 게이트를 만족시키려고 코드를
 * 나쁘게 만드는 일이다.
 */

/**
 * 이 항목에서 `units` 개까지 환불했을 때 **되돌아간 적립금의 누계**.
 *
 * `refundThroughUnits` 와 같은 장치다 — 「이번 몫」을 따로 반올림하면 부분 환불을
 * 두 번 한 뒤의 합이 전체 환불 한 번과 달라지고, 그 1원은 실제 돈이다.
 */
function pointThroughUnits(item: RefundLedgerItem, units: number): number {
  const capped = Math.min(Math.max(0, units), item.quantity)

  return Math.floor((item.pointDiscountAmount * capped) / item.quantity)
}

/**
 * 이번 환불이 이 항목에서 되돌리는 적립금 (F1 · F2).
 *
 * **현금으로 나가지 않는 몫이다.** 환불액은 「상품금액 − 쿠폰안분 − 적립금안분」이고
 * (`pricing.md` 4장), 빠진 그 적립금안분이 여기서 적립금으로 돌아온다. 둘을 더하면
 * 사는 사람이 낸 것 전부가 된다 — F7 이 재는 등식이 그것이다.
 *
 * 쿠폰안분은 돌아오지 않는다. 쿠폰은 **깎인 값**이지 사람이 낸 것이 아니고, 대신
 * 조건이 맞으면 쿠폰 자체가 돌아온다 (아래 {@link couponRestoreDecision}).
 */
export function pointRestoreAmount(item: RefundLedgerItem): number {
  return (
    pointThroughUnits(item, item.refundedUnits + item.units) -
    pointThroughUnits(item, item.refundedUnits)
  )
}

/** 이번 환불이 되돌리는 적립금 전부. */
export function pointRestoreTotal(items: readonly RefundLedgerItem[]): number {
  return items.reduce((sum, item) => sum + pointRestoreAmount(item), 0)
}

/** 쿠폰을 되돌릴 수 없는 이유. `null` 이면 되돌린다. */
export type CouponRestoreRefusal =
  /** 이 쿠폰이 닿은 몫 중 아직 살아 있는 항목이 있다 — 부분 취소다. */
  | 'partial'
  /** 이미 되돌려 놓았다. 두 번째 환불 시도가 여기서 멈춘다 (F8). */
  | 'already_restored'

/** 쿠폰 하나가 닿은 판매자 몫 하나의 상태. */
export interface CouponReachSummary {
  /** 그 몫의 항목이 **전부** 환불됐는가. */
  readonly fullyRefunded: boolean
}

export interface CouponRestoreInput {
  /** 이 쿠폰이 지금 `USED` 인가. 아니면 이미 되돌아온 것이다. */
  readonly used: boolean
  /**
   * 이 쿠폰이 닿은 판매자 몫들.
   *
   * **판매자 쿠폰이면 하나, 플랫폼 쿠폰이면 여럿**이다. 이것이 목록인 것이 이 판단의
   * 전부다 — `pricing.md` 4장은 「`SellerOrder` 의 모든 항목이 취소되면」이라고만
   * 적고 있었고, 그대로 읽으면 두 가게에 걸친 플랫폼 쿠폰이 **한쪽만 취소돼도**
   * 돌아온다. 그때 사는 사람은 쿠폰을 돌려받은 채 남은 가게에서 그 할인을 계속
   * 누린다 (D-225).
   */
  readonly reach: readonly CouponReachSummary[]
}

/**
 * 이 쿠폰을 되돌릴 것인가 (F3 · F4 · F8).
 *
 * **부분 취소면 되돌리지 않는다.** 최소 주문금액 5만원 쿠폰을 쓰고 일부만 남기면,
 * 돌아온 쿠폰으로 그 조건을 우회해 다시 쓸 수 있다. 실제 커머스도 그렇게 한다.
 *
 * 「전부 환불됐는가」를 **닿은 몫 전부**에 대해 묻는 것이 이 함수가 문서보다 좁은
 * 자리다. 이유는 위 {@link CouponRestoreInput.reach} 에 적었다.
 */
export function couponRestoreDecision(input: CouponRestoreInput): CouponRestoreRefusal | null {
  if (!input.used) return 'already_restored'

  return input.reach.every((entry) => entry.fullyRefunded) ? null : 'partial'
}

/**
 * 이번 환불이 **되가져와야 할** 적립금 (F5).
 *
 * 확정 때 지급된 것은 `earnedAmount(paidAmount, rate)` 였다. 환불이 일어난 뒤 그
 * 몫에 남아 있어야 할 적립금은 **남은 결제금액으로 다시 계산한 값**이고, 둘의 차이가
 * 이번에 회수할 금액이다.
 *
 * 「이번 환불액 × 적립률」로 계산하지 않는 이유는 반올림이다 — 세 번 나눠 반품한
 * 사람의 회수 합이 한 번에 전량 반품한 사람과 달라지고, 전량 반품인데 1원이 남는
 * 경우가 생긴다. 누계에서 빼는 장치가 그것을 막는다 (`refundThroughUnits` 와 같다).
 */
export function clawbackAmount(input: {
  readonly paidAmount: number
  /** 이번 환불 **전까지** 이 몫에서 환불된 금액. */
  readonly refundedBefore: number
  /** 이번에 환불되는 금액. */
  readonly refundedNow: number
  readonly earnRateBp: number
}): number {
  const kept = (refunded: number): number =>
    earnedAmount(Math.max(0, input.paidAmount - refunded), input.earnRateBp)

  return kept(input.refundedBefore) - kept(input.refundedBefore + input.refundedNow)
}

export interface ClawbackInput {
  /** 위 {@link clawbackAmount} 가 낸, 되가져와야 할 금액. */
  readonly earned: number
  /** 지금 쓸 수 있는 잔액. */
  readonly balance: number
}

/**
 * 구매확정 후 반품에서 **회수할 적립금**과, 회수하지 못한 몫 (F5 · F6).
 *
 * 확정되면 적립금이 나간다(`pricing.md` 5장). 그 뒤에 반품하면 그것을 되가져와야
 * 하는데, **이미 써 버렸으면 되가져올 수 없다.**
 *
 * 음수 잔액을 만들지 않는 것이 이 함수의 이유다. 잔액을 -3,000 으로 두면 그 사람은
 * 다음에 적립받는 3,000원을 잃는데, 그 사실을 아무 화면도 설명하지 못한다. 대신 못
 * 가져온 몫을 `shortfall` 로 남기고, 그것이 `ADJUST` 한 줄과 관리자 확인 대상이 된다.
 *
 * `PointAccount_balance_check` 가 마지막 방어선이라는 점도 같다 — 이 계산이 틀려
 * 잔액보다 많이 빼려 하면 데이터베이스가 트랜잭션을 거절한다.
 */
export function clawbackPlan(input: ClawbackInput): {
  readonly taken: number
  readonly shortfall: number
} {
  const taken = Math.min(Math.max(0, input.earned), Math.max(0, input.balance))

  return { taken, shortfall: Math.max(0, input.earned) - taken }
}
