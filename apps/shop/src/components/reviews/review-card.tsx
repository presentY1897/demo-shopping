'use client'

import type { ReviewImage, ReviewListEntry } from '@shopping/shared'
import { Button, Tag } from '@shopping/ui/components'
import { formatDate } from '@shopping/ui/format'
import Link from 'next/link'

import { ReportDialog } from '@/components/reports/report-dialog'
import { filledStars, RATING_STARS } from '@/lib/reviews/rating'
import type { ProductReviewsMessages, RefusalMessages, ReportMessages } from '@/messages'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * 리뷰 한 장 — 별점, 본문, 산 옵션, 판매자 답변, 도움돼요, 신고 (TASK-0084 F1).
 *
 * ## 이름은 이미 가려져 있다
 *
 * `authorName` 은 서버가 `홍*동` 으로 만들어 내려보낸다(`reviewSchema`). 화면이 다시
 * 가리거나 되돌리지 않는다 — 가리는 일을 화면마다 하게 두면 한 화면이 잊는 날 그
 * 화면만 이름을 다 보여 주고, 그 결함은 아무도 신고하지 않는다.
 *
 * ## 답변은 리뷰 **아래**에 붙는다
 *
 * 목록과 함께 오므로(`reviewListEntrySchema.reply`) 리뷰 한 장마다 요청이 하나씩 늘지
 * 않는다. 자리가 아래인 것은 답변이 리뷰에 대한 말이기 때문이고, 위에 두면 읽는
 * 순서가 뒤집힌다.
 *
 * ## 도움돼요는 로그인하지 않아도 **보인다**
 *
 * 수는 누구에게나 사실이므로 그린다. 다만 로그인하지 않은 사람에게 버튼을 주면 누르는
 * 순간 401 이 돌아오고, 그것은 사람이 고칠 수 없는 실패다 — 그래서 그 자리에는 버튼이
 * 아니라 **로그인으로 가는 링크**가 놓인다.
 *
 * ## 사진은 서버가 준 주소로만 그린다
 *
 * 계약이 `{ key, url }` 로 내려보내고 `url` 은 **저장소가 설정되지 않은 배포에서
 * `null`** 이다 (`reviewImageSchema`). 화면이 열쇠로 주소를 조립하면 저장소를 옮기는
 * 날 모든 화면이 함께 틀리고, 지금은 그 주소를 지을 규칙 자체가 서버에만 있다. 주소가
 * 없으면 **사진만** 빠지고 리뷰는 그대로 읽힌다 — 사진을 못 보는 것과 리뷰를 못 읽는
 * 것은 다른 일이다.
 *
 * ## 신고는 이제 진짜 다이얼로그다
 *
 * TASK-0091 이 「준비 중」이라고 적혀 있던 비활성 버튼을 대신했다. 다이얼로그는
 * `packages/ui` 의 `Modal` 이고(포커스 가둠·Escape·바깥 클릭은 거기 있다), 로그인하지
 * 않은 사람에게는 버튼 대신 로그인으로 가는 링크가 놓인다 — 신고에는 신고자가 있어야
 * 중복 신고를 막을 수 있다.
 */
