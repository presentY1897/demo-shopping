import type { OrderStatus } from '@shopping/shared'

import type { SellerOrderActor } from '../orders/seller-order-transitions.js'
import type { ClaimStatus } from './claim-rules.js'
import { claimStatuses } from './claim-rules.js'

/**
 * 취소의 순수 판단 (TASK-0066 · `docs/design/state-machines.md` 1장 · 4장).
 *
 * `claim-rules.ts` 옆에 따로 있는 이유는 **묻는 것이 다르기** 때문이다. 저쪽은
 * 「이 신청을 받아도 되는가」에 답하고 여기는 **「받은 신청이 뒤에 무엇을 일으키는가」**
 * 에 답한다 — 스스로 승인되는가, 그리고 이 승인으로 판매자 몫이 끝나는가. 앞의 것은
 * 반품도 함께 쓰지만(TASK-0067) 뒤의 것은 취소에만 있다.
 *
 * 데이터베이스도 시계도 보지 않는다. 그래서 분기 전부가 단위 테스트에서 닿고, 이
 * TASK 의 Q5 는 **분기 커버리지 100%** 다. 뒤집어 말하면 **닿을 수 없는 방어 분기를
 * 쓰지 않는다** — `claim-rules.ts` 와 `seller-order-transitions.ts` 가 같은 이유로
 * 같은 모양이다.
 */

/**
 * 이 취소를 **누가 승인하는가**.
 *
 * 갈림은 하나다: **판매자가 이미 손을 댔는가.**
 *
 * | 주문 상태 | 승인 | 왜 |
 * | --- | --- | --- |
 * | `PAID` | 자동(`SYSTEM`) | 판매자가 아직 아무것도 하지 않았다. 거절할 근거가 없는 판단을 사람에게 미루면 구매자는 기다리고 판매자에게는 의미 없는 업무가 생긴다 |
 * | `PREPARING` | 판매자 | 이미 포장을 시작했을 수 있다. 그 손실을 아는 것은 판 사람뿐이라 **판단이 남아 있다** |
 *
 * 전이표가 `CANCEL_REQUESTED → CANCEL_APPROVED` 에 `SYSTEM` 을 열어 둔 이유가
 * 위쪽 줄이다 (`claim-rules.ts`). 자동 승인에는 **사람이 없다** — 관리자 계정을
 * 빌려 쓰면 이력에 「관리자가 승인했다」는 거짓이 남는다.
 */
export type CancelApproval =
  /** 신청과 같은 트랜잭션에서 스스로 승인된다. 주체는 `SYSTEM` 이다. */
  | { readonly mode: 'AUTO'; readonly actor: Extract<SellerOrderActor, 'SYSTEM'> }
  /** 판매자가 승인하거나 거절할 때까지 `CANCEL_REQUESTED` 로 남는다. */
  | { readonly mode: 'REVIEW' }

/**
 * 이 주문 상태의 취소가 스스로 승인되는가.
 *
 * **「어느 상태가 취소를 여는가」는 여기서 답하지 않는다.** 그 표는
 * `claimRouteFor` 하나가 갖고, 이 함수는 그것을 이미 지나온 취소에 대해서만
 * 불린다 — 여기에 상태 목록을 한 벌 더 적으면 언젠가 둘이 다른 말을 한다.
 */
export function cancelApprovalFor(orderStatus: OrderStatus): CancelApproval {
  return orderStatus === 'PAID' ? { mode: 'AUTO', actor: 'SYSTEM' } : { mode: 'REVIEW' }
}

/**
 * 취소가 **확정된 것으로 세어지는** 상태.
 *
 * 신청만 한 수량은 여기 없다. 「판매자가 아직 보낼 것이 남았는가」를 세는 것이
 * 목적인데, 승인되지 않은 신청은 거절될 수 있고 거절되면 그 수량은 다시 살아
 * 돌아온다 (`claim.service.ts` 의 `RELEASES_QUANTITY`). 그것을 세면 **판매자가
 * 아직 보내야 하는 주문이 취소 상태로 앉는다.**
 *
 * `REFUNDED` 가 함께 있는 것은 그것이 승인의 **다음** 자리이기 때문이다 —
 * 환불까지 끝난 취소가 「확정되지 않은 취소」로 읽히면, 두 번째 부분 취소가
 * 들어올 때 첫 번째가 세어지지 않는다. 반품도 같은 자리에 도착하지만 그쪽은
 * `type` 으로 갈린다 (`claim.service.ts` 의 질의).
 *
 * `Record` 라 상태가 하나 늘면 **컴파일이 막는다.** 안 그러면 새 상태는 「세는지
 * 아무도 정한 적 없는 상태」로 태어나고, 그 결정이 빠졌다는 것은 어느 검사도
 * 알려 주지 않는다.
 */
