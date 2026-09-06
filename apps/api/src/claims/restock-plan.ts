import type { StockLedgerType } from '@shopping/shared'

import type { ClaimStatus, ClaimType } from './claim-rules.js'

/**
 * 재고 복원의 순수 판단 (TASK-0069).
 *
 * 되돌리는 일 자체는 원장 서비스가 이미 할 줄 안다(`stock.service.ts`). 이 파일에
 * 남은 것은 **그 문을 언제 지나고 언제 지나지 않는가**이고, 그 셋이 전부 조용히
 * 틀린다 — 그래서 데이터베이스도 시계도 보지 않는 자리로 떼어 두었고, 이 TASK 의
 * Q5 는 이 파일에 대한 **분기 커버리지 100%** 다.
 *
 * | 판단 | 틀리면 |
 * | --- | --- |
 * | {@link restockDue} — 이 자리가 「물건이 우리 손에 있다」인가 | **검수 불합격한 반품이 재입고된다.** 물건은 구매자에게 반송되는데 재고는 늘어 있고, 그 재고는 팔린 뒤에야 없는 것으로 드러난다 |
 * | {@link RESTOCK_TYPE} — 어느 원장 유형으로 적는가 | 원장만 보고는 취소와 반품을 구분할 수 없게 된다. 「반품이 얼마나 들어오나」는 그 구분으로만 답할 수 있는 물음이다 |
 * | {@link restockDecision} — 이 줄을 되돌리는가 | 두 번 되돌리면 **없는 재고를 판다**. 사라진 상품에 되돌리면 아무도 살 수 없는 재고가 된다 |
 *
 * 어느 것도 빨간 검사로 나타나지 않는다. 증상은 몇 주 뒤 재고 실사에서 맞지 않는
 * 숫자 하나다.
 */

/**
 * 어느 클레임이 어느 원장 유형으로 되돌아오는가 (`docs/design/erd.md` 3장의 표).
 *
 * `switch` 가 아니라 레코드다 — 유형이 하나 늘면 여기가 컴파일되지 않고, 그것이 새
 * 경로가 **유형 없이** 원장에 닿는 것을 막는 유일한 방법이다
 * (`stockDirections` 가 같은 이유로 같은 모양이다).
 *
 * 둘을 한 유형으로 접지 않는 이유는 원장이 답해야 할 물음이 다르기 때문이다 —
 * 취소는 **떠나지 않은** 물건이고 반품은 **돌아온** 물건이다. 재판매까지의 손질도,
 * 정산(M12)이 세는 대상도 그 둘에서 다르다.
 */
export const RESTOCK_TYPE: Readonly<Record<ClaimType, StockLedgerType>> = {
  CANCEL: 'CANCEL',
  RETURN: 'RETURN_IN',
}

/**
 * 물건이 판매자 손에 있다고 말할 수 있는 자리 — 유형별로.
 *
 * **상태 전부를 덮는 레코드**라 `claim-rules.ts` 에 상태가 하나 늘면 여기가
 * 컴파일되지 않는다. 빈 배열이 「이 자리에서는 아무것도 되돌리지 않는다」다.
 *
 * 눈여겨 볼 두 줄.
 *
 * - **`RETURN_REJECTED` 가 비어 있다.** 검수 불합격은 이 TASK 가 막아야 할 바로 그
 *   경우다 — 물건은 구매자에게 반송되므로 판매자의 재고가 아니다
 *   (`return-rules.ts` 의 `returnInspectionOutcome`).
 * - **`REFUNDED` 에 둘 다 있다.** 두 경로가 만나는 유일한 자리이고, 실제로 복원이
 *   대부분 여기서 온다 — 부르는 쪽이 환불을 먼저 부르므로(`claim.service.ts` 의
 *   `publishCancel`) 재고 차례가 됐을 때 클레임은 이미 `REFUNDED` 다. 그 자리를
 *   빼면 **정상 흐름에서 재고가 영영 돌아오지 않으면서 아무것도 실패하지 않는다.**
 *   그리고 여기 `RETURN` 을 실어도 불합격한 반품이 새지 않는다: 전이표에
 *   `RETURN_REJECTED` 를 떠나는 화살표가 없어 그 클레임은 `REFUNDED` 에 닿지 못한다.
 */
