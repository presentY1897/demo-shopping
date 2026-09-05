import type { ReservationStatus } from '@prisma/client'

/**
 * 예약의 순수 판단 (TASK-0048).
 *
 * 서비스에서 떼어 놓은 이유는 **여기가 틀리면 오버셀이거나 재고가 잠기는 것**이고,
 * 둘 다 실패로 나타나지 않기 때문이다. 오버셀은 팔린 뒤에 알고, 잠긴 재고는 아무도
 * 신고하지 않는다. I/O 가 없으므로 분기 전부가 단위 테스트에서 닿는다 — 이 TASK 의
 * Q5 는 **분기 커버리지 100%** 다(6.2).
 */

/** 예약의 기본 유효 시간. 주문서에 머무는 시간으로 잡은 값이다 (R2). */
export const RESERVATION_TTL_MS = 15 * 60 * 1000

/**
 * 가용재고 = `stock` − `reserved`.
 *
 * `stock` 은 예약으로 줄지 않는다. 줄여 버리면 확정 때 또 줄여야 하는지를 매번
 * 따져야 하고, 원장의 합과 `stock` 이 어긋난다 — 원장이 사실이고 `stock` 은 그
 * 결과라는 규약(TASK-0036)이 깨진다.
 *
 * 음수를 0으로 접는다. `ProductVariant_reserved_check` 가 이미 그 상태를 막지만,
 * 이 함수가 만드는 것은 **사람이 볼 숫자**라 접는 데에 표시로서의 뜻이 있다 —
 * 「-2개 남음」은 아무에게도 아무 뜻이 아니다.
 */
export function availableStock(stock: number, reserved: number): number {
  return Math.max(0, stock - reserved)
}

/** 지금부터 TTL 만큼 뒤. */
export function expiryFrom(now: Date, ttlMs: number = RESERVATION_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs)
}

/** 정산 요청이 이 예약에 무엇을 해야 하는가. */
export type Settlement =
  /** 아직 잡혀 있다 — 요청한 대로 정산한다. */
  | 'apply'
  /** 이미 그 상태다 — 아무것도 하지 않고 성공으로 답한다 (F4). */
  | 'noop'
  /** 반대쪽으로 이미 끝났다 — 거절한다. */
  | 'refuse'

/**
 * 확정·해제 요청 하나가 이 상태의 예약에 무엇을 해야 하는지 (F4).
 *
 * 세 가지가 나오고 셋 다 실제로 일어난다.
 *
 * **`noop`** 은 멱등이다. 결제 승인 웹훅은 두 번 온다고 가정해야 하고, 만료
 * 스케줄러와 이탈한 사용자는 같은 예약을 동시에 해제하려 든다. 두 번째를 오류로
 * 답하면 부르는 쪽이 「실패했으니 되돌려야 하나」를 판단해야 하는데, 되돌릴 것이
 * 없다.
 *
 * **`refuse`** 는 반대다. 해제된 예약을 확정하는 것은 **없는 재고를 파는 일**이고
 * — TTL 이 지나 스케줄러가 풀어 준 뒤에 결제가 승인되면 정확히 그 모양이 된다 —
 * 확정된 예약을 해제하는 것은 **이미 팔린 재고를 되돌려 놓는 일**이다. 둘 다
 * 조용히 성공하면 안 되는 쪽이고, 그래서 만료 스케줄러도 `CONFIRMED` 는 건드리지
 * 않는다(TASK-0051 요구사항 3).
 */
export function settlement(
  status: ReservationStatus,
  target: 'CONFIRMED' | 'RELEASED',
): Settlement {
  if (status === 'HELD') return 'apply'

  return status === target ? 'noop' : 'refuse'
}
