'use client'

import type { ApiFailure, ErrorMessages, HandleReportRequest, Report } from '@shopping/shared'
import { errorMessage, REPORT_DETAIL_MAX } from '@shopping/shared'
import { Badge, Button, Modal, RadioGroup, Radio, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo, useRef, useState } from 'react'

import { reportDateTime } from '@/lib/reports/format'
import { EMPTY_HANDLE_FORM, HANDLE_FORM_FIELDS, handleFormSchema } from '@/lib/reports/handle-form'
import { effectOf, isDestructive, outcomesFor, removable } from '@/lib/reports/outcomes'
import type { ReportRefusal } from '@/lib/reports/report-console'
import { refusalOf } from '@/lib/reports/report-console'
import type { ReportMessages } from '@/messages'

/**
 * 신고 하나를 처리한다 — **사유 없이는 나갈 수 없다** (F4 · F6).
 *
 * ## 판단에 필요한 것이 전부 이 안에 있다
 *
 * 발췌·신고 횟수·신고자가 적은 내용이 선택지 바로 위에 선다. 계약이 그것들을 목록에
 * 실어 주는 이유가 「관리자가 대상 화면으로 가지 않고 판단할 수 있게」이고, 대화상자가
 * 그것을 다시 보여 주지 않으면 사람은 표와 이 창 사이를 오가며 기억으로 판단하게 된다.
 *
 * ## 선택지마다 **대상에 무슨 일이 일어나는지**를 적는다
 *
 * 「숨김·삭제·반려」 세 낱말만 있으면 반려는 「무시」로 읽힌다. 실제로는 반려가 자동
 * 임시 숨김을 **푸는** 처리이고(TASK-0091 4.2), 그것을 모르면 멀쩡한 글이 신고 세 번에
 * 영영 가려진 채 남는다. 문장은 `outcomeEffects` 에서 오고, 그 표의 열쇠는
 * `REPORT_EFFECT` 의 효과다 — 화면이 자기만의 낱말을 새로 짓지 않는다.
 *
 * ## 상품에는 삭제가 없다
 *
 * `outcomesFor` 가 정한다(TASK-0091 4.4). 조건문으로 버튼을 감추는 대신 목록 자체가
 * 짧아지므로, 이 파일에는 `'PRODUCT'` 라는 문자열이 **왜 짧은지 설명하는 문장**을 고르는
 * 자리에만 나온다.
 *
 * ## 삭제는 한 걸음이 더 있다 (R1)
 *
 * 되돌리는 화살표가 없는 유일한 처리라, 폼을 지난 뒤 확인을 한 번 더 받는다. 확인은
 * **같은 창 안**에서 일어난다 — 대화상자 위에 대화상자를 얹으면 키보드 초점이 어디에
 * 있는지 아무도 말할 수 없게 되고, 뒤로 돌아왔을 때 적어 둔 사유가 남아 있어야 한다.
 * 확인 버튼도 `form.submit()` 을 지나므로 **문은 여전히 하나**다.
 */

export interface ReportHandleDialogProps {
  readonly report: Report
  readonly messages: ReportMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 성공하면 `null`. 닫는 것은 부르는 쪽의 일이다. */
  readonly onConfirm: (request: HandleReportRequest) => Promise<ApiFailure | null>
  readonly onCancel: () => void
  /** 남이 먼저 처리했을 때, 목록을 다시 읽는다. */
  readonly onRefresh: () => void
  readonly describe: (failure: ApiFailure) => string
}

/** 거절된 처리가 `mapError` 로 가는 길. 메시지는 이미 배치가 끝난 상태다. */
class HandleRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('report handling rejected')
    this.name = 'HandleRejection'
  }
}

