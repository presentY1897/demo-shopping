import type { OrderStatus } from '@shopping/shared'

import type { SellerOrderActor } from '../orders/seller-order-transitions.js'

/**
 * 클레임의 순수 판단 (TASK-0065 · `docs/design/state-machines.md` 4장).
 *
 * **항목·수량 단위가 이 도메인의 전부다.** 주문 항목 셋 중 하나만, 그 중 두 개
 * 중 하나만 취소하는 것이 정상 흐름이고(D-027), 주문 단위로만 만들면 실제
 * 서비스로 쓸 수 없다. 그래서 여기 있는 함수는 전부 **한 항목의 남은 수량**을
 * 중심으로 돈다.
 *
 * 데이터베이스도 시계도 보지 않는다 — 「지금」은 인자로 받는다. 그래서 분기
 * 전부가 단위 테스트에서 닿고, 이 TASK 의 Q5 는 **분기 커버리지 100%** 다.
 * 뒤집어 말하면 **닿을 수 없는 방어 분기를 쓰지 않는다.**
 */

/** 취소인가 반품인가. 주문 상태가 정하고 사람이 고르지 않는다. */
export const claimTypes = ['CANCEL', 'RETURN'] as const

export type ClaimType = (typeof claimTypes)[number]

/**
 * 클레임이 지나는 상태.
 *
 * **두 경로가 한 열거형에 있다.** 나누면 「지금 이 클레임이 어디까지 왔나」를
 * 묻는 화면과 목록이 유형별로 다른 코드를 갖게 되고, 실제로 둘은 같은 표에
 * 나란히 있다. 대신 전이표가 경로를 섞지 못하게 막는다 — 취소에서 반품 상태로
 * 가는 화살표는 정의되지 않는다.
 *
 * `REFUNDED` 만 두 경로가 함께 쓴다. 환불은 **끝에서 같은 일**이기 때문이고,
 * 그 앞까지 오는 길이 다를 뿐이다.
 */
export const claimStatuses = [
  'CANCEL_REQUESTED',
  'CANCEL_APPROVED',
  'CANCEL_REJECTED',
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  /** 회수 중. 실제 운송이 아니라 가상이다 (TASK-0067). */
  'PICKING_UP',
  'INSPECTING',
  'RETURN_COMPLETED',
  'RETURN_REJECTED',
  /** 환불까지 끝났다. 두 경로가 만나는 유일한 자리다. */
  'REFUNDED',
] as const

export type ClaimStatus = (typeof claimStatuses)[number]

/** 각 유형이 시작하는 자리. 신청은 전이가 아니라 생성이다. */
export const CLAIM_INITIAL: Readonly<Record<ClaimType, ClaimStatus>> = {
  CANCEL: 'CANCEL_REQUESTED',
  RETURN: 'RETURN_REQUESTED',
}

export interface ClaimTransitionRule {
  readonly to: ClaimStatus
  readonly actors: readonly SellerOrderActor[]
}

/**
 * 어느 상태에서 어디로, 누가 (4장 다이어그램).
 *
 * 주문 전이표(`seller-order-transitions.ts`)와 **같은 장치**다 — 상태 전부를
 * 덮는 레코드라 상태를 하나 더하고 여기를 안 고치면 컴파일이 깨지고, 빈 배열이
 * 곧 종착 상태다.
 *
 * 눈여겨 볼 세 줄.
 *
 * - **신청자가 자기 클레임을 승인하지 못한다.** 어느 화살표에도 `BUYER` 가
 *   없다 — 구매자가 하는 일은 신청(생성)이고, 그 뒤는 파는 쪽의 판단이다.
 * - **회수와 검수 진입은 `SYSTEM` 도 한다.** 회수가 가상이라(TASK-0067)
 *   시뮬레이터가 그 두 걸음을 민다. 판매자도 할 수 있는 것은 배송에서와 같은
 *   이유다 — 시뮬레이터가 멈춘 데모에서 흐름이 끊기면 안 된다. **`ADMIN` 이 그
 *   둘에 함께 있는 것은 TASK-0071 의 결과다**: 관리자가 판매자의 거절을 뒤집어
 *   만든 반품은 **뒤집힌 판매자가 밀어 주기를 기다릴 수 없고**, 확정 후 하자
 *   반품에는 애초에 판매자의 걸음이 없다. 결론(`INSPECTING → RETURN_COMPLETED`)에
 *   `ADMIN` 이 이미 있었으므로, 없으면 관리자가 만든 반품만 중간에서 멈춘다.
 * - **환불은 `SYSTEM` 뿐이다.** 사람이 「환불됨」을 누르는 화면은 없다. 그것은
 *   돈이 실제로 나갔다는 사실의 결과이고, 그 사실을 아는 것은 결제 쪽이다
 *   (TASK-0068).
 */
