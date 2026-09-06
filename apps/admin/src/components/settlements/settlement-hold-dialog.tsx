'use client'

import type { ApiFailure, ErrorMessages, HoldSettlementRequest } from '@shopping/shared'
import { errorMessage, SETTLEMENT_HOLD_REASON_MAX } from '@shopping/shared'
import { Button, Modal, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo } from 'react'

import { EMPTY_HOLD_FORM, HOLD_FORM_FIELDS, holdFormSchema } from '@/lib/settlements/hold-form'
import type { SettlementActionMessages } from '@/messages'

/**
 * 보류 — **사유 없이는 나갈 수 없다** (F4).
 *
 * ## 확인 다이얼로그가 아니라 폼이다
 *
 * `ConfirmDialog` 는 「예/아니오」를 묻는 자리이고 여기서 물어야 하는 것은 문장
 * 하나다. 그래서 `useForm` 을 지나고, 그 덕에 세 가지가 공짜로 따라온다: 빈 사유가
 * **보내지기 전에** 막히고(계약이 `min(1)` 인 것을 `hold-form.ts` 가 그대로 쓴다),
 * 거절이 칸 밑에 서고, Enter 로 보낸 것과 버튼으로 보낸 것이 같은 문을 지난다.
 *
 * ## 공백만 적은 것도 빈 사유다
 *
 * 계약이 `trim().min(1)` 이므로 서버도 그것을 거절하지만, 거기까지 갔다 오는
 * 왕복에서 사람이 배우는 것은 아무것도 없다. 사유 없는 보류는 판매자가 「왜 제
 * 정산이 멈췄죠」라고 물었을 때 답할 것이 없는 상태이고, 그 물음은 반드시 온다.
 */

export interface SettlementHoldDialogProps {
  readonly messages: SettlementActionMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  readonly onConfirm: (reason: string) => Promise<ApiFailure | null>
  readonly onCancel: () => void
  readonly describe: (failure: ApiFailure) => string
}

/** 거절된 보류가 `mapError` 로 가는 길. 메시지는 이미 배치가 끝난 상태다. */
class HoldRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('settlement hold rejected')
    this.name = 'HoldRejection'
  }
}

export function SettlementHoldDialog({
  messages,
  errors,
  onConfirm,
  onCancel,
  describe,
}: SettlementHoldDialogProps) {
  const copy = messages.hold
  const schema = useMemo(() => holdFormSchema(copy.errors), [copy.errors])

  const form = useForm<HoldSettlementRequest>({
    schema,
    initialValues: EMPTY_HOLD_FORM,
    onSubmit: async ({ reason }) => {
      const failure = await onConfirm(reason)

      if (failure !== null) throw new HoldRejection(placed(failure))
    },
    mapError: (error) => (error instanceof HoldRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  /**
   * 서버의 거절을 칸 위에 놓는다.
   *
   * `code` 로 카탈로그를 먼저 보고, 앱이 모르는 코드일 때만 서버의 문장을 쓴다 — 그
   * 순서가 내부 어휘를 화면에서 밀어낸다 (`commission-scope-panel.tsx` 와 같은 규약).
   */
  function placed(failure: ApiFailure): ValidationErrors {
    return serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
      fields: [...HOLD_FORM_FIELDS],
      code: failure.kind === 'http' ? failure.code : null,
      messageForCode: (code, params) => errorMessage(errors, code, params),
      fallbackMessage: describe(failure),
    })
  }

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
      title={copy.title}
    >
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
            maxLength={SETTLEMENT_HOLD_REASON_MAX}
            placeholder={copy.reasonPlaceholder}
          />
        </FormField>
      </Form>
    </Modal>
  )
}