export const RESTOCK_STATUSES: Readonly<Record<ClaimStatus, readonly ClaimType[]>> = {
  CANCEL_REQUESTED: [],
  CANCEL_APPROVED: ['CANCEL'],
  CANCEL_REJECTED: [],
  RETURN_REQUESTED: [],
  RETURN_APPROVED: [],
  PICKING_UP: [],
  // 검수 전이다. 물건은 와 있지만 팔 수 있는 물건인지 아직 모른다.
  INSPECTING: [],
  RETURN_COMPLETED: ['RETURN'],
  RETURN_REJECTED: [],
  REFUNDED: ['CANCEL', 'RETURN'],
}

/** 이 유형의 클레임이 이 상태에서 재고를 되돌리는가. */
export function restockDue(type: ClaimType, status: ClaimStatus): boolean {
  return RESTOCK_STATUSES[status].includes(type)
}

/** 한 줄에 대한 답 셋. */
export type RestockOutcome =
  /** 되돌린다. */
  | 'restock'
  /** 이 클레임 항목으로 이미 원장에 적혀 있다. */
  | 'already_recorded'
  /** 상품이 사라졌다. 되돌릴 곳이 없다 */
  | 'variant_deleted'

/** 한 줄이 아는 전부. 전부 저장된 사실이고 판단은 아래 한 함수에만 있다. */
export interface RestockCandidate {
  /** 멱등의 열쇠 — 원장의 `refId` 로 들어간다. */
  readonly claimItemId: string
  readonly variantId: string
  /** 되돌릴 수량. `ClaimItem.quantity` 그대로다. */
  readonly quantity: number
  /**
   * 상품 옵션이 **소프트 삭제**됐는가 (`ProductVariant.deletedAt`).
   *
   * `isActive` 가 아니다. 그것은 판매자가 「지금은 이 조합을 안 판다」고 말한 것이라
   * 되살아날 수 있고, 그때 되돌려 두지 않은 재고는 되돌릴 방법이 없다. 행 자체가
   * 사라졌는지를 묻지 않는 이유도 하나다 — `StockLedger.variantId` 와
   * `OrderItem.variantId` 가 둘 다 `RESTRICT` 라 **팔린 적 있는 조합은 하드 삭제될
   * 수 없다.** 상품 삭제도 데모 계정 만료도 `deletedAt` 을 찍는다
   * (`product.service.ts` · `demo-cleanup.service.ts`).
   */
  readonly variantDeleted: boolean
  /** 이 클레임 항목으로 이미 기록된 원장 행이 있는가. */
  readonly recorded: boolean
}

/**
 * 이 줄을 되돌리는가, 아니면 왜 안 되돌리는가.
 *
 * **순서가 답의 뜻을 정한다.** 이미 적힌 줄을 먼저 보는 이유는, 되돌린 **뒤에**
 * 상품이 사라지는 것이 정상 순서이기 때문이다 — 그때 「사라져서 못 했다」고 답하면
 * 실제로는 이미 끝난 일에 대해 거짓 경고가 나가고, 사람은 없는 재고를 찾아다닌다.
 *
 * 사라진 상품을 **건너뛰되 실패시키지 않는 것**이 TASK 문서 4장의 요구다. 던지면
 * 클레임 처리 전체가 되돌아가는데, 되돌려서 좋을 것이 하나도 없다: 돈은 이미
 * 나갔고, 물건은 이미 판매자에게 있다.
 */
export function restockDecision(candidate: RestockCandidate): RestockOutcome {
  if (candidate.recorded) return 'already_recorded'
  if (candidate.variantDeleted) return 'variant_deleted'

  return 'restock'
}
