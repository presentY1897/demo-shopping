import type { ReportStatus, ReportTargetType } from '@prisma/client'

/**
 * 신고의 순수 판단 (TASK-0091).
 *
 * **임계치와 그 결과가 여기 있다.** 흩어지면 어떤 대상은 세 건에 가려지고 어떤
 * 대상은 영영 안 가려진다.
 */

/**
 * 자동으로 임시 숨기는 신고 수 — 3건.
 *
 * **하나로는 안 된다.** 신고 버튼 하나가 남의 글을 가릴 수 있으면 그것은 신고가
 * 아니라 검열 도구다. 반대로 너무 높으면 관리자가 자는 동안 악성 콘텐츠가 그대로
 * 남는다 — 그 사이 어딘가를 골라야 하고, 서로 다른 세 사람이 같은 것을 문제라고
 * 말했다면 일단 가리고 보는 편이 낫다.
 *
 * **같은 사람이 셋을 채울 수 없다**는 것이 이 값을 뜻 있게 만든다
 * (`Report_targetType_targetId_reporterId_key`).
 */
export const REPORT_AUTO_HIDE_THRESHOLD = 3

/**
 * 이 신고 수에서 대상을 가려야 하는가 (F3).
 *
 * **정확히 임계치에서만 참이다.** 그 뒤로도 참이면 이미 가려진 대상을 신고할 때마다
 * 다시 가리는 쓰기가 일어나고, 관리자가 반려해 복구한 대상이 네 번째 신고에 곧바로
 * 다시 가려진다 — 반려가 아무 뜻도 없어진다.
 */
export function reachesAutoHide(pendingReports: number): boolean {
  return pendingReports === REPORT_AUTO_HIDE_THRESHOLD
}

/** 처리의 결과 — 대상에 무슨 일이 일어나는가. */
export type ReportOutcome = 'HIDDEN' | 'REMOVED' | 'REJECTED'

/**
 * 처리가 대상을 가려야 하는가, 드러내야 하는가, 지워야 하는가 (F4 · F5).
 *
 * 표로 두는 이유는 **반려가 복구를 뜻한다**는 것이 잊히기 쉽기 때문이다. 자동 임시
 * 숨김이 이미 가려 놓았으므로, 반려에서 아무것도 하지 않으면 「아니라고 판단했는데
 * 계속 가려져 있는」 상태가 남는다.
 */
export const REPORT_EFFECT: Readonly<Record<ReportOutcome, 'hide' | 'reveal' | 'remove'>> = {
  HIDDEN: 'hide',
  REMOVED: 'remove',
  REJECTED: 'reveal',
}

/** 이 상태가 처리된 것인가. 처리된 신고는 다시 처리하지 않는다. */
export function isHandled(status: ReportStatus): boolean {
  return status !== 'PENDING'
}

/**
 * 대상이 「지울 수 있는」 것인가.
 *
 * **상품은 지우지 않는다.** 상품은 주문·정산·리뷰가 가리키는 행이고, 문제가 있는
 * 상품에 대한 답은 판매를 멈추는 것이지 기록을 없애는 것이 아니다 — 지우면 그
 * 상품을 산 사람의 주문 이력이 무엇을 가리키는지 알 수 없게 된다.
 */
export function removable(target: ReportTargetType): boolean {
  return target !== 'PRODUCT'
}
