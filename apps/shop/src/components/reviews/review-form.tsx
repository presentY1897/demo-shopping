'use client'

import { REVIEW_CONTENT_MAX, REVIEW_IMAGE_MAX_COUNT } from '@shopping/shared'
import { Button, Radio, RadioGroup, Textarea } from '@shopping/ui/components'
import { useEffect, useId, useState } from 'react'

import { RATING_STARS } from '@/lib/reviews/rating'
import { reviewDraftIssues } from '@/lib/reviews/review-draft'
import type { ReviewDraft } from '@/lib/reviews/use-reviewable-items'
import { usePhotoUploads } from '@/lib/uploads/use-photo-uploads'
import type { ReviewFormMessages } from '@/messages'

import { PhotoField } from '../uploads/photo-field'

/**
 * 별점·본문·사진을 받는 폼 (TASK-0083 F6).
 *
 * ## 새로 쓰는 것과 고치는 것이 한 폼이다
 *
 * 계약의 두 요청이 같은 셋을 받는다(`createReviewRequestSchema` ·
 * `updateReviewRequestSchema`) — 다른 것은 주문 항목을 가리키느냐뿐이고 그것은 폼이
 * 아니라 줄이 안다. 두 벌로 나누면 다음 문구 수정이 들어갈 자리가 둘이 된다.
 *
 * ## 사진은 반품 신청서와 **같은 훅**이다
 *
 * `usePhotoUploads` 하나이고 목적만 다르다(`review-image`). 두 벌이 되면 갈라지는
 * 것은 재시도·정리·상한 처리이고, 그 갈라짐은 한 화면에서만 드러나 오래 남는다.
 *
 * 고칠 때는 **이미 붙어 있던 열쇠로 목록을 다시 세운다.** `imageKeys` 는 대입이지
 * 병합이 아니므로, 빈 목록에서 시작하면 사람이 사진을 건드리지 않고 저장하는 순간
 * 붙어 있던 사진이 전부 떨어진다.
 *
 * ## 별점은 라디오다
 *
 * 별 다섯 개를 버튼으로 그리면 「지금 몇 점인가」가 눈에만 보인다. 라디오 그룹은
 * 화살표로 옮길 수 있고 지금 값을 읽어 주며(F8), 그 위에 별 모양을 얹는 것은 다음
 * 일이다 — 값을 나르는 것은 이름이지 그림이 아니다.
 */
export function ReviewForm({
  busy,
  cancelLabel,
  copy,
  initial,
  onCancel,
  onSubmit,
  submitLabel,
  submittingLabel,
}: {
  readonly busy: boolean
  readonly cancelLabel: string
  readonly copy: ReviewFormMessages
  /** 고칠 때 채워 넣는 값. 새로 쓸 때는 `null` 이다. */
  readonly initial: ReviewDraft | null
  readonly onCancel: () => void
  readonly onSubmit: (draft: ReviewDraft) => void
  readonly submitLabel: string
  readonly submittingLabel: string
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [content, setContent] = useState(initial?.content ?? '')
  /**
   * 눌러 보기 전에는 오류를 그리지 않는다. 아무것도 쓰지 않은 채 폼을 연 사람에게
   * 「별점을 골라주세요」를 먼저 보이면, 그것은 안내가 아니라 **아직 하지 않은 일에
   * 대한 지적**이다.
   */
  const [attempted, setAttempted] = useState(false)

  const photos = usePhotoUploads({ purpose: 'review-image', maxCount: REVIEW_IMAGE_MAX_COUNT })
  const { reset } = photos
  const initialKeys = initial?.imageKeys

  useEffect(() => {
    // 고치는 폼은 「이 리뷰에 이미 붙은 사진」에서 시작한다. 새로 쓰는 폼은 비었다.
    reset(initialKeys ?? [])
  }, [initialKeys, reset])

  const legendId = useId()
  const ratingId = useId()
  const contentId = useId()
  const issuesId = useId()

  const issues = reviewDraftIssues({ content, rating, uploading: photos.uploading })
  const shown = attempted ? issues : []
  const issue = shown[0]

  function send(): void {
    setAttempted(true)

    // 이 렌더의 값으로 판단한다. 사람이 누른 것이 화면에 보이던 그 상태이므로,
    // 상태 갱신을 기다렸다 다시 세는 것은 같은 답을 한 프레임 늦게 얻는 일이다.
    if (issues.length > 0) return

    onSubmit({ content: content.trim(), imageKeys: photos.keys, rating })
  }

  return (
    <section
      aria-labelledby={legendId}
      className="border-border flex flex-col gap-4 rounded-md border p-4"
    >
      <h4 className="text-fg text-sm font-semibold" id={legendId}>
        {copy.legend}
      </h4>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-fg text-sm font-medium" id={ratingId}>
          {copy.ratingLegend}
        </legend>

        <RadioGroup
          aria-describedby={issuesId}
          aria-labelledby={ratingId}
          invalid={shown.includes('rating_required')}
          onValueChange={(value) => {
            setRating(Number(value))
          }}
          orientation="horizontal"
          value={rating === 0 ? undefined : String(rating)}
        >
          {Array.from({ length: RATING_STARS }, (_unused, index) => index + 1).map((score) => (
            <Radio
              key={score}
              label={copy.ratingOption.replace('{score}', String(score))}
              value={String(score)}
            />
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className="text-fg text-sm font-medium" htmlFor={contentId}>
          {copy.contentLabel}
        </label>
        <p className="text-fg-muted text-xs">
          {copy.contentHint.replace('{max}', String(REVIEW_CONTENT_MAX))}
        </p>
        <Textarea
          aria-describedby={issuesId}
          id={contentId}
          invalid={shown.includes('content_required') || shown.includes('content_too_long')}
          onChange={(event) => {
            setContent(event.target.value)
          }}
          placeholder={copy.contentPlaceholder}
          rows={4}
          value={content}
        />
      </div>

      <PhotoField copy={copy.photos} invalid={false} issue="" uploads={photos} />

      {/*
        문장이 하나뿐이어도 **자리는 남는다** (U2). 나타났다 사라지는 줄은 그 아래
        버튼을 위아래로 움직이게 하고, 사람은 누르려던 것을 놓친다.
      */}
      <p className="text-danger min-h-5 text-sm" id={issuesId} role="status">
        {issue === undefined ? '' : copy.issues[issue].replace('{max}', String(REVIEW_CONTENT_MAX))}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button loading={busy} onClick={send} type="button">
          {busy ? submittingLabel : submitLabel}
        </Button>
        <Button onClick={onCancel} type="button" variant="ghost">
          {cancelLabel}
        </Button>
      </div>
    </section>
  )
}