export function ReportHandleDialog({
  report,
  messages,
  errors,
  onConfirm,
  onCancel,
  onRefresh,
  describe,
}: ReportHandleDialogProps) {
  const copy = messages.handle
  const schema = useMemo(() => handleFormSchema(copy.errors), [copy.errors])

  /** 되돌릴 수 없는 처리가 확인을 기다리는 중. `null` 이면 폼 단계다. */
  const [confirming, setConfirming] = useState<HandleReportRequest | null>(null)
  /** 이 화면이 따로 할 말이 있는 거절. 칸 밑이 아니라 창 위에 선다. */
  const [refusal, setRefusal] = useState<ReportRefusal | null>(null)

  /**
   * 확인을 이미 받았는가 — **한 번의 제출에만 해당한다.**
   *
   * 상태가 아니라 참조인 이유는 제출 핸들러가 그 값을 **자기가 만들어진 시점의
   * 것으로** 읽기 때문이다. 상태로 두면 확인 버튼이 바꾼 값을 이미 닫힌 클로저가 보지
   * 못하고, 확인을 눌러도 다시 확인 화면이 뜬다.
   */
  const confirmed = useRef(false)

  const form = useForm<HandleReportRequest>({
    schema,
    initialValues: EMPTY_HANDLE_FORM,
    onSubmit: async (request) => {
      if (isDestructive(request.outcome) && !confirmed.current) {
        setConfirming(request)

        return
      }

      confirmed.current = false
      setRefusal(null)

      const failure = await onConfirm(request)

      if (failure === null) return

      const kind = refusalOf(failure)

      // 이 둘은 칸의 문제가 아니라 **상황**의 문제다. 사유를 고쳐 쓴다고 달라지지
      // 않으므로 칸 밑이 아니라 창 위에 서고, 다음 행동을 함께 내민다.
      if (kind !== null) {
        setRefusal(kind)
        setConfirming(null)

        return
      }

      throw new HandleRejection(placed(failure))
    },
    mapError: (error) => (error instanceof HandleRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  /**
   * 서버의 거절을 칸 위에 놓는다.
   *
   * `code` 로 카탈로그를 먼저 보고, 앱이 모르는 코드일 때만 서버의 문장을 쓴다 — 그
   * 순서가 내부 어휘를 화면에서 밀어낸다 (`settlement-hold-dialog.tsx` 와 같은 규약).
   */
  function placed(failure: ApiFailure): ValidationErrors {
    return serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
      fields: [...HANDLE_FORM_FIELDS],
      code: failure.kind === 'http' ? failure.code : null,
      messageForCode: (code, params) => errorMessage(errors, code, params),
      fallbackMessage: describe(failure),
    })
  }

  const outcomes = outcomesFor(report.targetType)
  const targetLabel = messages.targetTypeLabels[report.targetType]

  return (
    <Modal
      closeLabel={copy.closeLabel}
      description={copy.description}
      footer={
        confirming === null ? (
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
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setConfirming(null)
              }}
              type="button"
              variant="ghost"
            >
              {copy.confirm.back}
            </Button>
            <Button
              loading={form.submitting}
              onClick={() => {
                confirmed.current = true
                form.submit()
              }}
              type="button"
              variant="danger"
            >
              {form.submitting ? copy.submitting : copy.confirm.confirm}
            </Button>
          </div>
        )
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open
      size="lg"
      title={copy.title}
    >
      <div className="flex flex-col gap-4">
        {refusal === null ? null : (
          <div
            className="border-danger bg-danger-surface text-fg flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
            role="alert"
          >
            <p className="font-medium">{copy.failedTitle}</p>
            <p>{copy.refusals[refusal]}</p>
            {refusal === 'stale' ? (
              <Button onClick={onRefresh} size="sm" type="button" variant="outline">
                {copy.refreshLabel}
              </Button>
            ) : null}
          </div>
        )}

        <ReportSummary messages={messages} report={report} />

        {confirming === null ? null : (
          <div
            className="border-danger bg-danger-surface text-fg flex flex-col gap-1 rounded-md border p-3 text-sm"
            role="alert"
          >
            <p className="font-medium">{copy.confirm.title}</p>
            <p>{copy.confirm.description.replace('{target}', targetLabel)}</p>
            <p className="text-fg-muted">
              {copy.confirm.noteLabel}: {confirming.note}
            </p>
          </div>
        )}

        <Form aria-label={copy.title} form={form}>
          <FormError errors={form.formErrors} />

          <FormField form={form} label={copy.outcomeLegend} name="outcome" required variant="group">
            <RadioGroup {...form.choice('outcome')} disabled={confirming !== null}>
              {outcomes.map((outcome) => (
                <Radio
                  description={copy.outcomeEffects[effectOf(outcome)]}
                  key={outcome}
                  label={copy.outcomeLabels[outcome]}
                  value={outcome}
                />
              ))}
            </RadioGroup>
          </FormField>

          {removable(report.targetType) ? null : (
            <p className="text-fg-muted text-xs">{copy.productNotice}</p>
          )}

          <FormField form={form} hint={copy.noteHint} label={copy.noteLabel} name="note" required>
            <Textarea
              {...form.text('note')}
              disabled={confirming !== null}
              maxLength={REPORT_DETAIL_MAX}
              placeholder={copy.notePlaceholder}
            />
          </FormField>
        </Form>
      </div>
    </Modal>
  )
}

/**
 * 무엇에 대한 신고인가 — 판단에 필요한 것만.
 *
 * 「가려짐」과 「같은 대상의 다른 대기 신고」는 **조건이 맞을 때만** 나타난다. 늘
 * 그리면 두 문장은 배경이 되고, 배경이 된 경고는 아무도 읽지 않는다.
 */
function ReportSummary({
  report,
  messages,
}: {
  readonly report: Report
  readonly messages: ReportMessages
}) {
  const copy = messages.handle

  return (
    <section className="border-border flex flex-col gap-3 rounded-md border p-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-fg-muted">{copy.summary.target}</dt>
        <dd className="text-fg flex items-center gap-2">
          {messages.targetTypeLabels[report.targetType]}
          {report.targetHidden ? (
            <Badge size="sm" variant="neutral">
              {messages.list.targetHidden}
            </Badge>
          ) : null}
        </dd>

        <dt className="text-fg-muted">{copy.summary.reason}</dt>
        <dd className="text-fg">{messages.reasonLabels[report.reason]}</dd>

        <dt className="text-fg-muted">{copy.summary.detail}</dt>
        <dd className="text-fg whitespace-pre-wrap">{report.detail ?? copy.summary.none}</dd>

        <dt className="text-fg-muted">{copy.summary.reportCount}</dt>
        <dd className="text-fg">
          {messages.list.reportCount.replace('{count}', String(report.targetReportCount))}
        </dd>

        <dt className="text-fg-muted">{copy.summary.createdAt}</dt>
        <dd className="text-fg">{reportDateTime(report.createdAt)}</dd>
      </dl>

      <div className="flex flex-col gap-1">
        <p className="text-fg-muted">{copy.summary.excerpt}</p>
        <p className="border-border bg-surface-muted text-fg max-h-48 overflow-y-auto rounded-md border p-2 whitespace-pre-wrap">
          {report.targetExcerpt ?? messages.list.excerptEmpty}
        </p>
      </div>

      {report.targetHidden ? <p className="text-fg-muted text-xs">{copy.hiddenNotice}</p> : null}

      {report.targetReportCount > 1 ? (
        <p className="text-fg-muted text-xs">{copy.siblingNotice}</p>
      ) : null}
    </section>
  )
}