export function ReviewCard({
  copy,
  onHelpful,
  refusals,
  report,
  review,
  signInHref,
}: {
  readonly copy: ProductReviewsMessages
  /** 로그인한 사람만 받는다. `null` 이면 아래의 링크가 대신 그려진다. */
  readonly onHelpful: ((reviewId: string, pressed: boolean) => void) | null
  readonly refusals: RefusalMessages
  readonly report: ReportMessages
  readonly review: ReviewListEntry
  readonly signInHref: string
}) {
  const stars = filledStars(review.rating * 100)

  return (
    <li className="border-border flex flex-col gap-3 border-b py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          별점은 그림이고 값은 그 옆 글자가 나른다 (F8). 리뷰 하나의 별점은 정수라
          `rating * 100` 으로 같은 변환 함수를 지난다 — 100배 정수를 다루는 자리가
          둘이 되지 않게 한다.
        */}
        <span aria-hidden="true" className="text-primary text-sm tracking-tight">
          {'★'.repeat(stars)}
          <span className="text-border-strong">{'★'.repeat(RATING_STARS - stars)}</span>
        </span>
        <span className="text-fg text-sm font-medium">
          {copy.starsLabel.replace('{score}', String(review.rating))}
        </span>
        <span className="text-fg-subtle text-xs">{review.authorName}</span>
        <span className="text-fg-subtle text-xs">
          {formatDate(review.createdAt, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })}
        </span>
      </div>

      {review.optionLabel === null ? null : (
        <p className="text-fg-muted text-xs">
          {copy.optionLabel.replace('{option}', review.optionLabel)}
        </p>
      )}

      <p className="text-fg text-sm whitespace-pre-line">{review.content}</p>

      {review.images.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <Tag>{copy.photoCountBadge.replace('{count}', String(review.images.length))}</Tag>
          <ReviewPhotos copy={copy} images={review.images} />
        </div>
      )}

      {review.reply === null ? null : (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
          <p className="text-fg text-xs font-semibold">
            {copy.replyLabel.replace('{brand}', review.reply.brandName)}
          </p>
          <p className="text-fg-muted text-sm whitespace-pre-line">{review.reply.content}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onHelpful === null ? (
          <Link
            className="text-primary min-h-touch inline-flex items-center text-xs underline"
            href={signInHref}
          >
            {copy.helpfulSignInLabel.replace('{count}', review.helpfulCount.toLocaleString(LOCALE))}
          </Link>
        ) : (
          <Button
            aria-pressed={review.helpfulByMe}
            onClick={() => {
              onHelpful(review.id, review.helpfulByMe)
            }}
            size="sm"
            type="button"
            variant={review.helpfulByMe ? 'secondary' : 'ghost'}
          >
            {(review.helpfulByMe ? copy.helpfulPressedLabel : copy.helpfulLabel).replace(
              '{count}',
              review.helpfulCount.toLocaleString(LOCALE),
            )}
          </Button>
        )}

        <ReportDialog copy={report} refusals={refusals} targetId={review.id} targetType="REVIEW" />
      </div>
    </li>
  )
}

/**
 * 붙은 사진들.
 *
 * **`url` 이 없는 장은 그리지 않는다.** 저장소를 아직 붙이지 않은 배포에서는 열쇠만
 * 있고 주소가 없는데(`reviewImageSchema`), 그때 빈 `<img>` 를 그리면 깨진 그림이 뜬다.
 * 대신 몇 장이 있었는지는 위의 뱃지가 이미 말했고, 여기서는 왜 안 보이는지를 말한다.
 *
 * `next/image` 가 아니라 `<img>` 인 것은 이 주소가 **배포마다 다른 호스트**이기
 * 때문이다 — `next.config` 의 `remotePatterns` 에 없는 호스트는 최적화 단계에서 400 이
 * 되고, 그것은 사진 하나가 아니라 목록 전체를 깨뜨린다.
 */
function ReviewPhotos({
  copy,
  images,
}: {
  readonly copy: ProductReviewsMessages
  readonly images: readonly ReviewImage[]
}) {
  const shown = images.filter((image) => image.url !== null)

  if (shown.length === 0) return <p className="text-fg-subtle text-xs">{copy.photosPending}</p>

  return (
    <ul className="flex flex-wrap gap-2">
      {shown.map((image, index) => (
        <li key={image.key}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 주소의 호스트가 배포마다 다르다. 위 주석 참조. */}
          <img
            alt={copy.imageAlt.replace('{index}', String(index + 1))}
            className="border-border size-20 rounded-md border object-cover"
            loading="lazy"
            src={image.url ?? ''}
          />
        </li>
      ))}
    </ul>
  )
}