export const claimTransitions: Readonly<Record<ClaimStatus, readonly ClaimTransitionRule[]>> = {
  CANCEL_REQUESTED: [
    { to: 'CANCEL_APPROVED', actors: ['SELLER', 'ADMIN', 'SYSTEM'] },
    { to: 'CANCEL_REJECTED', actors: ['SELLER', 'ADMIN'] },
  ],
  CANCEL_APPROVED: [{ to: 'REFUNDED', actors: ['SYSTEM'] }],
  RETURN_REQUESTED: [
    { to: 'RETURN_APPROVED', actors: ['SELLER', 'ADMIN'] },
    { to: 'RETURN_REJECTED', actors: ['SELLER', 'ADMIN'] },
  ],
  RETURN_APPROVED: [{ to: 'PICKING_UP', actors: ['SYSTEM', 'SELLER', 'ADMIN'] }],
  PICKING_UP: [{ to: 'INSPECTING', actors: ['SYSTEM', 'SELLER', 'ADMIN'] }],
  INSPECTING: [
    { to: 'RETURN_COMPLETED', actors: ['SELLER', 'ADMIN'] },
    // 검수 불합격. 물건은 이미 판매자에게 있고 환불은 일어나지 않는다.
    { to: 'RETURN_REJECTED', actors: ['SELLER', 'ADMIN'] },
  ],
  RETURN_COMPLETED: [{ to: 'REFUNDED', actors: ['SYSTEM'] }],
  // 종착 셋.
  CANCEL_REJECTED: [],
  RETURN_REJECTED: [],
  REFUNDED: [],
}

export function claimRuleFor(from: ClaimStatus, to: ClaimStatus): ClaimTransitionRule | null {
  return claimTransitions[from].find((rule) => rule.to === to) ?? null
}

/** 전이가 거절되는 두 이유. 주문 쪽과 달리 조건이 없어 둘뿐이다. */
export type ClaimTransitionRefusal = 'undefined_transition' | 'actor_forbidden'

export type ClaimTransitionDecision =
  | { readonly outcome: 'allowed'; readonly rule: ClaimTransitionRule }
  | { readonly outcome: 'refused'; readonly reason: ClaimTransitionRefusal }

export function claimTransitionDecision(
  from: ClaimStatus,
  to: ClaimStatus,
  actor: SellerOrderActor,
): ClaimTransitionDecision {
  const rule = claimRuleFor(from, to)

  if (rule === null) return { outcome: 'refused', reason: 'undefined_transition' }
  if (!rule.actors.includes(actor)) return { outcome: 'refused', reason: 'actor_forbidden' }

  return { outcome: 'allowed', rule }
}

/**
 * 주문 상태가 정하는 경로 (4장 표).
 *
 * **사람이 고르지 않는다.** 「취소할까 반품할까」는 물건이 어디 있는가의 문제이지
 * 취향이 아니고, 고르게 두면 배송된 물건을 취소로 신청해 재고가 두 번 늘어난다.
 *
 * `SHIPPED` 가 `null` 인 것이 F4 다 — 배송 중에는 **아무것도 못 한다.** 취소하기엔
 * 이미 떠났고 반품하기엔 아직 안 왔다.
 */
export function claimRouteFor(orderStatus: OrderStatus): ClaimType | null {
  if (orderStatus === 'PAID' || orderStatus === 'PREPARING') return 'CANCEL'
  if (orderStatus === 'DELIVERED') return 'RETURN'

  return null
}

