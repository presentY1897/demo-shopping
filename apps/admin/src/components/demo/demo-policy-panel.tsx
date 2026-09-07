'use client'

import type { ApiFailure, DemoPolicy, ErrorMessages } from '@shopping/shared'
import { errorMessage } from '@shopping/shared'
import { Button, ErrorState, Input, Skeleton } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo } from 'react'

import { demoCount, demoMoney } from '@/lib/demo/format'
import type { DemoWrite } from '@/lib/demo/use-demo-console'
import { POLICY_FIELDS } from '@/lib/demo/demo-console'
import { EMPTY_POLICY_FORM, policyFormSchema } from '@/lib/demo/policy-form'
import type { DemoConsoleMessages } from '@/messages'

/**
 * 데모 정책 세 칸 (F6).
 *
 * ## 수명은 상수가 아니라 **행**이다
 *
 * `DEMO_ACCOUNT_TTL_HOURS` 로는 「수명을 1시간으로 바꿔 본다」를 할 수 없다 — 상수를
 * 고치는 것은 배포이고, 데모를 보여 주는 자리에서 필요한 것은 **지금 바꾸는 일**이다
 * (4.4).
 *
 * ## 「이후 발급분에만」을 말한다
 *
 * 이미 발급된 계정의 만료 시각은 소급해 옮기지 않는다 — 쓰고 있던 사람의 데모가
 * 눈앞에서 사라지는 일이 되고, 그것은 정책 변경이 아니라 사고다(R1). 화면이 그
 * 사실을 말하지 않으면 운영자는 수명을 1시간으로 줄인 뒤 목록에서 24시간이 남은
 * 계정들을 보고 「안 먹혔다」고 읽는다.
 *
 * ## 범위는 계약이 정한다
 *
 * `policyFormSchema` 가 `demoPolicySchema` 의 칸별 스키마에 직접 물어본다. 그래서
 * 이 파일에는 1도 720도 없다 — 손으로 옮겨 적으면 그날부터 화면만 옛 범위를 지킨다.
 */

export interface DemoPolicyPanelProps {
  readonly messages: DemoConsoleMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  readonly policy: DemoPolicy | null
  readonly status: 'loading' | 'error' | 'ready'
  readonly failureText: string | undefined
  readonly busy: boolean
  readonly onReload: () => void
  readonly onSave: (policy: DemoPolicy) => Promise<DemoWrite<DemoPolicy> | null>
  readonly onSaved: () => void
  readonly describe: (failure: ApiFailure) => string
}

export function DemoPolicyPanel({
  messages,
  errors,
  policy,
  status,
  failureText,
  busy,
  onReload,
  onSave,
  onSaved,
  describe,
}: DemoPolicyPanelProps) {
  const copy = messages.policy

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-base font-medium">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      {status === 'loading' ? <Skeleton label={copy.loadingLabel} lines={4} /> : null}

      {status === 'error' ? (
        <ErrorState
          description={failureText}
          onRetry={onReload}
          retryLabel={copy.retryLabel}
          title={copy.errorTitle}
        />
      ) : null}

      {policy === null ? null : (
        <>
          <CurrentPolicy messages={messages} policy={policy} />

          {/*
            폼은 **읽어 온 정책으로 씨를 뿌린다.** `useForm` 의 초기값은 마운트 때
            한 번만 읽히므로, 저장 뒤 새 값이 오면 열쇠를 바꿔 다시 마운트한다 —
            그러지 않으면 서버가 정규화한 값과 칸 안의 값이 갈린다.
          */}
          <PolicyForm
            busy={busy}
            describe={describe}
            errors={errors}
            key={`${String(policy.ttlHours)}:${String(policy.seedOrders)}:${String(policy.virtualCardLimit)}`}
            messages={messages}
            onSave={onSave}
            onSaved={onSaved}
            policy={policy}
          />
        </>
      )}

      <p className="text-fg-muted text-xs">{copy.notice}</p>
    </section>
  )
}

/** 지금 저장되어 있는 값, 사람이 읽는 단위로. 칸 안의 숫자는 고치는 중일 수 있다. */
function CurrentPolicy({
  policy,
  messages,
}: {
  readonly policy: DemoPolicy
  readonly messages: DemoConsoleMessages
}) {
  const copy = messages.policy.current

  return (
    <dl className="border-border bg-surface-muted grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
      <dt className="text-fg-muted">{copy.title}</dt>
      <dd className="text-fg">
        {copy.ttlHours.replace('{hours}', demoCount(policy.ttlHours))} ·{' '}
        {copy.seedOrders.replace('{count}', demoCount(policy.seedOrders))} ·{' '}
        {copy.virtualCardLimit.replace('{amount}', demoMoney(policy.virtualCardLimit))}
      </dd>
    </dl>
  )
}

class PolicyRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('the policy was refused')
    this.name = 'PolicyRejection'
  }
}

function PolicyForm({
  policy,
  messages,
  errors,
  busy,
  onSave,
  onSaved,
  describe,
}: {
  readonly policy: DemoPolicy
  readonly messages: DemoConsoleMessages
  readonly errors: ErrorMessages
  readonly busy: boolean
  readonly onSave: (policy: DemoPolicy) => Promise<DemoWrite<DemoPolicy> | null>
  readonly onSaved: () => void
  readonly describe: (failure: ApiFailure) => string
}) {
  const copy = messages.policy
  const schema = useMemo(() => policyFormSchema(copy.errors), [copy.errors])

  const form = useForm<DemoPolicy>({
    schema,
    initialValues: {
      ...EMPTY_POLICY_FORM,
      ttlHours: String(policy.ttlHours),
      seedOrders: String(policy.seedOrders),
      virtualCardLimit: String(policy.virtualCardLimit),
    },
    onSubmit: async (next) => {
      const result = await onSave(next)

      // 이미 도는 중이었다 — 아무것도 보내지 않았고, 말할 것도 없다.
      if (result === null) return

      if (result.ok) {
        onSaved()

        return
      }

      throw new PolicyRejection(
        serverFieldErrors(result.failure.kind === 'http' ? result.failure.details : [], {
          fields: [...POLICY_FIELDS],
          code: result.failure.kind === 'http' ? result.failure.code : null,
          messageForCode: (code, params) => errorMessage(errors, code, params),
          fallbackMessage: describe(result.failure),
        }),
      )
    },
    mapError: (error) => (error instanceof PolicyRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  return (
    <Form aria-label={copy.title} form={form}>
      <FormError errors={form.formErrors} />

      {POLICY_FIELDS.map((field) => (
        <FormField
          form={form}
          hint={copy.fields[field].hint}
          key={field}
          label={copy.fields[field].label}
          name={field}
          required
        >
          <Input {...form.text(field)} inputMode="numeric" />
        </FormField>
      ))}

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
    </Form>
  )
}
