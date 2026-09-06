import type { SettlementStatus } from '@prisma/client'

/**
 * 정산서의 상태 전이 (TASK-0081, `state-machines.md` 5장).
 *
 * ```
 * PENDING → APPROVED · PENDING → HOLD · HOLD → APPROVED · APPROVED → PAID
 * ```
 *
 * **표로 두는 이유는 여기 없는 화살표를 불가능하게 만들기 위해서다.** 서비스가
 * `if` 로 흩어 쓰면 「지급완료된 정산서를 다시 승인」 같은 전이는 아무도 막지
 * 않는 것이 아니라 **아무도 생각하지 않은 것**이 되고, 그 차이는 사고가 난 뒤에만
 * 보인다 (`orders/seller-order-transitions.ts` 가 같은 이유로 같은 모양이다).
 *
 * ## 되돌아가는 화살표가 없다
 *
 * 승인은 「금액이 이것으로 굳었다」는 선언이고, 지급완료는 「돈이 나갔다」는
 * 선언이다 (F5). 되돌리는 화살표를 두면 그 선언에 뜻이 없어지고, 배치가 승인된
 * 정산서를 고치지 않는다는 규칙(TASK-0080)의 근거도 함께 사라진다. **오류는 다음
 * 회차에서 조정한다** — 그것이 이 도메인이 잘못을 고치는 방법이다.
 *
 * ## 「거절」이 없다
 *
 * 보류에서 갈 수 있는 곳은 승인뿐이다. 정산은 거절할 수 있는 것이 아니다 — 판 것을
 * 없던 일로 만들 수는 없고, 금액이 틀렸으면 고쳐서 다음 회차에서 조정한다. 보류는
 * 승인의 반대가 아니라 **판단을 미룬 상태**다.
 */
export const settlementTransitions: Readonly<
  Record<SettlementStatus, readonly SettlementStatus[]>
> = {
  PENDING: ['APPROVED', 'HOLD'],
  HOLD: ['APPROVED'],
  APPROVED: ['PAID'],
  PAID: [],
}

/** 이 전이가 표에 있는가. */
export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return settlementTransitions[from].includes(to)
}

/**
 * 배치가 이 정산서를 아직 고칠 수 있는가 (TASK-0080).
 *
 * **승인된 뒤에는 아무도 금액을 바꾸지 않는다.** 보류도 마찬가지다 — 사람이 들여다
 * 보고 있는 숫자가 그 사이에 움직이면 무엇을 보류한 것인지 알 수 없게 된다.
 */
export function isAmendable(status: SettlementStatus): boolean {
  return status === 'PENDING'
}

/**
 * 이 상태로 올 수 있는 곳들.
 *
 * 서비스가 「승인은 대기와 보류에서 온다」를 자기 파일에 적지 않게 하려고 있다 —
 * 표가 하나뿐이어야 문서와 견줄 자리도 하나다. 조건부 갱신의 `WHERE status IN (…)`
 * 이 이 목록을 그대로 쓴다.
 */
export function sourcesOf(to: SettlementStatus): readonly SettlementStatus[] {
  return Object.entries(settlementTransitions)
    .filter(([, targets]) => targets.includes(to))
    .map(([from]) => from as SettlementStatus)
}
