'use client'

import type { ReportReason, ReportTargetType } from '@shopping/shared'
import { REPORT_DETAIL_MAX, failureMessage, reportReasons } from '@shopping/shared'
import { Button, Modal, Radio, RadioGroup, Textarea } from '@shopping/ui/components'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useId, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import { reportDraftIssues } from '@/lib/reports/report-draft'
import { useReport } from '@/lib/reports/use-report'
import type { RefusalMessages, ReportMessages } from '@/messages'

/**
 * 리뷰·문의·답변을 신고하는 다이얼로그 (TASK-0091 F1 · F2).
 *
 * ## 대상이 넷이고 컴포넌트는 하나다
 *
 * 계약이 `targetType` 과 `targetId` 두 값으로 넷을 받는다
 * (`createReportRequestSchema`). 네 벌로 나누면 다음 문구 수정이 들어갈 자리가 넷이
 * 되고, 실제로 다른 것은 다이얼로그 첫 줄의 낱말 하나뿐이다.
 *
 * ## 사유를 미리 골라 두지 않는다
 *
 * 첫 항목이 선택된 채로 열리면 사람이 읽지 않고 보낼 수 있고, 그렇게 들어온 「욕설」
 * 신고는 관리자가 세는 숫자를 망친다 — 사유 목록을 고정한 이유가 분류인데
 * (`reportReasons`) 그 분류가 못 쓰게 된다.
 *
 * ## 「기타」를 고르면 설명 칸이 나타난다
 *
 * 계약이 그때만 설명을 요구하고(`refine`), 그 요구는 **분류되지 않는 신고에 근거까지
 * 없으면 관리자가 판단할 것이 하나도 없기** 때문이다. 다른 사유에는 칸을 두지 않는다
 * — 늘 보이는 빈 칸은 사람에게 「적어야 하나」를 매번 묻는다.
 *
 * ## 접수한 뒤에는 폼이 사라진다
 *
 * 같은 사람이 같은 대상을 두 번 신고할 수 없다(F2). 버튼을 남겨 두고 두 번째 클릭이
 * `REPORT_ALREADY_FILED` 를 받아 오게 하면, 사람은 자기가 무언가 잘못했다고 읽는다.
 *
 * ## 다이얼로그는 `packages/ui` 의 `Modal` 이다
 *
 * 포커스 가둠, Escape, 바깥 클릭, `aria-labelledby`, 배경 스크롤 잠금이 전부 거기
 * 있다(D-056). 여기서 그것을 다시 만들면 다섯 가지를 새로 틀릴 기회가 생긴다.
 */
export function ReportDialog({
  copy,
  refusals,
  targetId,
  targetType,
}: {
  readonly copy: ReportMessages
  readonly refusals: RefusalMessages
  readonly targetId: string
  readonly targetType: ReportTargetType
}) {
  const { state } = useAuth()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [attempted, setAttempted] = useState(false)
  const report = useReport(targetType, targetId)

  const legendId = useId()
  const detailId = useId()
  const issuesId = useId()

  if (state.status !== 'signedIn') {
    // 신고에는 신고자가 있어야 한다 — 중복 신고를 막는 것도, 남용을 확인하는 것도
    // 사람을 알아야 할 수 있는 일이다 (`REPORT_ALREADY_FILED`).
    return (
      <Link
        className="text-fg-muted min-h-touch inline-flex items-center text-xs underline"
        href={signInHref('/login', pathname)}
      >
        {copy.signInLabel}
      </Link>
    )
  }

  const issues = reportDraftIssues({ detail, reason })
  const shown = attempted ? issues : []
  const issue = shown[0]
  const done = report.step.status === 'done'

  function submit(): void {
    setAttempted(true)

    // 이 렌더의 값으로 판단한다. 사람이 누른 것이 화면에 보이던 그 상태다.
    if (issues.length > 0 || reason === null) return

    report.send({ detail, reason })
  }

  return (
    <Modal
      closeLabel={copy.closeLabel}
      description={copy.description.replace('{target}', copy.targets[targetType])}
      footer={
        done ? null : (
          <>
            <Button
              loading={report.step.status === 'sending'}
              onClick={submit}
              size="sm"
              type="button"
            >
              {report.step.status === 'sending' ? copy.submittingLabel : copy.submitLabel}
            </Button>
            <Button
              onClick={() => {
                setOpen(false)
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {copy.cancelLabel}
            </Button>
          </>
        )
      }
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setAttempted(false)
          report.reset()
        }
      }}
      open={open}
      size="sm"
      title={copy.title}
      trigger={
        <Button size="sm" type="button" variant="ghost">
          {copy.triggerLabel}
        </Button>
      }
    >
      {done ? (
        <div className="flex flex-col gap-1 pb-4">
          <p className="text-fg text-sm font-medium">{copy.doneTitle}</p>
          <p className="text-fg-muted text-sm">{copy.doneBody}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-fg text-sm font-medium" id={legendId}>
              {copy.reasonLegend}
            </legend>
            <RadioGroup
              aria-describedby={issuesId}
              aria-labelledby={legendId}
              invalid={shown.includes('reason_required')}
              onValueChange={(value) => {
                setReason(reportReasons.find((option) => option === value) ?? null)
              }}
              value={reason ?? undefined}
            >
              {reportReasons.map((option) => (
                <Radio key={option} label={copy.reasons[option]} value={option} />
              ))}
            </RadioGroup>
          </fieldset>

          {reason === 'OTHER' ? (
            <div className="flex flex-col gap-1">
              <label className="text-fg text-sm font-medium" htmlFor={detailId}>
                {copy.detailLabel}
              </label>
              <p className="text-fg-muted text-xs">
                {copy.detailHint.replace('{max}', String(REPORT_DETAIL_MAX))}
              </p>
              <Textarea
                aria-describedby={issuesId}
                id={detailId}
                invalid={shown.includes('detail_required') || shown.includes('detail_too_long')}
                onChange={(event) => {
                  setDetail(event.target.value)
                }}
                placeholder={copy.detailPlaceholder}
                rows={3}
                value={detail}
              />
            </div>
          ) : null}

          {/*
            문장이 하나뿐이어도 **자리는 남는다** (U2). 나타났다 사라지는 줄은 그 아래
            버튼을 위아래로 움직이게 하고, 사람은 누르려던 것을 놓친다.
          */}
          <p className="text-danger min-h-5 text-sm" id={issuesId} role="status">
            {issue === undefined
              ? ''
              : copy.issues[issue].replace('{max}', String(REPORT_DETAIL_MAX))}
          </p>

          {report.step.status === 'failed' ? (
            <div className="flex flex-col gap-1">
              <p className="text-fg text-sm font-medium">{copy.failureTitle}</p>
              <p className="text-danger text-sm" role="status">
                {failureMessage(report.step.failure, refusals)}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
