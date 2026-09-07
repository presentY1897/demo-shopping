'use client'

import { Button, Checkbox } from '@shopping/ui/components'

import type { SellerQuestionFilters } from '@/lib/questions/question-console'
import { EMPTY_QUESTION_FILTERS } from '@/lib/questions/question-console'
import type { Messages } from '@/messages'

/**
 * 축 하나 — 「답변하지 않은 문의만」 (TASK-0088).
 *
 * **`review-filters.tsx` 에서 평점 축을 뺀 것이다.** 문의에는 별점이 없고, 계약이
 * 판매자 목록에 허용하는 축도 `unansweredOnly` 뿐이다
 * (`sellerQuestionsQueryParamsSchema`). 리뷰 쪽의 「이 별점 이하」에 해당하는 것을
 * 굳이 만들어 내지 않는다 — 서버가 거르지 못하는 축을 화면에 두면 그것은 이
 * 페이지만 거르는 필터가 되고, 커서 목록에서 그런 필터는 페이지 경계에서 거짓말을
 * 한다.
 *
 * **공개/비공개도 축이 아니다.** 비공개 문의도 똑같이 답해야 하는 것이라, 그 축으로
 * 목록을 가르면 할 일이 두 화면으로 쪼개진다 (4.2). 비공개는 거르는 것이 아니라
 * 줄에 표시하는 것이다.
 *
 * 축이 하나여도 `<form role="search">` 과 `fieldset`/`legend` 를 그대로 두는 이유는
 * 이 자리가 리뷰 관리와 **같은 자리**여야 하기 때문이다 — 판매자가 두 화면을
 * 오가면서 컨트롤을 다시 찾지 않는다.
 */
export interface QuestionFiltersProps {
  readonly value: SellerQuestionFilters
  readonly onChange: (filters: SellerQuestionFilters) => void
  readonly messages: Messages
  readonly disabled?: boolean
}

export function QuestionFilters({
  value,
  onChange,
  messages,
  disabled = false,
}: QuestionFiltersProps) {
  const copy = messages.questionList.filters

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
              onChange({ unansweredOnly: checked === true })
            }}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_QUESTION_FILTERS)
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
