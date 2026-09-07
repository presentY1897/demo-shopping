'use client'

import type { ApiFailure, ErrorMessages, ProductSummary } from '@shopping/shared'
import { ADMIN_REASON_MAX, errorMessage } from '@shopping/shared'
import { Button, Modal, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo } from 'react'

import type { ReasonValues } from '@/lib/users/forms'
import { EMPTY_REASON_FORM, REASON_FORM_FIELDS, reasonFormSchema } from '@/lib/users/forms'
import type { AdminProductMessages } from '@/messages'

/**
 * 상품을 내리기 전에 **왜인지 묻는다** (F3).
 *
 * ## 이 창이 존재하는 것이 설계다
 *
 * 사유를 몰래 채워 보낼 수도 있었다 — 「부적절」 한 줄이면 숨김은 그대로 되고 창은 하나
 * 줄어든다. 그러면 남는 것은 근거가 아니라 **근거의 모양**이고, 그 상품의 판매자에게
 * 설명할 것이 아무것도 없다 (4.2). 데이터베이스도 같은 판단을 먼저 했다:
 * `Product_moderation_check` 가 시각·사유·처리자 셋이 함께 있거나 셋 다 없기를
 * 요구한다.
 *
 * ## 사유 폼을 `lib/users/forms.ts` 에서 빌려 온다
 *
 * 「앞뒤 공백을 떼고 최소 한 글자, {@link ADMIN_REASON_MAX} 자까지」는 계약의 규칙이고
 * (`adminReasonSchema`), 그 규칙을 `useForm` 에 얹는 방법은 이미 그 파일에 있다. 세
 * 번째 사본을 만들면 한쪽만 상한이 바뀌는 날이 온다 — 문장만 이 화면의 것으로 갈아
 * 끼운다.
 *
 * ## 거절이 이 창 안에 선다
 *
 * 데모 관리자의 403 도(F8), 그 사이에 상태가 바뀐 409 도 여기 온다. 창을 닫고 토스트로
 * 말하면 사람이 방금 적은 사유가 사라지고, 다시 열어 다시 적게 된다.
 */

export interface ProductHideDialogProps {
  readonly target: ProductSummary
  readonly messages: AdminProductMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 성공하면 `null`. 닫는 것은 부르는 쪽의 일이다. */
  readonly onConfirm: (reason: string) => Promise<ApiFailure | null>
  readonly onCancel: () => void
  readonly describe: (failure: ApiFailure) => string
}

/** 거절된 숨김이 `mapError` 로 가는 길. 메시지는 이미 배치가 끝난 상태다. */
class HideRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('hiding the product was refused')
    this.name = 'HideRejection'
  }
}

export function ProductHideDialog({
  target,
  messages,
  errors,
  onConfirm,
  onCancel,
  describe,
}: ProductHideDialogProps) {
  const copy = messages.hide
  const schema = useMemo(() => reasonFormSchema(copy.errors), [copy.errors])

  const form = useForm<ReasonValues>({
    schema,
    initialValues: EMPTY_REASON_FORM,
    onSubmit: async ({ reason }) => {
      const failure = await onConfirm(reason)

      if (failure === null) return

      throw new HideRejection(
        serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
          fields: [...REASON_FORM_FIELDS],
          code: failure.kind === 'http' ? failure.code : null,
          messageForCode: (code, params) => errorMessage(errors, code, params),
          fallbackMessage: describe(failure),
        }),
      )
    },
    mapError: (error) => (error instanceof HideRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  return (
    <Modal
      closeLabel={copy.closeLabel}
      description={copy.description}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {copy.cancel}
          </Button>
          {/*
            폼 밖의 버튼이라 `form.submit()` 을 부른다. `requestSubmit()` 을 지나므로
            클릭도 Enter 도 같은 문 하나에 도착한다 (`useForm` 의 규약).
          */}
          <Button loading={form.submitting} onClick={form.submit} type="button" variant="danger">
            {form.submitting ? copy.submitting : copy.submit}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open
      size="md"
      title={copy.title}
    >
      <div className="flex flex-col gap-4">
        <dl className="border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
          <dt className="text-fg-muted">{copy.targetLabel}</dt>
          <dd className="text-fg">{target.name}</dd>
        </dl>

        <Form aria-label={copy.title} form={form}>
          <FormError errors={form.formErrors} />

          <FormField
            form={form}
            hint={copy.reasonHint}
            label={copy.reasonLabel}
            name="reason"
            required
          >
            <Textarea
              {...form.text('reason')}
              maxLength={ADMIN_REASON_MAX}
              placeholder={copy.reasonPlaceholder}
            />
          </FormField>
        </Form>

        <p className="text-fg-muted text-xs">{copy.notice}</p>
      </div>
    </Modal>
  )
}
