import type { ClaimableItem, ClaimItemInput, ReturnReason } from '@shopping/shared'
import { CLAIM_REASON_MAX_LENGTH } from '@shopping/shared'

import { returnPhotosRequired } from './return-photos'

/**
 * 신청서가 다 써졌는가 — 보내기 전에 (TASK-0066).
 *
 * **서버 규칙을 한 벌 더 적는 것이 아니다.** 잔여 수량도, 경로도, 기간도 전부
 * 서버가 답하고 이 파일은 그것을 읽기만 한다. 여기 있는 것은 **요청이 되기 전의
 * 것들** — 아무것도 안 고른 상태와 빈 사유 — 이고, 그 둘은 서버에 물어볼 필요가
 * 없다: 계약(`createClaimRequestSchema`)이 이미 400 으로 거절하는데, 그 400 은
 * 화면이 「어느 칸이 비었는지」로 바꿔 말할 수 없는 모양으로 온다.
 *
 * 순수 함수인 이유도 그것이다. 「보낼 수 있는가」는 입력만의 함수이고, 그 판단이
 * 컴포넌트 안에 있으면 화면을 그려야만 잴 수 있다.
 */

/**
 * 고른 것 — 항목 id → 수량.
 *
 * **키의 있고 없음이 곧 선택 여부다.** `{ selected: boolean, quantity: number }`
 * 로 두면 「고르지 않았는데 수량이 2인」 상태가 표현 가능해지고, 그 상태가 실제로
 * 만들어지는 날 요청에 무엇이 실릴지는 두 필드를 읽는 순서가 정한다.
 */
export type ClaimSelection = Readonly<Record<string, number>>

export type ClaimDraftIssue =
  /** 아무 항목도 고르지 않았다. 무엇을 취소할지 없는 신청이다 */
  | 'no_items'
  /** 사유가 비었다. 판매자가 읽고 판단할 것이 필요하다 */
  | 'reason_required'
  /** 사유가 계약의 상한을 넘었다 */
  | 'reason_too_long'
  /**
   * 하자·오배송 반품인데 사진이 한 장도 없다 (TASK-0067 F2).
   *
   * 서버도 같은 것을 거절하지만(`RETURN_PHOTO_REQUIRED`), 그 거절은 **사진을
   * 올리지 않은 채 보낸 뒤**에 온다. 사진을 붙이는 일은 파일을 고르고 기다리는
   * 일이라, 그것을 다 하고 나서 「사진이 필요합니다」를 읽는 것과 누르기 전에
   * 읽는 것의 차이가 크다.
   */
  | 'photo_required'
  /** 아직 올라가는 중인 사진이 있다. 지금 보내면 그 장이 빠진 신청이 된다 */
  | 'photo_uploading'

/**
 * 반품 경로에서만 있는 칸들 — 사유와, 지금까지 붙은 사진.
 *
 * 취소면 통째로 `null` 이다. 「사유는 있는데 취소인」 상태를 표현할 수 없게 하는
 * 것이 요점이고, 계약이 `fault` 와 `return` 을 둘 중 하나로 좁혀 둔 것과 같은
 * 모양이다 (`createClaimRequestSchema`).
 */
export interface ReturnDraft {
  readonly returnReason: ReturnReason
  /** **올라간 것만.** 올라가는 중인 장은 아래 `uploading` 이 말한다 */
  readonly photoKeys: readonly string[]
  readonly uploading: boolean
}

export interface ClaimDraft {
  readonly selection: ClaimSelection
  readonly reason: string
  readonly returns: ReturnDraft | null
}

/**
 * 지금 이 신청서에 남은 문제들. 비어 있으면 보낼 수 있다.
 *
 * 배열인 것은 **둘 다 비어 있을 수 있기** 때문이다. 하나만 돌려주면 사람은 항목을
 * 고르고 나서야 사유가 필요하다는 것을 알게 되고, 그것은 같은 화면을 두 번 읽게
 * 만드는 일이다.
 */
export function claimDraftIssues(draft: ClaimDraft): readonly ClaimDraftIssue[] {
  const issues: ClaimDraftIssue[] = []
  const reason = draft.reason.trim()

  if (Object.keys(draft.selection).length === 0) issues.push('no_items')
  if (reason.length === 0) issues.push('reason_required')
  else if (reason.length > CLAIM_REASON_MAX_LENGTH) issues.push('reason_too_long')

  if (draft.returns !== null) {
    if (returnPhotosRequired(draft.returns.returnReason) && draft.returns.photoKeys.length === 0) {
      issues.push('photo_required')
    }
    // **올라가는 중인 장이 있으면 아직이다.** 지금 보내면 그 장의 열쇠가 없는
    // 신청서가 나가고, 사람은 자기가 붙인 사진 하나가 사라진 것을 신청 뒤에야
    // 알게 된다 — 그때는 고칠 방법이 없다.
    if (draft.returns.uploading) issues.push('photo_uploading')
  }

  return issues
}

/** 고른 것을 요청의 줄로. 순서는 목록에 보이는 순서 그대로다. */
export function claimLinesOf(
  selection: ClaimSelection,
  items: readonly ClaimableItem[],
): readonly ClaimItemInput[] {
  return items
    .filter((item) => selection[item.orderItemId] !== undefined)
    .map((item) => ({ orderItemId: item.orderItemId, quantity: selection[item.orderItemId] ?? 0 }))
}

/**
 * 한 항목을 고르고, 또는 고르기를 물린다.
 *
 * 고를 때 수량이 **1** 인 이유는 그것이 이 도메인의 정상 흐름이기 때문이다 —
 * 「항목 셋 중 하나, 그 수량 중 일부」(D-027). 잔여 전부를 기본값으로 두면 부분
 * 취소가 한 번 더 누르는 일이 되고, 전체 취소는 어차피 항목마다 수량을 골라야 한다.
 */
export function withItem(
  selection: ClaimSelection,
  orderItemId: string,
  chosen: boolean,
): ClaimSelection {
  if (!chosen) {
    const { [orderItemId]: _removed, ...rest } = selection

    return rest
  }

  return { ...selection, [orderItemId]: selection[orderItemId] ?? 1 }
}

/** 고른 항목의 수량을 바꾼다. 고르지 않은 항목은 건드리지 않는다. */
export function withQuantity(
  selection: ClaimSelection,
  orderItemId: string,
  quantity: number,
): ClaimSelection {
  if (selection[orderItemId] === undefined) return selection

  return { ...selection, [orderItemId]: quantity }
}

/**
 * 이 항목에 고를 수 있는 수량들 — **서버가 답한 잔여까지**.
 *
 * 화면이 `quantity - claimedQuantity` 를 계산하지 않는다. 그 뺄셈의 정의가 한
 * 곳에만 있어야 하고(계약의 `claimableItemSchema` 주석), 무엇보다 다른 탭에서
 * 방금 신청한 것이 이 화면의 뺄셈에는 반영되지 않는다.
 */
export function quantityChoices(item: ClaimableItem): readonly number[] {
  return Array.from({ length: item.remainingQuantity }, (_, index) => index + 1)
}
