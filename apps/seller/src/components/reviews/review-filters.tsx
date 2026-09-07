'use client'

import { Button, Checkbox, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { SellerReviewFilters } from '@/lib/reviews/review-console'
import { EMPTY_REVIEW_FILTERS, MAX_RATING_CHOICES } from '@/lib/reviews/review-console'
import type { Messages } from '@/messages'

/**
 * 두 축 — 「답변하지 않은 리뷰만」과 「이 별점 이하」 (TASK-0085 F6).
 *
 * **두 축이 TASK 4장 그대로다.** 「대응이 필요한 리뷰를 먼저 찾는 게 실제 사용
 * 패턴」이라고 적혀 있고, 그 문장을 화면으로 옮기면 정확히 이 둘이 된다. 반대쪽
 * 축 — 높은 평점만, 사진 있는 것만 — 은 여기서 아무 일도 시키지 않으므로 두지 않는다.
 *
 * **체크박스가 먼저 온다.** 판매자가 이 화면에 오는 이유가 「답할 것 찾기」이므로,
 * 그 한 번의 클릭이 첫 번째 컨트롤이어야 한다. 평점은 그다음의 좁히기다.
 *
 * `settlement-filters.tsx` 와 같은 규약: **`null` 이 「전체」다.** 라딕스의 셀렉트는
 * 빈 문자열을 「고르지 않음」으로 읽어 자리 표시자로 되돌아가므로, 「전체」에는 값이
 * 있는 문자열이 필요하다.
 */
export interface ReviewFiltersProps {
  readonly value: SellerReviewFilters
  readonly onChange: (filters: SellerReviewFilters) => void
  readonly messages: Messages
  readonly disabled?: boolean
}

const ALL = 'ALL'

export function ReviewFilters({ value, onChange, messages, disabled = false }: ReviewFiltersProps) {
  const copy = messages.reviewList.filters
  const ratingId = useId()

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{copy.legend}</legend>

        <div className="flex min-h-control-md items-center">
          <Checkbox
            checked={value.unansweredOnly}
            disabled={disabled}
            label={copy.unansweredOnlyLabel}
            onCheckedChange={(checked) => {
              // `indeterminate` 는 이 체크박스가 만들 수 있는 상태가 아니다 —
              // 켜거나 끄거나 둘뿐이라, `true` 만 켜짐으로 읽는다.
              onChange({ ...value, unansweredOnly: checked === true })
            }}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={ratingId}>
            {copy.maxRatingLabel}
          </label>
          <Select
            disabled={disabled}
            id={ratingId}
            onValueChange={(next) => {
              onChange({ ...value, maxRating: next === ALL ? null : Number(next) })
            }}
            options={[
              { label: copy.maxRatingAll, value: ALL },
              ...MAX_RATING_CHOICES.map((rating) => ({
                label: copy.maxRatingOption.replace('{rating}', String(rating)),
                value: String(rating),
              })),
            ]}
            value={value.maxRating === null ? ALL : String(value.maxRating)}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_REVIEW_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {copy.reset}
        </Button>
      </fieldset>
    </form>
  )
}
