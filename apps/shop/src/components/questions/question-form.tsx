'use client'

import { QUESTION_CONTENT_MAX } from '@shopping/shared'
import { Button, Radio, RadioGroup, Textarea } from '@shopping/ui/components'
import { useId, useState } from 'react'

import { questionDraftIssues } from '@/lib/questions/question-draft'
import type { QuestionFormMessages } from '@/messages'

/**
 * 문의를 쓰는 폼 (TASK-0088 F1).
 *
 * ## 공개가 기본이다
 *
 * 계약의 기본값이 공개이고(`createQuestionRequestSchema`), 그 이유는 문의가 **상품
 * 정보의 일부**이기 때문이다 — 같은 것을 궁금해하는 다음 사람이 읽는다. 비공개는
 * 고르는 것이지 기본이 아니다.
 *
 * 라디오 둘인 것은 체크박스 하나(「비공개로 남기기」)보다 **두 선택지의 결과를 나란히
 * 읽게 하기** 때문이다. 체크박스는 켜는 쪽의 설명만 있고 끄는 쪽은 침묵한다.
 *
 * ## 눌러 보기 전에는 오류를 그리지 않는다
 *
 * 아무것도 쓰지 않은 채 폼을 연 사람에게 「내용을 적어주세요」를 먼저 보이면, 그것은
 * 안내가 아니라 **아직 하지 않은 일에 대한 지적**이다 (`review-form.tsx` 의 같은 판단).
 */
export function QuestionForm({
  busy,
  copy,
  onSubmit,
}: {
  readonly busy: boolean
  readonly copy: QuestionFormMessages
  /** 참을 돌려주면 폼이 비워진다. 거짓이면 쓴 것은 그대로 남는다 (U6). */
  readonly onSubmit: (content: string, isPublic: boolean) => Promise<boolean>
}) {
  const [content, setContent] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [attempted, setAttempted] = useState(false)

  const legendId = useId()
  const contentId = useId()
  const issuesId = useId()
  const visibilityId = useId()

  const issues = questionDraftIssues(content)
  const shown = attempted ? issues : []
  const issue = shown[0]

  function send(): void {
    setAttempted(true)

    // 이 렌더의 값으로 판단한다. 상태 갱신을 기다렸다 다시 세는 것은 같은 답을 한
    // 프레임 늦게 얻는 일이다.
    if (issues.length > 0) return

    void onSubmit(content.trim(), isPublic).then((ok) => {
      if (!ok) return

      setContent('')
      setAttempted(false)
    })
  }

  return (
    <section
      aria-labelledby={legendId}
      className="border-border flex flex-col gap-4 rounded-md border p-4"
    >
      {/*
        `h3` 이다 — 이 폼은 「상품 문의」(`h2`) 바로 아래에 열리므로 `h4` 로 적으면
        단계가 하나 건너뛰어지고, axe 의 `heading-order` 가 그것을 잡는다. 리뷰 폼이
        `h4` 인 것은 그쪽이 목록의 줄(`h3`) 안에 있기 때문이다.
      */}
      <h3 className="text-fg text-sm font-semibold" id={legendId}>
        {copy.legend}
      </h3>

      <div className="flex flex-col gap-1">
        <label className="text-fg text-sm font-medium" htmlFor={contentId}>
          {copy.contentLabel}
        </label>
        <p className="text-fg-muted text-xs">
          {copy.contentHint.replace('{max}', String(QUESTION_CONTENT_MAX))}
        </p>
        <Textarea
          aria-describedby={issuesId}
          id={contentId}
          invalid={shown.length > 0}
          onChange={(event) => {
            setContent(event.target.value)
          }}
          placeholder={copy.contentPlaceholder}
          rows={4}
          value={content}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-fg text-sm font-medium" id={visibilityId}>
          {copy.visibilityLegend}
        </legend>
        <RadioGroup
          aria-labelledby={visibilityId}
          onValueChange={(value) => {
            setIsPublic(value === 'public')
          }}
          orientation="horizontal"
          value={isPublic ? 'public' : 'private'}
        >
          <Radio label={copy.publicLabel} value="public" />
          <Radio label={copy.privateLabel} value="private" />
        </RadioGroup>
        <p className="text-fg-subtle text-xs">{isPublic ? copy.publicHint : copy.privateHint}</p>
      </fieldset>

      {/* 문장이 하나뿐이어도 자리는 남는다 (U2). */}
      <p className="text-danger min-h-5 text-sm" id={issuesId} role="status">
        {issue === undefined
          ? ''
          : copy.issues[issue].replace('{max}', String(QUESTION_CONTENT_MAX))}
      </p>

      <div>
        <Button loading={busy} onClick={send} size="sm" type="button">
          {busy ? copy.submittingLabel : copy.submitLabel}
        </Button>
      </div>
    </section>
  )
}
