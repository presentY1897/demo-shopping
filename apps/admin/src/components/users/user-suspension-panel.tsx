'use client'

import type { AdminUserDetail, ApiFailure, ErrorMessages } from '@shopping/shared'
import { ADMIN_REASON_MAX, errorMessage } from '@shopping/shared'
import { Button, GuardedButton, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo, useState } from 'react'

import { userDateTime } from '@/lib/users/format'
import type { ReasonValues } from '@/lib/users/forms'
import { EMPTY_REASON_FORM, REASON_FORM_FIELDS, reasonFormSchema } from '@/lib/users/forms'
import type { UserRefusal } from '@/lib/users/user-console'
import { refusalOf } from '@/lib/users/user-console'
import type { UserMessages } from '@/messages'

import { RefusalNotice } from './refusal-notice'

/**
 * 정지와 해제 (F4).
 *
 * ## 정지는 탈퇴가 아니다
 *
 * 탈퇴는 되돌리지 않는 끝이고 정지는 되돌리는 조치다. 화면이 그 차이를 말하지 않으면
 * 운영자는 되돌릴 수 있는 조치 앞에서 망설이고, 그 망설임은 「일단 두자」로 끝난다
 * (4.4).
 *
 * ## 살아 있는 세션도 끊긴다는 것을 말한다
 *
 * 서버가 리프레시 토큰까지 지운다(`admin-user.service.ts`). 그것을 말하지 않으면
 * 운영자는 「정지했는데 아직 쓰고 있는 것 아닌가」를 의심하게 되고, 확인할 방법이
 * 이 화면에 없다.
 *
 * ## 해제에는 사유를 받지 않는다
 *
 * 계약이 그렇게 정해 두었다. 되돌리는 쪽에는 **되돌린다는 사실 자체가 근거**이고,
 * 정지 때 적힌 사유가 위에 그대로 서서 무엇을 되돌리는지 말한다.
 */

export interface UserSuspensionPanelProps {
  readonly user: AdminUserDetail
  readonly messages: UserMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  readonly busy: boolean
  readonly canWrite: boolean
  readonly denial: string | undefined
  /** 성공하면 `null`. 화면을 닫고 목록을 다시 읽는 것은 부르는 쪽의 일이다. */
  readonly onSuspend: (reason: string) => Promise<ApiFailure | null>
  readonly onReinstate: () => Promise<ApiFailure | null>
  readonly onRefresh: () => void
  readonly describe: (failure: ApiFailure) => string
}

class SuspendRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('suspension was refused')
    this.name = 'SuspendRejection'
  }
}

export function UserSuspensionPanel({
  user,
  messages,
  errors,
  busy,
  canWrite,
  denial,
  onSuspend,
  onReinstate,
  onRefresh,
  describe,
}: UserSuspensionPanelProps) {
  const copy = messages.suspension
  const schema = useMemo(() => reasonFormSchema(copy.errors), [copy.errors])

  /** 이 화면이 따로 할 말이 있는 거절. 칸 밑이 아니라 섹션 위에 선다. */
  const [refusal, setRefusal] = useState<UserRefusal | null>(null)

  const form = useForm<ReasonValues>({
    schema,
    initialValues: EMPTY_REASON_FORM,
    onSubmit: async ({ reason }) => {
      setRefusal(null)

      const failure = await onSuspend(reason)

      if (failure === null) return

      const kind = refusalOf(failure)

      // 이 둘은 칸의 문제가 아니라 **상황**의 문제다. 사유를 고쳐 쓴다고 달라지지
      // 않으므로 칸 밑이 아니라 섹션 위에 선다.
      if (kind !== null) {
        setRefusal(kind)

        return
      }

      throw new SuspendRejection(
        serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
          fields: [...REASON_FORM_FIELDS],
          code: failure.kind === 'http' ? failure.code : null,
          messageForCode: (code, params) => errorMessage(errors, code, params),
          fallbackMessage: describe(failure),
        }),
      )
    },
    mapError: (error) => (error instanceof SuspendRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  async function reinstate(): Promise<void> {
    setRefusal(null)

    const failure = await onReinstate()

    if (failure === null) return

    setRefusal(refusalOf(failure) ?? 'stale')
  }

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-fg text-sm font-medium">{copy.title}</h3>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      {refusal === null ? null : (
        <RefusalNotice
          messages={messages}
          onRefresh={onRefresh}
          refreshLabel={messages.list.retryLabel}
          refusal={refusal}
          title={copy.failedTitle}
        />
      )}

      {user.suspendedAt === null ? (
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

          {canWrite ? (
            <div>
              <Button
                loading={form.submitting || busy}
                onClick={form.submit}
                type="button"
                variant="danger"
              >
                {form.submitting ? copy.submitting : copy.suspendLabel}
              </Button>
            </div>
          ) : (
            <div>
              <GuardedButton blocked reason={denial ?? 'user.write'} variant="danger">
                {copy.suspendLabel}
              </GuardedButton>
            </div>
          )}
        </Form>
      ) : (
        <div className="border-border bg-surface-muted flex flex-col items-start gap-2 rounded-md border p-3 text-sm">
          <p className="text-fg font-medium">{copy.activeTitle}</p>
          <p className="text-fg-muted">
            {copy.activeSince.replace('{datetime}', userDateTime(user.suspendedAt))}
          </p>
          {/*
            사유는 **없을 수 있는 줄**이다. 계약이 두 칸을 따로 nullable 로 싣기
            때문이고, 없을 때 「없음」을 적으면 사유 없는 정지가 있는 것처럼 읽힌다.
          */}
          {user.suspendedReason === null ? null : (
            <p className="text-fg-muted">
              {copy.activeReason.replace('{reason}', user.suspendedReason)}
            </p>
          )}

          {canWrite ? (
            <Button
              loading={busy}
              onClick={() => {
                void reinstate()
              }}
              type="button"
              variant="primary"
            >
              {busy ? copy.submitting : copy.reinstateLabel}
            </Button>
          ) : (
            <GuardedButton blocked reason={denial ?? 'user.write'} variant="primary">
              {copy.reinstateLabel}
            </GuardedButton>
          )}
        </div>
      )}

      <p className="text-fg-muted text-xs">{copy.notice}</p>
    </section>
  )
}
