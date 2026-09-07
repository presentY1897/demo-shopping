import { QUESTION_CONTENT_MAX } from '@shopping/shared'

/**
 * 문의를 보내기 전에 걸리는 것들 (TASK-0088 F1).
 *
 * **서버 규칙이 아니라 요청이 되기 전의 것이다.** 빈 본문은 `questionContentSchema`
 * 도 거절하지만 그 거절은 왕복 하나를 쓰고 나서야 오고 「필드 오류」라는 이름 없는
 * 모양으로 온다 — 화면은 그 전에 **어디를 고쳐야 하는지**를 말할 수 있어야 한다.
 * 리뷰가 같은 이유로 `review-draft.ts` 를 갖는다.
 *
 * **공개 여부는 걸리는 것이 아니다.** 계약의 기본값이 공개이고(`isPublic` 의
 * `default(true)`) 둘 중 하나는 언제나 골라져 있으므로, 「고르지 않았다」라는 상태가
 * 없다.
 *
 * 순수하다 — 시계도, 네트워크도, DOM 도 읽지 않는다.
 */

export type QuestionDraftIssue =
  /** 본문이 비었다. 무엇을 묻는지 없는 문의는 판매자가 답할 수 없다 */
  'content_required' | 'content_too_long'

export function questionDraftIssues(content: string): readonly QuestionDraftIssue[] {
  const issues: QuestionDraftIssue[] = []
  const trimmed = content.trim()

  // 계약이 `z.string().trim()` 으로 받으므로 여기서도 **다듬은 뒤에** 센다. 다듬기
  // 전 길이로 재면 공백만 남긴 사람에게 「1000자까지」라고 말하게 된다.
  if (trimmed === '') issues.push('content_required')
  if (trimmed.length > QUESTION_CONTENT_MAX) issues.push('content_too_long')

  return issues
}