/**
 * 이 항목에 아직 신청할 수 있는 수량.
 *
 * **거절된 것은 다시 신청할 수 있다.** 그래서 세는 것이 「신청한 적 있는 수량」이
 * 아니라 **「살아 있는 클레임이 잡고 있는 수량」**이다 — 검수에서 떨어진 반품을
 * 두고 그 항목이 영영 잠기면, 사람이 할 수 있는 일이 없어진다.
 */
export function remainingQuantity(ordered: number, claimed: number): number {
  return Math.max(0, ordered - claimed)
}

/** 신청이 거절되는 이유. 여섯을 나누는 기준은 **사람이 할 일이 다른가**다. */
export type ClaimRefusal =
  /** 배송 중이다. 취소하기엔 떠났고 반품하기엔 안 왔다 — 도착을 기다리는 수밖에 없다 */
  | 'in_transit'
  /** 구매확정했다. 일반 반품은 끝났고 관리자 개입만 남는다 */
  | 'confirmed'
  /** 반품 기간이 지났다 */
  | 'window_closed'
  /** 이 상태의 주문에는 애초에 클레임이 없다 (결제 전·이미 취소됨 등) */
  | 'not_claimable'
  /** 남은 수량보다 많이 신청했다. `remaining` 을 함께 답한다 */
  | 'exceeds_remaining'
  /** 0개 이하를 신청했다 */
  | 'invalid_quantity'

export type ClaimEligibility =
  | { readonly outcome: 'allowed'; readonly type: ClaimType }
  | { readonly outcome: 'refused'; readonly reason: ClaimRefusal; readonly remaining: number }

export interface ClaimRequestCheck {
  readonly orderStatus: OrderStatus
  /** 배송완료로 **선언된** 순간. 반품 기간을 여기서 잰다 (TASK-0064 4.1 과 같은 기준). */
  readonly deliveredAt: Date | null
  readonly now: Date
  /** 반품을 받아 주는 기간. 설정값이다 (R2) — 구매확정 기간과 같은 축을 쓴다. */
  readonly windowMs: number
  readonly requested: number
  readonly remaining: number
}

/**
 * 이 신청을 받아도 되는가 (F1~F6 · F8).
 *
 * **순서가 답의 우선순위다.** 앞의 것이 어긋나면 뒤는 볼 필요가 없고, 무엇보다
 * 사람에게 할 말이 그 순서로 정해진다 — 배송 중인 주문에 「수량이 모자랍니다」라고
 * 답하면 수량을 고쳐 다시 시도하게 된다.
 *
 * **기간을 상태보다 뒤에 보는 이유**도 같다. 확정한 주문에 「기간이 지났습니다」는
 * 반쯤 맞는 말이라 더 나쁘다 — 기다렸으면 됐다는 뜻으로 읽힌다.
 */
export function claimEligibility(check: ClaimRequestCheck): ClaimEligibility {
  const refused = (reason: ClaimRefusal): ClaimEligibility => ({
    outcome: 'refused',
    reason,
    remaining: check.remaining,
  })

  if (check.orderStatus === 'SHIPPED') return refused('in_transit')
  if (check.orderStatus === 'CONFIRMED') return refused('confirmed')

  const type = claimRouteFor(check.orderStatus)

  if (type === null) return refused('not_claimable')
  // 반품에만 기간이 있다. 취소는 아직 물건이 떠나지 않은 상태라 기다릴 것이 없다.
  if (type === 'RETURN' && !withinReturnWindow(check)) return refused('window_closed')
  if (check.requested <= 0) return refused('invalid_quantity')
  if (check.requested > check.remaining) return refused('exceeds_remaining')

  return { outcome: 'allowed', type }
}

/**
 * 반품 기간 안인가.
 *
 * `deliveredAt` 이 없는 `DELIVERED` 주문은 **있을 수 없다** — 상태를 옮기는 문이
 * 이력을 함께 쓰기 때문이다(TASK-0059). 그래도 `null` 을 받는 이유는 부르는 쪽이
 * 그것을 증명할 수 없어서이고, 그때는 **기간이 지난 것으로 친다**: 언제 도착했는지
 * 모르는 물건에 「아직 기간이 남았다」고 답할 근거가 없다.
 */
function withinReturnWindow(check: ClaimRequestCheck): boolean {
  if (check.deliveredAt === null) return false

  return check.now.getTime() - check.deliveredAt.getTime() <= check.windowMs
}
