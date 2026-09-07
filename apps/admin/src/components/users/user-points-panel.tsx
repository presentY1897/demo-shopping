'use client'

import type {
  AdjustPointsRequest,
  AdjustPointsResponse,
  ApiFailure,
  ErrorMessages,
} from '@shopping/shared'
import { ADMIN_REASON_MAX, errorMessage } from '@shopping/shared'
import { Button, GuardedButton, Input, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo, useState } from 'react'

import { userMoney, userSignedMoney } from '@/lib/users/format'
import { EMPTY_POINTS_FORM, POINTS_FORM_FIELDS, pointsFormSchema } from '@/lib/users/forms'
import type { UserRefusal } from '@/lib/users/user-console'
import { pointsOutcome, refusalOf } from '@/lib/users/user-console'
import type { UserWrite } from '@/lib/users/use-users'
import type { UserMessages } from '@/messages'

import { RefusalNotice } from './refusal-notice'

/**
 * 적립금 수동 조정 (F5).
 *
 * ## 실제로 움직인 몫을 말한다
 *
 * 차감은 **잔액까지만** 간다(`adjustByAdmin`). 사람이 친 숫자를 그대로 그리면 화면이
 * 거짓말을 한다 — 5만원을 빼려 했고 1만원만 빠졌는데 「-50,000원 조정했어요」라고
 * 말하고, 그 사람은 다음에 잔액을 보고서야 알게 된다. 그래서 답이 온 뒤의 문장은
 * `pointsOutcome` 이 고른다.
 *
 * 잔액이 0인 계정의 차감은 **아무 줄도 남기지 않는다**(`applied === 0`). 그것을
 * 「일부만 반영됐어요」로 말하면 원장에 있지도 않은 줄을 가리키게 되므로 문장이 셋이다.
 *
 * ## 한 칸에 부호를 함께 적는다
 *
 * 지급과 차감을 두 버튼으로 나누지 않는 이유는 계약이 문을 하나로 둔 것과 같다 —
 * 나누면 화면이 부호를 보고 어느 쪽을 부를지 정하게 되고, 그 분기가 틀리면 더하려던
 * 것이 빠진다 (4.5).
 *
 * ## 막힌 버튼은 감추지 않는다 (F8)
 *
 * `user.write` 라 최고관리자만 한다. 자리에 그대로 두고 왜 못 누르는지를 말한다.
 */

export interface UserPointsPanelProps {
  readonly balance: number
  readonly messages: UserMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  readonly busy: boolean
  readonly canWrite: boolean
  readonly denial: string | undefined
  /** `null` 은 「아무것도 보내지 않았다」 — 두 번 눌린 두 번째 클릭이다. */
  readonly onAdjust: (
    request: AdjustPointsRequest,
  ) => Promise<UserWrite<AdjustPointsResponse> | null>
  readonly onRefresh: () => void
  readonly describe: (failure: ApiFailure) => string
}

class AdjustRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('the adjustment was refused')
    this.name = 'AdjustRejection'
  }
}

/** 방금 한 조정 — 요청한 값과 서버가 답한 값. 둘 다 있어야 문장을 고를 수 있다. */
interface LastAdjustment {
  readonly requested: number
  readonly answer: AdjustPointsResponse
}

export function UserPointsPanel({
  balance,
  messages,
  errors,
  busy,
  canWrite,
  denial,
  onAdjust,
  onRefresh,
  describe,
}: UserPointsPanelProps) {
  const copy = messages.points
  const schema = useMemo(() => pointsFormSchema(copy.errors), [copy.errors])

  const [last, setLast] = useState<LastAdjustment | null>(null)
  const [refusal, setRefusal] = useState<UserRefusal | null>(null)

  const form = useForm<AdjustPointsRequest>({
    schema,
    initialValues: EMPTY_POINTS_FORM,
    onSubmit: async (request) => {
      setRefusal(null)
      setLast(null)

      const result = await onAdjust(request)

      // 이미 도는 중이었다 — 아무것도 보내지 않았고, 말할 것도 없다.
      if (result === null) return

      if (result.ok) {
        setLast({ answer: result.value, requested: request.amount })
        form.reset()

        return
      }

      const kind = refusalOf(result.failure)

      if (kind !== null) {
        setRefusal(kind)

        return
      }

      throw new AdjustRejection(
        serverFieldErrors(result.failure.kind === 'http' ? result.failure.details : [], {
          fields: [...POINTS_FORM_FIELDS],
          code: result.failure.kind === 'http' ? result.failure.code : null,
          messageForCode: (code, params) => errorMessage(errors, code, params),
          fallbackMessage: describe(result.failure),
        }),
      )
    },
    mapError: (error) => (error instanceof AdjustRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-fg text-sm font-medium">{copy.title}</h3>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <p className="text-fg text-sm">
        <span className="text-fg-muted">{copy.balanceLabel} </span>
        <span className="font-medium">{userMoney(balance)}</span>
      </p>

      {refusal === null ? null : (
        <RefusalNotice
          messages={messages}
          onRefresh={onRefresh}
          refreshLabel={messages.list.retryLabel}
          refusal={refusal}
          title={copy.failedTitle}
        />
      )}

      {last === null ? null : <AppliedNotice last={last} messages={messages} />}

      <Form aria-label={copy.title} form={form}>
        <FormError errors={form.formErrors} />

        <FormField
          form={form}
          hint={copy.amountHint}
          label={copy.amountLabel}
          name="amount"
          required
        >
          <Input
            {...form.text('amount')}
            inputMode="numeric"
            placeholder={copy.amountPlaceholder}
          />
        </FormField>

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
              variant="primary"
            >
              {form.submitting ? copy.submitting : copy.submitLabel}
            </Button>
          </div>
        ) : (
          <div>
            <GuardedButton blocked reason={denial ?? 'user.write'} variant="primary">
              {copy.submitLabel}
            </GuardedButton>
          </div>
        )}
      </Form>

      <p className="text-fg-muted text-xs">{copy.notice}</p>
    </section>
  )
}

/**
 * 방금 무슨 일이 일어났는가 — **서버가 답한 대로.**
 *
 * 셋 중 어느 문장인지는 `pointsOutcome` 이 정한다. 화면이 요청한 값과 답한 값을
 * 눈으로 비교하는 조건문을 쓰지 않는 이유는, 그 비교가 틀려도 조용하기 때문이다.
 */
function AppliedNotice({
  last,
  messages,
}: {
  readonly last: LastAdjustment
  readonly messages: UserMessages
}) {
  const copy = messages.points.applied
  const outcome = pointsOutcome(last.requested, last.answer)

  const sentence =
    outcome === 'exact'
      ? copy.exact.replace('{amount}', userSignedMoney(last.answer.applied))
      : outcome === 'clipped'
        ? copy.clipped
            .replace('{requested}', userSignedMoney(last.requested))
            .replace('{applied}', userSignedMoney(last.answer.applied))
        : copy.none.replace('{requested}', userSignedMoney(last.requested))

  return (
    <p
      className="border-border bg-surface-muted text-fg rounded-md border p-3 text-sm"
      role="status"
    >
      {sentence}
    </p>
  )
}
