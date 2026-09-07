'use client'

import type { AdminUserSummary, ApiFailure, ErrorMessages } from '@shopping/shared'
import { ADMIN_REASON_MAX, errorMessage } from '@shopping/shared'
import { Button, Modal, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo } from 'react'

import type { ReasonValues } from '@/lib/users/forms'
import { EMPTY_REASON_FORM, REASON_FORM_FIELDS, reasonFormSchema } from '@/lib/users/forms'
import type { UserMessages } from '@/messages'

/**
 * 가려지지 않은 값을 열기 전에 **왜인지 묻는다** (F7).
 *
 * ## 이 창이 존재하는 것이 설계다
 *
 * 사유를 몰래 채워 보낼 수도 있었다 — 「운영 확인」 한 줄이면 열람은 그대로 되고 창은
 * 하나 줄어든다. 그러면 남는 것은 감사 기록이 아니라 **감사 기록의 모양**이다.
 * 4.1 이 「막는 것이 아니라 가르는 것」이라고 말한 자리가 정확히 여기이고, 가르는 일을
 * 하는 것은 이 한 걸음이다.
 *
 * ## 여는 대상도 **가려진 값**으로 보여 준다
 *
 * 어떤 계정을 여는지는 알아야 하지만, 그것을 원본으로 보여 주면 이 창을 지나기 전에
 * 이미 열린 것이 된다. 목록의 줄이 들고 있는 것이 그대로 여기 선다.
 *
 * ## 사유가 남는다는 것을 **미리** 말한다
 *
 * 알고 적는 문장과 모르고 적는 문장은 다르다. 「나중에 읽는 사람이 이해할 수 있게」가
 * 이 창이 실제로 요구하는 것이고, 그것을 적어 두지 않으면 「확인」 두 글자가 쌓인다.
 */

export interface UserViewDialogProps {
  /** 목록의 줄. 가려진 값만 들고 있다. */
  readonly target: AdminUserSummary
  readonly messages: UserMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 성공하면 `null`. 닫는 것은 부르는 쪽의 일이다. */
  readonly onConfirm: (reason: string) => Promise<ApiFailure | null>
  readonly onCancel: () => void
  readonly describe: (failure: ApiFailure) => string
}

/** 거절된 열람이 `mapError` 로 가는 길. 메시지는 이미 배치가 끝난 상태다. */
class ViewRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('opening the account was refused')
    this.name = 'ViewRejection'
  }
}

export function UserViewDialog({
  target,
  messages,
  errors,
  onConfirm,
  onCancel,
  describe,
}: UserViewDialogProps) {
  const copy = messages.view
  const schema = useMemo(() => reasonFormSchema(copy.errors), [copy.errors])

  const form = useForm<ReasonValues>({
    schema,
    initialValues: EMPTY_REASON_FORM,
    onSubmit: async ({ reason }) => {
      const failure = await onConfirm(reason)

      if (failure === null) return

      throw new ViewRejection(
        serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
          fields: [...REASON_FORM_FIELDS],
          code: failure.kind === 'http' ? failure.code : null,
          messageForCode: (code, params) => errorMessage(errors, code, params),
          fallbackMessage: describe(failure),
        }),
      )
    },
    mapError: (error) => (error instanceof ViewRejection ? error.errors : undefined),
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
          <Button loading={form.submitting} onClick={form.submit} type="button" variant="primary">
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
          <dd className="text-fg">
            {target.maskedName} · {target.maskedEmail}
          </dd>
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
