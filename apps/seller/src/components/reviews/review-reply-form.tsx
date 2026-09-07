'use client'

import type { ApiFailure } from '@shopping/shared'
import { apiFailure, failureMessage, REVIEW_REPLY_CONTENT_MAX } from '@shopping/shared'
import { Button, Textarea } from '@shopping/ui/components'
import { Form, FormError, FormField, useForm } from '@shopping/ui/form'
import type { ValidationErrors } from '@shopping/ui/form'
import { useCallback, useMemo } from 'react'

import { replyRefusalOf, reviewReplyFormSchema } from '@/lib/reviews/review-console'
import type { ReviewReplyWrite } from '@/lib/reviews/use-seller-product-reviews'
import type { Messages } from '@/messages'

/**
 * 답변 한 장을 쓰거나 고치는 폼 (TASK-0085 F1 · F3).
 *
 * **버튼이 하나다.** 「작성」과 「수정」은 문구만 다르고 가는 곳이 같다 —
 * `PUT /reviews/:id/reply` 하나이고, 리뷰당 답변이 하나인 것을 기본키가 만들기
 * 때문이다. 화면에 문을 둘 두면 하나는 언젠가 400 을 받는다.
 *
 * **이미 쓴 답변이 초기값이다.** 빈 칸에서 다시 쓰게 하면 「수정」이 사실상 「삭제 후
 * 재작성」이 되고, 그것은 4장이 명시적으로 거절한 모양이다.
 *
 * **`useForm` 을 쓰는 이유는 칸이 하나여도 규칙이 하나가 아니기 때문이다**: 빈 답변을
 * 막고, 상한을 계약의 상수에서 읽고, 엔터로 두 번 제출되는 길을 닫고(`Form` 의
 * 제출 문 하나), 서버가 거절하면 그 문장을 폼 위에 놓는다.
 */
export interface ReviewReplyFormProps {
  readonly reviewId: string
  /** 지금 저장되어 있는 답변. 없으면 빈 문자열 — 처음 쓰는 경우다. */
  readonly initialContent: string
  readonly save: (reviewId: string, content: string) => Promise<ReviewReplyWrite>
  /** 저장이 끝났다. 폼을 닫고 알리는 것은 부르는 쪽의 일이다. */
  readonly onSaved: () => void
  readonly onCancel: () => void
  readonly messages: Messages
}

/** 거절된 쓰기를 `mapError` 가 읽을 수 있는 값으로 나른다. */
class ReplyWriteRejection extends Error {
  override readonly name = 'ReplyWriteRejection'

  constructor(readonly failure: ApiFailure) {
    super('the reply write was refused')
  }
}

/**
 * 이 거절을 무슨 문장으로 말하나 (F2).
 *
 * 403 과 404 는 이 화면만의 뜻을 갖는다 — 「내 스토어가 아니다」와 「그 사이에
 * 사라졌다」 — 이고, 그 둘에는 다음에 할 일이 각각 다르게 붙는다. 나머지는
 * `errors` 카탈로그가 코드로 답한다.
 */
export function replyFailureMessage(failure: ApiFailure, messages: Messages): string {
  const refusal = replyRefusalOf(failure)
  const copy = messages.reviewList.reply.refusals

  if (refusal === 'forbidden') return copy.forbidden
  if (refusal === 'gone') return copy.gone

  return failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures })
}

export function ReviewReplyForm({
  reviewId,
  initialContent,
  save,
  onSaved,
  onCancel,
  messages,
}: ReviewReplyFormProps) {
  const copy = messages.reviewList.reply
  const schema = useMemo(() => reviewReplyFormSchema(copy.errors), [copy.errors])

  const mapError = useCallback(
    (error: unknown): ValidationErrors | undefined => {
      const failure = error instanceof ReplyWriteRejection ? error.failure : apiFailure(error)

      /*
       * 폼 위의 오류 상자로 보낸다. 서버는 이 거절이 어느 칸의 일인지 말하지 않고
       * — 403 은 소유권이고 404 는 리뷰 자체다 — 칸이 하나뿐인 폼에서 그 문장을
       * 칸 밑에 다는 것은 「이 글자를 고치면 된다」는 거짓말이다.
       */
      return { fieldErrors: {}, formErrors: [replyFailureMessage(failure, messages)] }
    },
    [messages],
  )

  const form = useForm({
    schema,
    initialValues: { content: initialContent },
    mapError,
    submitErrorMessage: copy.submitFailed,
    onSubmit: async ({ content }) => {
      const result = await save(reviewId, content)

      if (result.ok) {
        onSaved()
        return
      }

      throw new ReplyWriteRejection(result.failure)
    },
  })

  return (
    <Form aria-label={copy.contentLabel} form={form}>
      <FormError errors={form.formErrors} title={copy.errorTitle} />

      <FormField
        form={form}
        hint={copy.contentHint.replace('{max}', String(REVIEW_REPLY_CONTENT_MAX))}
        label={copy.contentLabel}
        name="content"
        required
      >
        <Textarea
          {...form.text('content')}
          maxLength={REVIEW_REPLY_CONTENT_MAX}
          placeholder={copy.contentPlaceholder}
          rows={4}
        />
      </FormField>

      <div className="flex flex-wrap gap-2">
        {/* U3: 도는 동안 두 번째 클릭이 두 번째 요청이 되지 않는다. */}
        <Button loading={form.submitting} type="submit" variant="primary">
          {copy.saveLabel}
        </Button>
        <Button disabled={form.submitting} onClick={onCancel} type="button" variant="ghost">
          {copy.cancelLabel}
        </Button>
      </div>
    </Form>
  )
}
