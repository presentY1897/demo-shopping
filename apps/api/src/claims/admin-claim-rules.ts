import type { OrderStatus } from '@shopping/shared'

import type { FulfillmentPace } from '../config/app-config.js'
import { claimEarliestDueMs } from './claim-deadline.js'
import type { ClaimEligibility, ClaimRequestCheck, ClaimStatus, ClaimType } from './claim-rules.js'
import { claimRouteFor } from './claim-rules.js'

/**
 * 관리자 개입의 순수 판단 (TASK-0071 · `docs/design/state-machines.md` 1장 · 4장).
 *
 * `claim-rules.ts` 옆에 따로 있는 이유는 **묻는 사람이 다르기** 때문이다. 저쪽은
 * 「이 사람이 지금 스스로 신청할 수 있는가」에 답하고, 여기는 **「관리자가 지금
 * 개입할 수 있는가」**에 답한다. 두 답이 다른 자리가 정확히 둘이고, 그 둘이 이
 * TASK 의 요구사항이다 — 구매확정한 주문과, 반품 기간이 지난 주문.
 *
 * **저쪽 함수를 고치지 않는 것이 요점이다.** `claimEligibility` 가 `CONFIRMED` 를
 * 거절하는 것은 **구매자에게 옳은 답**이고(「구매확정한 주문은 고객센터로 문의해
 * 주세요」), 거기에 관리자용 갈래를 넣으면 한 함수가 두 사람에게 다른 말을 하게 된다.
 * 그때 실수 하나가 「구매자가 확정 후에도 스스로 반품할 수 있다」이고, 그것은 빨간
 * 검사가 아니라 정산이 회수할 수 없는 반품으로 나타난다.
 *
 * 데이터베이스도 시계도 보지 않는다 — 「지금」은 인자로 받는다. 그래서 분기 전부가
 * 단위 스펙에서 닿고, 이 TASK 의 Q5 는 **분기 커버리지 100%** 다. 뒤집어 말하면
 * **닿을 수 없는 방어 분기를 쓰지 않는다**.
 */

/**
 * 관리자에게 이 주문이 열어 주는 경로.
 *
 * **표를 새로 적지 않는다.** `claimRouteFor` 가 이미 그 표이고, 여기서 하는 일은
 * **칸 하나를 더하는 것**뿐이다 — `CONFIRMED → RETURN`. 목록을 통째로 옮겨 적으면
 * 「`SHIPPED` 에는 길이 없다」 같은 규칙이 두 벌이 되고, 언젠가 한쪽만 고쳐진다.
 *
 * `CONFIRMED` 가 여기서만 열리는 것이 4.0 의 결론이다. 「확정은 끝」이 「확정은
 * **구매자에게** 끝」으로 약해질 뿐이고, 주문 전이표의 `CONFIRMED → RETURNED` 도
 * 같은 이유로 주체가 `ADMIN` 뿐이다.
 *
 * `SHIPPED` 는 관리자에게도 `null` 이다. 취소하기엔 이미 떠났고 반품하기엔 아직 안
 * 왔다는 사실은 권한의 문제가 아니라 물건이 어디 있는가의 문제이고, 여기서 취소를
 * 열면 **아직 배송 중인 물건의 재고가 되돌아온다.**
 */
export function adminClaimRouteFor(orderStatus: OrderStatus): ClaimType | null {
  if (orderStatus === 'CONFIRMED') return 'RETURN'

  return claimRouteFor(orderStatus)
}

/**
 * 관리자가 이 개입을 만들어도 되는가.
 *
 * **거절 넷이고, 구매자 쪽 여섯에서 둘이 빠졌다.**
 *
 * | 빠진 것 | 왜 |
 * | --- | --- |
 * | `confirmed` | 확정 후 하자 반품이 이 라우트의 목적이다. 여기서 거절하면 TASK 의 절반이 없다 |
 * | `window_closed` | 반품 기간은 구매자가 **스스로** 신청할 수 있는 창이지 관리자의 판단을 가두는 값이 아니다. 이의 제기와 검토가 그 창보다 오래 걸리는 것이 정상이고, 기간으로 막으면 **뒤집을 수 있는 거절이 시간이 지나 뒤집을 수 없게 된다** |
 *
 * 남은 넷의 **순서는 구매자 쪽과 같다.** 앞의 것이 어긋나면 뒤는 볼 필요가 없고,
 * 무엇보다 사람에게 할 말이 그 순서로 정해진다 — 배송 중인 주문에 「수량이
 * 모자랍니다」라고 답하면 수량을 고쳐 다시 시도하게 된다.
 *
 * 인자가 `ClaimRequestCheck` 그대로인 것은 **부르는 쪽이 하나이기 때문**이다
 * (`ClaimService` 의 신청 문). 여기서 읽지 않는 칸이 셋 있지만(도착 시각 · 지금 ·
 * 기간), 인자를 좁히면 그 문이 어느 판정자를 받았는지에 따라 다른 값을 만들어야 하고
 * 그 갈래가 곧 「관리자인가」라는 조건문이 된다 — 없애려던 바로 그것이다.
 */
