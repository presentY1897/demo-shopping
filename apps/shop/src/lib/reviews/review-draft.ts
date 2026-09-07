import { REVIEW_CONTENT_MAX } from '@shopping/shared'

/**
 * 리뷰를 보내기 전에 걸리는 것들 (TASK-0083 F6).
 *
 * **서버 규칙이 아니라 요청이 되기 전의 것이다.** 별점 없는 리뷰와 빈 본문은
 * `createReviewRequestSchema` 도 거절하지만, 그 거절은 왕복 하나를 쓰고 나서야 오고
 * 「필드 오류」라는 이름 없는 모양으로 온다 — 화면은 그 전에 **어디를 고쳐야 하는지**
 * 를 말할 수 있어야 한다. 반품 신청서가 같은 이유로 `claim-draft.ts` 를 갖는다.
 *
 * **거절은 여전히 서버의 것이다.** 여기서 통과한 요청도 `REVIEW_ALREADY_WRITTEN` ·
 * `REVIEW_WINDOW_CLOSED` 로 거절될 수 있고, 그 일곱 문장은 화면이 따로 갖고 있다.
 *
 * 순수하다 — 시계도, 네트워크도, DOM 도 읽지 않는다. 그래서 이 판단은 화면을 그리지
 * 않고 부르는 것만으로 검사할 수 있다.
 */

export type ReviewDraftIssue =
  /** 별점을 고르지 않았다. 리뷰의 평균을 움직이는 값이라 비울 수 없다 */
  | 'rating_required'
  /** 본문이 비었다. 별점만 남기는 길이 열리면 평균만 움직이고 근거가 남지 않는다 */
  | 'content_required'
  | 'content_too_long'
  /** 아직 올라가는 중인 사진이 있다. 지금 보내면 그 장의 열쇠가 빠진다 (U3) */
  | 'photo_uploading'

export interface ReviewDraftInput {
  readonly rating: number
  readonly content: string
  readonly uploading: boolean
}

/**
 * 걸리는 것들을 **고칠 순서대로**.
 *
 * 화면은 첫 하나만 보인다. 넷을 한 번에 보이면 사람이 어디부터 고칠지 정해야 하고,
 * 그 판단은 화면이 대신할 수 있다.
 *
 * 별점이 0인 것이 「고르지 않았다」의 표현이다. 계약의 별점은 1~5 라
 * (`reviewRatingSchema`) 0은 값이 아니고, 그래서 `null` 을 따로 둘 필요가 없다.
 */
export function reviewDraftIssues({
  content,
  rating,
  uploading,
}: ReviewDraftInput): readonly ReviewDraftIssue[] {
  const issues: ReviewDraftIssue[] = []
  const trimmed = content.trim()

  if (rating === 0) issues.push('rating_required')
  if (trimmed === '') issues.push('content_required')
  if (trimmed.length > REVIEW_CONTENT_MAX) issues.push('content_too_long')
  if (uploading) issues.push('photo_uploading')

  return issues
}
