import type { CreateReportRequest, ReportReason, ReportTargetType } from '@shopping/shared'
import { REPORT_DETAIL_MAX } from '@shopping/shared'

/**
 * 신고를 보내기 전에 걸리는 것들 (TASK-0091 F1).
 *
 * ## 「기타」에만 설명이 필수인 것은 계약의 규칙이다
 *
 * `createReportRequestSchema` 의 `refine` 이 그것을 거절한다. 그러니 여기서 다시
 * 세는 것은 규칙을 두 번 적는 일이 아니라, **그 거절이 오기 전에 어디를 고쳐야
 * 하는지 말하는 일**이다 — 계약의 거절은 왕복 하나를 쓰고 나서 「필드 오류」라는
 * 이름 없는 모양으로 온다. 리뷰의 `review-draft.ts` 와 같은 판단이다.
 *
 * 사유 목록을 고정한 이유가 분류인데(`reportReasons` 의 머리말), 분류되지 않는
 * 신고에 설명까지 없으면 관리자가 판단할 근거가 하나도 없다.
 *
 * ## 사유를 고르지 않은 상태가 있다
 *
 * 다이얼로그는 아무것도 고르지 않은 채로 열린다. 첫 사유를 미리 골라 두면 사람이
 * 읽지 않고 보낼 수 있고, 그렇게 들어온 「욕설」 신고는 관리자가 세는 숫자를 망친다.
 * `null` 이 그 상태이고, 계약의 enum 에는 그런 값이 없으므로 여기서만 존재한다.
 *
 * 순수하다 — 시계도, 네트워크도, DOM 도 읽지 않는다.
 */

export type ReportDraftIssue =
  | 'reason_required'
  /** 「기타」를 골랐는데 설명이 비었다 */
  | 'detail_required'
  | 'detail_too_long'

export interface ReportDraft {
  readonly reason: ReportReason | null
  readonly detail: string
}

/** 걸리는 것들을 **고칠 순서대로**. 화면은 첫 하나만 보인다. */
export function reportDraftIssues({ detail, reason }: ReportDraft): readonly ReportDraftIssue[] {
  const issues: ReportDraftIssue[] = []
  const trimmed = detail.trim()

  if (reason === null) issues.push('reason_required')
  if (reason === 'OTHER' && trimmed === '') issues.push('detail_required')
  if (trimmed.length > REPORT_DETAIL_MAX) issues.push('detail_too_long')

  return issues
}

/**
 * 보낼 본문. **비어 있는 설명은 아예 싣지 않는다.**
 *
 * `detail: ''` 는 계약에서 「빈 설명을 남겼다」이고 `undefined` 는 「설명이 없다」다.
 * 둘 다 통과하지만 남는 행이 다르고, 관리자 목록의 `targetExcerpt` 옆에 빈 문자열이
 * 붙은 줄은 「설명을 지운 신고」처럼 읽힌다.
 *
 * 사유를 고르지 않았으면 만들 수 있는 요청이 없다. {@link reportDraftIssues} 가 그
 * 경우를 먼저 걸러 주지만, **타입으로도 막는다** — 걸러졌다는 사실을 부르는 쪽이
 * 기억해야 하는 계약은 언젠가 잊힌다.
 */
export function reportRequest(
  targetType: ReportTargetType,
  targetId: string,
  { detail, reason }: ReportDraft & { readonly reason: ReportReason },
): CreateReportRequest {
  const trimmed = detail.trim()

  return { targetType, targetId, reason, ...(trimmed === '' ? {} : { detail: trimmed }) }
}