export function adminClaimEligibility(check: ClaimRequestCheck): ClaimEligibility {
  const refused = (
    reason: 'in_transit' | 'not_claimable' | 'invalid_quantity' | 'exceeds_remaining',
  ): ClaimEligibility => ({
    outcome: 'refused',
    reason,
    remaining: check.remaining,
  })

  if (check.orderStatus === 'SHIPPED') return refused('in_transit')

  const type = adminClaimRouteFor(check.orderStatus)

  if (type === null) return refused('not_claimable')
  if (check.requested <= 0) return refused('invalid_quantity')
  if (check.requested > check.remaining) return refused('exceeds_remaining')

  return { outcome: 'allowed', type }
}

/**
 * 이 상태의 클레임을 **뒤집을 수 있는가**.
 *
 * 뒤집는다는 것은 「판매자가 낸 결론을 관리자가 다른 결론으로 대신한다」이므로,
 * 대상은 **결론이 이미 난 것**이어야 한다. 진행 중인 클레임에 개입이 필요하면 그것은
 * 뒤집기가 아니라 그냥 처리이고, 관리자는 전이표의 화살표로 그 일을 한다 —
 * `claimTransitions` 의 승인·거절·검수에 `ADMIN` 이 이미 있다.
 *
 * `REFUNDED` 가 빠진 것이 눈여겨볼 자리다. 환불까지 끝난 클레임은 **이미 구매자가
 * 원한 결과**라 뒤집을 것이 없고, 뒤집는다면 그것은 「돈을 도로 받는 일」이라 이
 * 도메인에 없는 절차다.
 *
 * `Record` 라 상태가 하나 늘면 **컴파일이 막는다.** 안 그러면 새 상태는 「뒤집을 수
 * 있는지 아무도 정한 적 없는 상태」로 태어나고, 그 결정이 빠졌다는 것은 어느 검사도
 * 알려 주지 않는다 (`RELEASES_QUANTITY` · `CANCEL_SETTLED` 와 같은 장치).
 */
export const CLAIM_OVERTURNABLE: Readonly<Record<ClaimStatus, boolean>> = {
  /** 판매자가 낸 결론 둘. 이 TASK 가 뒤집는 것이 정확히 이것이다. */
  CANCEL_REJECTED: true,
  RETURN_REJECTED: true,
  // 아직 결론이 아니다. 관리자는 전이표의 화살표로 직접 처리한다.
  CANCEL_REQUESTED: false,
  CANCEL_APPROVED: false,
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  PICKING_UP: false,
  INSPECTING: false,
  RETURN_COMPLETED: false,
  /** 이미 구매자가 원한 결과다. 되돌리는 것은 돈을 도로 받는 일이라 절차가 없다. */
  REFUNDED: false,
}

export function canOverturn(status: ClaimStatus): boolean {
  return CLAIM_OVERTURNABLE[status]
}

/**
 * 지연 목록이 **훑기 시작할 시각** — 이보다 나중에 신청된 것은 아직 기한 안이다.
 *
 * ## 왜 정확한 조건이 아니라 컷오프인가
 *
 * 기한은 영업일로 센다(`claim-deadline.ts`). SQL 은 주말도 시간대도 모르고, 그
 * 계산을 질의로 내려보내면 **정의가 두 벌**이 된다 — 그때 지연 뱃지와 지연 목록이
 * 서로 다른 건을 가리키고, 어느 쪽도 실패하지 않는다.
 *
 * 그래서 **넘치게 읽고 정확히 거른다.** 이 함수가 주는 것은 「가장 짧은 기한조차
 * 지났을 수 있는」 시각이고, 그보다 나중에 신청된 건은 **어떤 요일에 신청됐더라도**
 * 아직 기한 안이다. 정확한 판정은 그 뒤에 `isClaimOverdue` 가 한다.
 *
 * 성립하는 근거는 부등식 하나다 — 모든 신청에 대해 `기한 ≥ 신청 + 최소 기한`이므로,
 * 「지금 > 기한」인 건은 반드시 「신청 < 지금 − 최소 기한」이다. 즉 **놓치는 건이
 * 없다**(거짓 음성 0). 반대로 이 컷오프를 지난 것 중 아직 기한 안인 건은 섞여
 * 들어오지만, 그것은 뒤의 순수 함수가 걸러 낸다.
 */
export function adminOverdueScanBefore(now: Date, pace: FulfillmentPace): Date {
  return new Date(now.getTime() - claimEarliestDueMs(pace))
}