export const CANCEL_SETTLED: Readonly<Record<ClaimStatus, boolean>> = {
  /** 아직 판단 전이다. 거절되면 이 수량은 돌아온다. */
  CANCEL_REQUESTED: false,
  CANCEL_APPROVED: true,
  CANCEL_REJECTED: false,
  /** 환불까지 끝난 취소. 승인의 다음 자리라 함께 센다. */
  REFUNDED: true,
  // 반품은 취소가 아니다. 물건이 이미 떠났고, 그 몫은 `RETURNED` 로 끝난다.
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  PICKING_UP: false,
  INSPECTING: false,
  RETURN_COMPLETED: false,
  RETURN_REJECTED: false,
}

/** 같은 목록을, 질의에 그대로 실을 수 있는 모양으로. 두 벌로 적지 않는다. */
export const cancelSettledStatuses: readonly ClaimStatus[] = claimStatuses.filter(
  (status) => CANCEL_SETTLED[status],
)

/**
 * 한 주문 항목이, 「전체인가」 판단에 필요한 만큼.
 *
 * 두 수 다 **이 승인이 반영된 뒤의 값**이다. 승인 전 값으로 판단하면 마지막 한 개를
 * 취소하는 순간이 언제나 「부분」이 된다.
 */
export interface CancelLine {
  /** 주문한 수량. */
  readonly ordered: number
  /** 취소가 확정된 수량 ({@link CANCEL_SETTLED} 인 클레임들의 합). */
  readonly canceled: number
}

export type CancelScope =
  /** 이 몫에 남은 것이 없다. `SellerOrder` 가 `CANCELED` 로 간다. */
  | 'FULL'
  /** 남은 항목은 계속 진행된다. 상태를 옮기지 않는다. */
  | 'PARTIAL'

/**
 * 이 취소로 판매자 몫이 끝나는가 (F1 · F2 · F7).
 *
 * ## 「전체」를 **남은 잔여가 0** 으로 정의한 이유
 *
 * 후보가 셋이었다 — 항목 수(줄이 전부 걸렸는가), 수량 합(이번 신청의 합이 주문
 * 수량의 합과 같은가), 그리고 잔여(취소가 확정되지 않은 수량이 하나도 없는가).
 *
 * **앞의 둘은 「이번 신청」만 본다.** 그래서 세 개를 하나씩 세 번 나눠 취소하면
 * 어느 신청도 「전체」가 아니고, 마지막 한 개가 취소된 뒤에도 판매자 몫은
 * `PREPARING` 으로 남는다 — 보낼 물건이 하나도 없는 주문이 「상품 준비중」으로
 * 영원히 앉아 있고, **아무것도 실패하지 않는다.** 부분 취소를 여러 번 하는 것이
 * 이 도메인의 정상 흐름이므로(D-027) 그 경로가 곧 정상 경로다.
 *
 * 잔여로 정의하면 그 세 번째 신청이 마지막 한 개를 데려가면서 답이 `FULL` 로
 * 바뀐다. 「전체 취소」는 **한 신청의 크기**가 아니라 **그 뒤에 남은 것의 크기**다.
 *
 * ## 「확정된 취소」만 세는 이유
 *
 * 세는 것이 잔여이므로 「무엇이 잔여를 갉아먹는가」를 정해야 한다. 살아 있는 신청이
 * 잡고 있는 수량(`OrderItem.claimedQuantity`)을 쓰면 **아직 판매자가 승인하지 않은
 * 신청**이 주문을 취소시킨다 — 그 신청이 거절되는 날 주문은 이미 `CANCELED` 이고,
 * 거기서 돌아오는 화살표는 전이표에 없다. 그래서 세는 것은
 * {@link CANCEL_SETTLED} 인 클레임의 수량뿐이다.
 *
 * 빈 목록을 따로 막지 않는다. 항목이 없는 판매자 몫은 주문 생성이 만들지 않고,
 * 닿을 수 없는 분기를 두면 이 파일의 분기 100% 가 거짓이 된다.
 */
export function cancelScopeOf(lines: readonly CancelLine[]): CancelScope {
  return lines.every((line) => line.canceled >= line.ordered) ? 'FULL' : 'PARTIAL'
}
