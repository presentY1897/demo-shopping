'use client'

import { reviewSortKeys } from '@shopping/shared'
import type { ReviewImage, ReviewListEntry } from '@shopping/shared'
import { Button, Checkbox, ErrorState, Select, Skeleton } from '@shopping/ui/components'
import { useDensity } from '@shopping/ui/density'
import { usePathname } from 'next/navigation'
import { useId, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import { REVIEW_PAGE_SIZE, reviewExposure } from '@/lib/reviews/exposure'
import { ratingText } from '@/lib/reviews/rating'
import { useProductReviews } from '@/lib/reviews/use-product-reviews'
import type { ProductReviewsMessages, RefusalMessages, ReportMessages } from '@/messages'

import { RatingSummaryPanel } from './rating-summary'
import { ReviewCard } from './review-card'

const LOCALE = 'ko-KR'

/**
 * 상품 상세의 리뷰 (TASK-0084 F1 · F5 · F6).
 *
 * ## 밀도가 정하는 것은 노출량이다
 *
 * | | 미니멀 | 표준 | 맥시멀 |
 * | --- | --- | --- | --- |
 * | 평점 | 숫자만 | 별점 + 개수 | 별점 + 분포 그래프 |
 * | 리뷰 | 링크만 | 3건 | 5건 + 사진 갤러리 |
 *
 * **세 벌이 아니라 한 벌이다** (상품 상세가 같은 규칙을 따른다). 블록은 한 번씩만
 * 쓰여 있고 밀도는 그것들을 몇 개 보일지만 정하며, 그 표는 `lib/reviews/exposure.ts`
 * 하나에 있다.
 *
 * ## 미니멀은 아무것도 묻지 않는다
 *
 * 「링크만」이므로 목록을 부르지 않는다. 그 단계에서 그리는 평점은 상품 상세가 이미
 * 들고 있는 `ratingAvg` · `ratingCount` 다 — 보이지도 않을 목록을 위해 요청을 하나 더
 * 보내면, 콜드 스타트가 90초인 이 배포에서 그것은 화면이 늦게 뜨는 이유가 된다
 * (TASK-0101).
 *
 * 펼치면 그때 부른다. 링크가 다른 라우트가 아니라 이 자리를 펼치는 이유는
 * `docs/design/pages.md` 의 shop 페이지 표에 **리뷰 전용 라우트가 없기** 때문이다 —
 * 없는 화면을 링크가 지어내면 그것은 설계 문서에 없는 페이지가 된다.
 *
 * ## 요약은 필터를 따라 움직이지 않는다
 *
 * 계약이 그렇게 정했고(`ratingSummarySchema`), 화면은 그 사실을 **말한다.** 「사진
 * 리뷰만」을 켰는데 분포가 그대로면, 말해 주지 않는 한 사람은 화면이 필터를 무시했다고
 * 읽는다.
 */
export function ProductReviews({
  copy,
  productId,
  ratingAvg,
  ratingCount,
  refusals,
  report,
}: {
  readonly copy: ProductReviewsMessages
  readonly productId: string
  /** 상품 상세가 이미 들고 있는 집계. 미니멀 단계는 이것만으로 그려진다. */
  readonly ratingAvg: number
  readonly ratingCount: number
  /** 신고 다이얼로그가 쓰는 두 벌 (TASK-0091). 리뷰 한 장마다 하나가 붙는다. */
  readonly refusals: RefusalMessages
  readonly report: ReportMessages
}) {
  const { density } = useDensity()
  const exposure = reviewExposure(density)
  const [expanded, setExpanded] = useState(false)
  /**
   * 밀도가 정한 수 **위로** 사람이 더 달라고 한 만큼.
   *
   * 밀도를 노출량의 하한으로 두는 것이 요점이다 — 「더 보기」를 누른 사람이 밀도를
   * 낮췄다고 방금 읽던 리뷰가 사라지면, 그것은 설정이 아니라 사고로 읽힌다.
   */
  const [extra, setExtra] = useState(0)
  const open = !exposure.collapsed || expanded

  const reviews = useProductReviews(productId, open)
  const { state } = useAuth()
  const pathname = usePathname()
  const headingId = useId()
  const sortId = useId()

  const signIn = signInHref('/login', pathname)
  const limit = exposure.count + extra
  const shown = reviews.reviews.slice(0, limit)

  /**
   * **더 보기는 두 가지 일을 한다.** 이미 받아 두었지만 밀도가 접어 둔 장을 펼치고,
   * 다 펼쳤으면 다음 장을 받아 온다. 사람에게는 같은 한 가지 — 「더 보여 달라」 —
   * 이므로 버튼도 하나다. 커서가 없으면 `loadMore` 는 아무 일도 하지 않는다.
   */
  function showMore(): void {
    setExtra((current) => current + REVIEW_PAGE_SIZE)
    reviews.loadMore()
  }

  /** 조건이 바뀌면 목록도 갈아 끼워지므로, 몇 건까지 펼쳤는지도 처음으로 돌아간다. */
  function narrow(change: () => void): void {
    setExtra(0)
    change()
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 className="text-fg text-base font-semibold" id={headingId}>
        {copy.heading}
      </h2>

      {/*
        평점은 세 단계 모두에 있고, 미니멀은 **상품이 이미 들고 있는 집계**로 그린다.
        목록이 오면 그 요약으로 갈아 끼운다 — 둘은 같은 사실이고, 뒤엣것이 더 새롭다.
      */}
      {reviews.summary === null ? (
        <p className="text-fg text-sm font-medium">
          {copy.summaryLabel
            .replace('{score}', ratingText(ratingAvg))
            .replace('{count}', ratingCount.toLocaleString(LOCALE))}
        </p>
      ) : (
        <RatingSummaryPanel copy={copy} display={exposure.rating} summary={reviews.summary} />
      )}

      {open ? null : (
        <div>
          <Button
            onClick={() => {
              setExpanded(true)
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.expandLabel.replace('{count}', ratingCount.toLocaleString(LOCALE))}
          </Button>
        </div>
      )}

      {open ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-fg-muted text-xs" htmlFor={sortId}>
                {copy.sortLabel}
              </label>
              <Select
                id={sortId}
                onValueChange={(value) => {
                  narrow(() => {
                    reviews.setSort(reviewSortKeys.find((key) => key === value) ?? 'latest')
                  })
                }}
                options={reviewSortKeys.map((key) => ({ label: copy.sorts[key], value: key }))}
                size="sm"
                value={reviews.sort}
              />
            </div>

            <Checkbox
              checked={reviews.photoOnly}
              label={copy.photoOnlyLabel.replace(
                '{count}',
                (reviews.summary?.photoCount ?? 0).toLocaleString(LOCALE),
              )}
              onCheckedChange={(checked) => {
                narrow(() => {
                  reviews.setPhotoOnly(checked === true)
                })
              }}
            />
          </div>

          {/*
            필터를 켜도 위의 숫자가 그대로인 이유. 계약이 요약을 필터와 무관하게
            보내므로(`ratingSummarySchema`), 그 사실을 말하지 않으면 사람은 화면이
            필터를 무시했다고 읽는다.
          */}
          <p className="text-fg-subtle text-xs">{copy.summaryScopeNotice}</p>

          {reviews.state.status === 'loading' ? (
            <div aria-busy="true" aria-label={copy.loadingLabel} role="status">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}

          {reviews.state.status === 'error' ? (
            <ErrorState
              onRetry={reviews.reload}
              retryLabel={copy.retryLabel}
              title={copy.errorTitle}
            />
          ) : null}

          {reviews.state.status === 'ready' ? (
            <ReviewBody
              copy={copy}
              exposureGallery={exposure.gallery}
              onHelpful={state.status === 'signedIn' ? reviews.toggleHelpful : null}
              photoOnly={reviews.photoOnly}
              refusals={refusals}
              report={report}
              reviews={shown}
              signIn={signIn}
            />
          ) : null}

          {reviews.helpfulFailed ? (
            <p className="text-danger text-xs" role="status">
              {copy.helpfulErrorNotice}
            </p>
          ) : null}

          {reviews.state.status === 'ready' &&
          (reviews.hasMore || shown.length < reviews.reviews.length) ? (
            <div>
              <Button
                loading={reviews.loadingMore}
                onClick={showMore}
                size="sm"
                type="button"
                variant="outline"
              >
                {reviews.loadingMore ? copy.moreLoading : copy.moreLabel}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

/**
 * 목록 본문 — 갤러리와 리뷰 카드.
 *
 * 갤러리를 목록 **위**에 두는 이유는 그것이 목록을 대신하지 않기 때문이다. 맥시멀
 * 단계에서 사진 리뷰를 먼저 훑고 그다음에 전부를 읽는 순서가, 사진 리뷰를 목록 안에서
 * 찾아 헤매는 것보다 짧다.
 */
function ReviewBody({
  copy,
  exposureGallery,
  onHelpful,
  photoOnly,
  refusals,
  report,
  reviews,
  signIn,
}: {
  readonly copy: ProductReviewsMessages
  readonly exposureGallery: boolean
  readonly onHelpful: ((reviewId: string, pressed: boolean) => void) | null
  readonly photoOnly: boolean
  readonly refusals: RefusalMessages
  readonly report: ReportMessages
  readonly reviews: readonly ReviewListEntry[]
  readonly signIn: string
}) {
  if (reviews.length === 0) {
    return (
      <div className="border-border flex flex-col gap-1 rounded-md border border-dashed p-4">
        <p className="text-fg text-sm font-medium">
          {photoOnly ? copy.photoOnlyEmpty : copy.emptyTitle}
        </p>
        <p className="text-fg-muted text-sm">{copy.emptyBody}</p>
      </div>
    )
  }

  const photographed = reviews.filter((review) => review.images.length > 0)

  return (
    <>
      {exposureGallery && photographed.length > 0 ? (
        <section aria-label={copy.galleryLabel} className="flex flex-col gap-2">
          <h3 className="text-fg text-sm font-semibold">{copy.galleryLabel}</h3>
          <ul className="flex flex-wrap gap-2">
            {photographed.map((review) => (
              <li
                className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border px-3 py-2"
                key={review.id}
              >
                {/*
                  갤러리도 **서버가 준 주소로만** 그린다. 주소가 없는 배포에서는 몇
                  장인지와 누가 올렸는지만 남고, 그래도 갤러리는 「사진 리뷰가 있다」는
                  사실을 여전히 말한다 (`reviewImageSchema`).
                */}
                <GalleryThumb copy={copy} images={review.images} />
                <span className="text-fg text-xs font-medium">
                  {copy.photoCountBadge.replace('{count}', String(review.images.length))}
                </span>
                <span className="text-fg-subtle text-xs">{review.authorName}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul aria-label={copy.listLabel} className="flex flex-col">
        {reviews.map((review) => (
          <ReviewCard
            copy={copy}
            key={review.id}
            onHelpful={onHelpful}
            refusals={refusals}
            report={report}
            review={review}
            signInHref={signIn}
          />
        ))}
      </ul>
    </>
  )
}

/** 갤러리 한 칸의 그림. 주소가 없으면 아무것도 그리지 않는다. */
function GalleryThumb({
  copy,
  images,
}: {
  readonly copy: ProductReviewsMessages
  readonly images: readonly ReviewImage[]
}) {
  const first = images.find((image) => image.url !== null)

  if (first?.url === undefined || first.url === null) return null

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- 주소의 호스트가 배포마다 다르다 (`review-card.tsx` 참조). */
    <img
      alt={copy.imageAlt.replace('{index}', '1')}
      className="border-border size-16 rounded-md border object-cover"
      loading="lazy"
      src={first.url}
    />
  )
}
