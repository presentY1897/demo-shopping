'use client'

import type { ApiFailure } from '@shopping/shared'
import { CLAIM_APPEAL_REASON_MAX_LENGTH } from '@shopping/shared'
import { Button, ErrorNotice, Modal, Textarea } from '@shopping/ui/components'
import { useId, useState } from 'react'

import { Field, fieldAria } from '@/form'
import type { AdminClaimDetailMessages, ClaimAppealMessages, ErrorNoticeMessages } from '@/messages'

/**
 * 이의 기각 — **사유가 필수인 유일한 이유**를 화면이 말한다.
 *
 * 인용은 개입 클레임이 자기 이력에 근거를 남기지만 기각은 그런 클레임이 생기지 않는다.
 * 여기 적히지 않으면 「왜 기각했나」가 어디에도 남지 않고, 구매자는 답을 받지 못한 채
 * 거절만 다시 본다 — 계약이 `min(1)` 을 요구하는 이유가 그것이고, 이 폼이 먼저 막는
 * 것은 친절이다.
 */

export interface AppealDismissDialogProps {
  readonly messages: ClaimAppealMessages
  readonly detail: AdminClaimDetailMessages
  readonly notice: ErrorNoticeMessages
  readonly busy: boolean
  readonly failure: ApiFailure | null
  readonly describe: (failure: ApiFailure) => string
  readonly onConfirm: (reason: string) => void
  readonly onCancel: () => void
}

export function AppealDismissDialog({
  messages,
  detail,
  notice,
  busy,
  failure,
  describe,
  onConfirm,
  onCancel,
}: AppealDismissDialogProps) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const copy = messages.dismiss

  function submit(): void {
    const written = reason.trim()

    if (written === '') {
      setError(copy.errors.reasonRequired)

      return
    }
    if (written.length > CLAIM_APPEAL_REASON_MAX_LENGTH) {
      setError(copy.errors.reasonTooLong)

      return
    }

    setError(undefined)
    onConfirm(written)
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
          <Button disabled={busy} onClick={submit} type="button" variant="primary">
            {copy.confirm}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open
      title={copy.title}
    >
      <div className="flex flex-col gap-4">
        <Field
          error={error}
          fieldId={reasonId}
          hint={copy.reasonHint}
          label={copy.reasonLabel}
          required
        >
          <Textarea
            {...fieldAria(reasonId, { error, hint: copy.reasonHint })}
            maxLength={CLAIM_APPEAL_REASON_MAX_LENGTH}
            onChange={(event) => {
              setReason(event.target.value)
              setError(undefined)
            }}
            placeholder={copy.reasonPlaceholder}
            value={reason}
          />
        </Field>

        {failure === null ? null : (
          <ErrorNotice
            copiedLabel={notice.copiedLabel}
            copyLabel={notice.copyLabel}
            description={describe(failure)}
            requestIdHint={notice.requestIdHint}
            requestIdLabel={notice.requestIdLabel}
            title={detail.failureTitle}
          />
        )}
      </div>
    </Modal>
  )
}
