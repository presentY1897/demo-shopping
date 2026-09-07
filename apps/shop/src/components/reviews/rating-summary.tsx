'use client'

import type { RatingSummary } from '@shopping/shared'
import { StarIcon } from '@shopping/ui/components'

import type { RatingDisplay } from '@/lib/reviews/exposure'
import { filledStars, RATING_STARS, ratingText } from '@/lib/reviews/rating'
import type { ProductReviewsMessages } from '@/messages'

/**
 * 평점 요약 — 밀도가 정하는 것은 **얼마나 보이는가**다 (TASK-0084 F5).
 *
 * | 미니멀 | 표준 | 맥시멀 |
 * | --- | --- | --- |
 * | 숫자만 | 별점 + 개수 | 별점 + 분포 그래프 |
 *
 * ## 그래프 없이도 읽힌다 (F8)
 *
 * **문장이 먼저 있고 그림이 뒤에 붙는다.** 「평점 4.4 · 리뷰 128건」은 세 단계 모두에
 * 있고, 별과 막대는 그 문장을 눈으로 빨리 읽게 해 주는 장치라 `aria-hidden` 이다.
 * 거꾸로 만들면 — 별에 `aria-label` 을 붙이고 문장을 지우면 — 화면을 보지 않는
 * 사람에게 남는 것은 「별 다섯 개」라는 그림의 이름뿐이고, 그것은 평점이 아니다.
 *
 * 분포도 같다. 막대의 길이는 그림이고, 같은 사실이 「5점 12건 40%」로 각 줄에 글로
 * 놓인다. `percentage` 를 화면이 다시 계산하지 않는 것도 중요하다 — 다섯을 더하면
 * 정확히 100이 되도록 서버가 맞춰 보냈고(`ratingBucketSchema`), 화면이 다시 나누면
 * 그 합이 99나 101이 된다.
 */
export function RatingSummaryPanel({
  copy,
  display,
  summary,
}: {
  readonly copy: ProductReviewsMessages
  readonly display: RatingDisplay
  readonly summary: RatingSummary
}) {
  const score = ratingText(summary.averageTimes100)
  const sentence = copy.summaryLabel
    .replace('{score}', score)
    .replace('{count}', summary.count.toLocaleString('ko-KR'))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {display === 'score' ? null : (
          <Stars label={copy.starsLabel} score={score} value={summary.averageTimes100} />
        )}
        <p className="text-fg text-sm font-medium">{sentence}</p>
      </div>

      {display === 'distribution' ? <Distribution copy={copy} summary={summary} /> : null}
    </div>
  )
}

/**
 * 별 다섯 칸.
 *
 * `aria-hidden` 이고 그 옆 문장이 값을 나른다. `title` 도 붙이지 않는다 — 붙이면
 * 같은 사실이 두 번 읽힌다.
 */
function Stars({
  label,
  score,
  value,
}: {
  readonly label: string
  readonly score: string
  readonly value: number
}) {
  const filled = filledStars(value)

  return (
    <span
      aria-hidden="true"
      className="flex items-center gap-0.5"
      data-testid="rating-stars"
      title={label.replace('{score}', score)}
    >
      {Array.from({ length: RATING_STARS }, (_unused, index) => (
        <StarIcon
          className={index < filled ? 'text-primary size-4' : 'text-border-strong size-4'}
          key={index}
        />
      ))}
    </span>
  )
}

/** 별 다섯부터 하나까지. 계약이 순서와 칸 수를 보장한다(`ratingSummarySchema`). */
function Distribution({
  copy,
  summary,
}: {
  readonly copy: ProductReviewsMessages
  readonly summary: RatingSummary
}) {
  return (
    <ul aria-label={copy.distributionLabel} className="flex flex-col gap-1">
      {summary.buckets.map((bucket) => (
        <li className="flex items-center gap-2" key={bucket.rating}>
          <span className="text-fg-muted w-32 shrink-0 text-xs">
            {copy.bucketLabel
              .replace('{rating}', String(bucket.rating))
              .replace('{count}', bucket.count.toLocaleString('ko-KR'))
              .replace('{percentage}', String(bucket.percentage))}
          </span>
          {/*
            막대는 위 문장의 그림이다. 서버가 보낸 비율을 그대로 쓰고 다시 나누지
            않는다 — 다섯을 더하면 100이 되도록 맞춰 온 값이다.
          */}
          <span aria-hidden="true" className="bg-surface-muted h-2 min-w-0 flex-1 rounded-full">
            <span
              className="bg-primary block h-2 rounded-full"
              style={{ width: `${String(bucket.percentage)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}
