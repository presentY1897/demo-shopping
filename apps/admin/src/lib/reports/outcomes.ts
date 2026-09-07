import type { HandleReportRequest, ReportStatus, ReportTargetType } from '@shopping/shared'
import type { BadgeVariant } from '@shopping/ui/components'

/**
 * 신고 하나에 지금 무엇을 할 수 있고, 그것이 **대상에** 무슨 일을 하는가.
 *
 * **이 파일은 거울이고, 그렇게 말해 두는 것이 요점이다.** 원본은
 * `apps/api/src/reports/report-rules.ts` 의 `REPORT_EFFECT` · `removable` ·
 * `isHandled` 이고, 그 판단들이 그리는 그림은 TASK-0091 4장이다. 저쪽은 `apps/api`
 * 안이라 브라우저가 들여올 수 없다 — `lib/settlements/transitions.ts` 와
 * `lib/sellers/decisions.ts` 가 같은 사정을 같은 방식으로 적어 두었다.
 *
 * **어긋나면 무엇이 나쁜가**도 같다. 최악은 살아 있어 보이는 버튼과 그 답으로 오는
 * 409(`REPORT_NOT_REMOVABLE`)이고, **틀린 쓰기를 만들 수는 없다** — 지울 수 있는
 * 대상인지는 서버가 다시 판정한다.
 *
 * ## 반려가 여기 표로 있는 이유
 *
 * 「반려」는 **아무 일도 안 하는 것이 아니다.** 자동 임시 숨김이 이미 대상을 가려
 * 놓았으므로, 반려는 그것을 **푸는** 처리다 (TASK-0091 4.2). 그 사실이 조건문
 * 안이 아니라 {@link REPORT_EFFECT} 라는 이름의 표에 적혀 있어야, 화면이 그것을
 * 사람에게 그대로 말할 수 있다 — 적지 않으면 운영자는 반려를 「무시」로 읽는다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/** 관리자가 신고 한 건에 대해 내리는 세 가지 판단. 순서가 곧 화면의 순서다. */
export const reportOutcomes = ['HIDDEN', 'REMOVED', 'REJECTED'] as const

export type ReportOutcome = HandleReportRequest['outcome']

/** 처리가 대상에 하는 일. `reveal` 이 반려다. */
export const reportEffects = ['hide', 'remove', 'reveal'] as const

export type ReportEffect = (typeof reportEffects)[number]

/**
 * `report-rules.ts` 의 `REPORT_EFFECT` 와 같은 이름, 같은 내용.
 *
 * `Record` 라 계약에 처리가 하나 늘면 여기가 typecheck 에서 걸린다. 안 그러면 새
 * 처리는 「대상에 무슨 일이 일어나는지 아무도 정한 적 없는 처리」로 태어나고, 그
 * 화면은 설명 없는 버튼을 하나 더 내면서 아무 검사도 빨갛게 만들지 않는다.
 */
export const REPORT_EFFECT: Readonly<Record<ReportOutcome, ReportEffect>> = {
  HIDDEN: 'hide',
  REMOVED: 'remove',
  REJECTED: 'reveal',
}

export function effectOf(outcome: ReportOutcome): ReportEffect {
  return REPORT_EFFECT[outcome]
}

/**
 * 이 대상을 지울 수 있는가 — **상품은 지울 수 없다** (TASK-0091 4.4).
 *
 * 상품은 주문·정산·리뷰가 가리키는 행이고, 문제가 있는 상품에 대한 답은 판매를
 * 멈추는 것이지 기록을 없애는 것이 아니다.
 */
export function removable(target: ReportTargetType): boolean {
  return target !== 'PRODUCT'
}

/**
 * 이 대상에 낼 수 있는 처리들, 정해진 순서로.
 *
 * 순서가 {@link reportOutcomes} 에서 오므로 대상 유형마다 선택지의 자리가 흔들리지
 * 않는다 — 리뷰에서 「숨김·삭제·반려」이던 것이 상품에서 「숨김·반려」가 되고, 그
 * 사이에 자리가 밀리면 같은 위치를 두 번 고른 사람이 다른 일을 하게 된다.
 */
export function outcomesFor(target: ReportTargetType): readonly ReportOutcome[] {
  return reportOutcomes.filter((outcome) => effectOf(outcome) !== 'remove' || removable(target))
}

/**
 * 되돌릴 수 없는 처리인가 — 확인을 한 번 더 받는 자리 (R1).
 *
 * 숨김과 반려는 서로를 되돌리지만, 삭제에는 돌아오는 화살표가 없다. 상태 이름을
 * 적지 않고 효과로 판정하는 이유는 표와 조용히 어긋날 수 있는 자리를 하나 더 만들지
 * 않기 위해서다.
 */
export function isDestructive(outcome: ReportOutcome): boolean {
  return effectOf(outcome) === 'remove'
}

/**
 * 아직 처리할 수 있는 신고인가 (`report-rules.ts` 의 `isHandled` 의 반대).
 *
 * **그래도 실패는 온다** — 목록을 읽은 뒤에 다른 관리자가 같은 신고를 처리하면
 * `REPORT_ALREADY_HANDLED` 가 돌아오고, 화면은 그것을 반드시 말해야 한다
 * (`report-console.ts` 의 `refusalOf`). 이 함수는 그 실패를 없애는 것이 아니라
 * **뻔한 실패를 줄이는** 것뿐이다.
 */
export function canHandle(status: ReportStatus): boolean {
  return status === 'PENDING'
}

/**
 * 상태가 그려지는 색.
 *
 * 대기가 `warning` 인 것이 이 표의 판단이다. 처리 대기는 **할 일**이고, 끝난 셋과
 * 같은 색으로 두면 목록을 훑는 사람이 자기 차례를 못 찾는다. 삭제가 `danger` 인
 * 것은 그것만 되돌릴 수 없기 때문이고, 반려가 `success` 인 것은 「대상이 멀쩡했다」는
 * 결론이기 때문이다 — 이 화면에서 좋은 소식은 신고가 틀렸다는 쪽이다.
 */
export function statusVariant(status: ReportStatus): BadgeVariant {
  switch (status) {
    case 'PENDING':
      return 'warning'
    case 'HIDDEN':
      return 'neutral'
    case 'REMOVED':
      return 'danger'
    case 'REJECTED':
      return 'success'
  }
}
